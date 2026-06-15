import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { createProvider } from "../../../lib/provider";
import {
  UiPoolDataProvider,
  UiPoolDataProviderContext,
  UiIncentiveDataProvider,
  UiIncentiveDataProviderContext
} from "@aave/contract-helpers";
import dayjs from "dayjs";
import {
  ComputedUserReserve,
  FormatUserSummaryResponse,
  formatReserves,
  formatReservesAndIncentives,
  formatUserSummary,
  formatUserSummaryAndIncentives,
} from "@aave/math-utils";
import BigNumber from "bignumber.js";
import {
  AaveHealthFactorData,
  AaveMarketDataType,
  AssetDetails,
  BorrowedAssetDataItem,
  HealthFactorData,
  ReserveAssetDataItem,
  getCalculatedLiquidationScenario,
  markets,
} from "../../../hooks/useAaveData";
import { getResolvedAddress } from "../resolver";

const allowedMethods = ["POST", "OPTIONS"];

// @aave/contract-helpers calls BigNumber.toNumber() on Spark's accumulated indices
// which exceed Number.MAX_SAFE_INTEGER. Patch it once to return a float instead of throwing.
const _bnProto: any = ethers.BigNumber.prototype;
const _origToNumber = _bnProto.toNumber;
_bnProto.toNumber = function (this: ethers.BigNumber) {
  try {
    return _origToNumber.call(this);
  } catch {
    return parseFloat(this.toString());
  }
};

// ─── Spark custom fetcher ────────────────────────────────────────────────────
// Spark is a fork of Aave v3.0. Its AggregatedReserveData struct has 54 head
// fields (vs 40 in Aave v3.3), causing @aave/contract-helpers to misread every
// field after position 10 (liquidityIndex reads as 0 → all balances show 0).
// We bypass the broken UiPoolDataProvider path entirely and call Pool + Oracle
// directly.

// Spark Ethereum contract addresses
const SPARK_POOL   = "0xC13e21B648A5Ee794902342038FF3aDAB66BE987";
const SPARK_ORACLE = "0x8105f69d9c41644c6a0803fda7d03aa70996cfd9";
const MULTICALL3   = "0xcA11bde05977b3631167028862bE2a173976CA11";

const SPARK_POOL_IFACE = new ethers.utils.Interface([
  "function getReserveNormalizedIncome(address asset) external view returns (uint256)",
  "function getReserveNormalizedVariableDebt(address asset) external view returns (uint256)",
  // getConfiguration returns DataTypes.ReserveConfigurationMap {uint256 data}.
  // A single-element struct ABI-encodes identically to a plain uint256, so we
  // declare it as uint256 to avoid ethers.js named-tuple decode quirks.
  "function getConfiguration(address asset) external view returns (uint256)",
]);

const SPARK_ORACLE_IFACE = new ethers.utils.Interface([
  "function getAssetPrice(address asset) external view returns (uint256)",
]);

const SPARK_MC3_IFACE = new ethers.utils.Interface([
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external view returns (tuple(bool success, bytes returnData)[] returnData)",
]);

const SPARK_ERC20_IFACE = new ethers.utils.Interface([
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
]);

function spMc3(target: string, iface: ethers.utils.Interface, fn: string, args: any[] = []) {
  return { target, allowFailure: true, callData: iface.encodeFunctionData(fn, args) };
}

function spDecode(iface: ethers.utils.Interface, fn: string, r: any): any[] | null {
  if (!r?.success || !r.returnData || r.returnData === "0x") return null;
  try { return iface.decodeFunctionResult(fn, r.returnData) as any; }
  catch { return null; }
}

// Configuration word packed bit layout (Aave v3 / Spark):
// [0:15] LTV (bps), [16:31] liquidationThreshold (bps), [32:47] liquidationBonus,
// [48:55] decimals, [56] isActive, [57] isFrozen, [58] borrowingEnabled,
// [60] isPaused, [61] borrowableInIsolation, [62] siloedBorrowing, [63] flashloanEnabled
function parseSparkConfig(rawBN: ethers.BigNumber) {
  const v = BigInt(rawBN.toString());
  const MASK16 = BigInt(0xFFFF);
  const MASK8  = BigInt(0xFF);
  const ONE    = BigInt(1);
  return {
    ltvBps:                  Number(v & MASK16),
    liquidationThresholdBps: Number((v >> BigInt(16)) & MASK16),
    decimals:                Number((v >> BigInt(48)) & MASK8),
    isActive:                Boolean((v >> BigInt(56)) & ONE),
    isFrozen:                Boolean((v >> BigInt(57)) & ONE),
    borrowingEnabled:        Boolean((v >> BigInt(58)) & ONE),
    isPaused:                Boolean((v >> BigInt(60)) & ONE),
    borrowableInIsolation:   Boolean((v >> BigInt(61)) & ONE),
    isSiloedBorrowing:       Boolean((v >> BigInt(62)) & ONE),
    flashloanEnabled:        Boolean((v >> BigInt(63)) & ONE),
  };
}

// Spark's UiPoolDataProvider returns a 7-field UserReserveData struct; the
// standard @aave/contract-helpers ABI only knows 4 fields and corrupts decoding
// after the first reserve.
const SPARK_USER_RESERVES_IFACE = new ethers.utils.Interface([
  "function getUserReservesData(address provider, address user) external view returns (tuple(address underlyingAsset, uint256 scaledATokenBalance, bool usageAsCollateralEnabledOnUser, uint256 scaledVariableDebt, uint256 principalStableDebt, uint256 stableBorrowRate, uint40 stableRateLastUpdated)[] userReservesData, uint8 userEmodeCategoryId)",
]);

async function getSparkUserReserves(
  provider: any,
  uiPoolDataProviderAddress: string,
  lendingPoolAddressProvider: string,
  user: string
): Promise<{ userReserves: any[]; userEmodeCategoryId: number }> {
  const contract = new ethers.Contract(uiPoolDataProviderAddress, SPARK_USER_RESERVES_IFACE, provider);
  const [userReservesRaw, userEmodeCategoryId]: [any[], number] =
    await contract.getUserReservesData(lendingPoolAddressProvider, user);

  const userReserves = userReservesRaw.map((r: any) => ({
    underlyingAsset: r.underlyingAsset.toLowerCase(),
    scaledATokenBalance: r.scaledATokenBalance.toString(),
    usageAsCollateralEnabledOnUser: r.usageAsCollateralEnabledOnUser,
    scaledVariableDebt: r.scaledVariableDebt.toString(),
    principalStableDebt: r.principalStableDebt?.toString() ?? "0",
    stableBorrowRate: r.stableBorrowRate?.toString() ?? "0",
    stableRateLastUpdated: Number(r.stableRateLastUpdated ?? 0),
  }));

  return { userReserves, userEmodeCategoryId };
}

async function getSparkData(
  provider: any,
  market: AaveMarketDataType,
  address: string,
  user: string
): Promise<HealthFactorData> {
  const mc  = new ethers.Contract(MULTICALL3, SPARK_MC3_IFACE, provider);
  const RAY = ethers.BigNumber.from("1000000000000000000000000000"); // 1e27

  const { userReserves, userEmodeCategoryId } = await getSparkUserReserves(
    provider,
    market.addresses.UI_POOL_DATA_PROVIDER,
    market.addresses.LENDING_POOL_ADDRESS_PROVIDER,
    user
  );

  // Only fetch data for reserves that have an actual position
  const activeReserves = userReserves.filter(
    (r: any) =>
      !ethers.BigNumber.from(r.scaledATokenBalance).isZero() ||
      !ethers.BigNumber.from(r.scaledVariableDebt).isZero() ||
      !ethers.BigNumber.from(r.principalStableDebt).isZero()
  );

  // Batch 6 calls per asset into one Multicall3 round-trip
  const STRIDE = 6;
  const calls: any[] = [];
  for (const r of activeReserves) {
    const a = r.underlyingAsset;
    calls.push(spMc3(SPARK_POOL,   SPARK_POOL_IFACE,   "getReserveNormalizedIncome",        [a]));
    calls.push(spMc3(SPARK_POOL,   SPARK_POOL_IFACE,   "getReserveNormalizedVariableDebt",   [a]));
    calls.push(spMc3(SPARK_ORACLE, SPARK_ORACLE_IFACE, "getAssetPrice",                      [a]));
    calls.push(spMc3(SPARK_POOL,   SPARK_POOL_IFACE,   "getConfiguration",                   [a]));
    calls.push(spMc3(a,            SPARK_ERC20_IFACE,  "symbol",                              []));
    calls.push(spMc3(a,            SPARK_ERC20_IFACE,  "name",                                []));
  }

  const results: any[] = calls.length > 0 ? (await mc.aggregate3(calls) as any[]) : [];

  const allAssets: AssetDetails[]         = [];
  const depositItems: ReserveAssetDataItem[] = [];
  const borrowItems: BorrowedAssetDataItem[] = [];

  for (let i = 0; i < activeReserves.length; i++) {
    const r    = activeReserves[i];
    const base = i * STRIDE;

    const incomeResult = spDecode(SPARK_POOL_IFACE,   "getReserveNormalizedIncome",      results[base]);
    const debtResult   = spDecode(SPARK_POOL_IFACE,   "getReserveNormalizedVariableDebt",results[base + 1]);
    const priceResult  = spDecode(SPARK_ORACLE_IFACE, "getAssetPrice",                   results[base + 2]);
    const cfgResult    = spDecode(SPARK_POOL_IFACE,   "getConfiguration",                results[base + 3]);
    const symResult    = spDecode(SPARK_ERC20_IFACE,  "symbol",                          results[base + 4]);
    const nameResult   = spDecode(SPARK_ERC20_IFACE,  "name",                            results[base + 5]);

    if (!incomeResult || !priceResult || !cfgResult) continue;

    const normalizedIncome: ethers.BigNumber = incomeResult[0];
    const normalizedDebt: ethers.BigNumber   = debtResult ? debtResult[0] : ethers.BigNumber.from(0);
    const priceRaw: ethers.BigNumber         = priceResult[0];
    const configRaw: ethers.BigNumber        = cfgResult[0];
    const symbol = symResult  ? (symResult[0]  as string) : "???";
    const name   = nameResult ? (nameResult[0] as string) : "Unknown";

    const cfg      = parseSparkConfig(configRaw);
    const decimals = cfg.decimals;
    const priceInUSD = parseFloat(ethers.utils.formatUnits(priceRaw, 8));

    // Supply: scaledATokenBalance × normalizedIncome / 1e27
    const scaledAToken = ethers.BigNumber.from(r.scaledATokenBalance);
    const actualSupply = scaledAToken.mul(normalizedIncome).div(RAY);
    const supplyTokens = parseFloat(ethers.utils.formatUnits(actualSupply, decimals));

    // Variable debt: scaledVariableDebt × normalizedVariableDebt / 1e27
    const scaledVarDebt  = ethers.BigNumber.from(r.scaledVariableDebt);
    const actualVarDebt  = normalizedDebt.gt(0)
      ? scaledVarDebt.mul(normalizedDebt).div(RAY)
      : scaledVarDebt;
    const varDebtTokens  = parseFloat(ethers.utils.formatUnits(actualVarDebt, decimals));

    // Stable debt: principalStableDebt is in raw token units (not scaled)
    const stableDebtTokens = parseFloat(
      ethers.utils.formatUnits(ethers.BigNumber.from(r.principalStableDebt), decimals)
    );

    const totalBorrowTokens = varDebtTokens + stableDebtTokens;
    const supplyUSD = supplyTokens * priceInUSD;
    const borrowUSD = totalBorrowTokens * priceInUSD;

    // updateDerivedHealthFactorData divides reserveLiquidationThreshold and
    // baseLTVasCollateral by 10 000, so store them in BPS (e.g. 8600 for 86 %)
    const asset: AssetDetails = {
      symbol,
      name,
      priceInUSD,
      priceInMarketReferenceCurrency: priceInUSD, // MRC = USD for Spark
      baseLTVasCollateral:            cfg.ltvBps,
      reserveLiquidationThreshold:    cfg.liquidationThresholdBps,
      reserveFactor:                  0,
      usageAsCollateralEnabled:       cfg.ltvBps > 0,
      initialPriceInUSD:              priceInUSD,
      underlyingAsset:                r.underlyingAsset,
      borrowingEnabled:               cfg.borrowingEnabled,
      isActive:                       cfg.isActive,
      isFrozen:                       cfg.isFrozen,
      isPaused:                       cfg.isPaused,
      borrowableInIsolation:          cfg.borrowableInIsolation,
      isSiloedBorrowing:              cfg.isSiloedBorrowing,
      flashLoanEnabled:               cfg.flashloanEnabled,
    };

    allAssets.push(asset);

    if (supplyTokens > 1e-10) {
      depositItems.push({
        asset,
        underlyingBalance:                      supplyTokens,
        underlyingBalanceUSD:                   supplyUSD,
        underlyingBalanceMarketReferenceCurrency: supplyUSD, // MRC = USD
        usageAsCollateralEnabledOnUser:          r.usageAsCollateralEnabledOnUser,
      });
    }

    if (totalBorrowTokens > 1e-10) {
      borrowItems.push({
        asset,
        stableBorrows:                        stableDebtTokens,
        variableBorrows:                      varDebtTokens,
        totalBorrows:                         totalBorrowTokens,
        totalBorrowsUSD:                      borrowUSD,
        totalBorrowsMarketReferenceCurrency:  borrowUSD, // MRC = USD
      });
    }
  }

  // Compute summary stats from per-reserve data (avoids calling Pool.getUserAccountData
  // which triggers internal oracle cross-calls that publicnode.com may reject from
  // Cloudflare IPs).
  let totalCollateralUSD = 0;
  let weightedLTNum = 0; // Σ(LT_i × collateral_i_USD)
  let weightedLTVNum = 0; // Σ(LTV_i × collateral_i_USD)
  let totalDebtUSD = 0;

  depositItems.forEach((d) => {
    if (d.usageAsCollateralEnabledOnUser) {
      totalCollateralUSD += d.underlyingBalanceUSD;
      weightedLTNum  += (d.asset.reserveLiquidationThreshold / 10000) * d.underlyingBalanceUSD;
      weightedLTVNum += (d.asset.baseLTVasCollateral / 10000) * d.underlyingBalanceUSD;
    }
  });
  borrowItems.forEach((b) => { totalDebtUSD += b.totalBorrowsUSD; });

  const currentLiquidationThreshold = totalCollateralUSD > 0 ? weightedLTNum / totalCollateralUSD : 0;
  const currentLoanToValue          = totalCollateralUSD > 0 ? weightedLTVNum / totalCollateralUSD : 0;
  const healthFactor = totalDebtUSD > 0
    ? (totalCollateralUSD * currentLiquidationThreshold) / totalDebtUSD
    : Infinity;
  const availableBorrowsUSD = Math.max(0, totalCollateralUSD * currentLoanToValue - totalDebtUSD);

  const fetchedData: AaveHealthFactorData = {
    healthFactor,
    totalBorrowsUSD:                       totalDebtUSD,
    availableBorrowsUSD,
    totalCollateralMarketReferenceCurrency: totalCollateralUSD,
    totalBorrowsMarketReferenceCurrency:   totalDebtUSD,
    currentLiquidationThreshold,
    currentLoanToValue,
    userReservesData: depositItems,
    userBorrowsData:  borrowItems,
    userEmodeCategoryId,
    isInIsolationMode: false,
  };

  const hf: HealthFactorData = {
    address,
    resolvedAddress: user,
    fetchError: "",
    isFetching: false,
    lastFetched: Date.now(),
    market,
    marketReferenceCurrencyPriceInUSD: 1.0, // Spark oracle returns USD prices
    availableAssets: allAssets,
    fetchedData,
    workingData: JSON.parse(JSON.stringify(fetchedData)),
  };

  const liquidationScenario = getCalculatedLiquidationScenario(
    hf.workingData as AaveHealthFactorData,
    1.0
  );
  if (hf.workingData) hf.workingData.liquidationScenario = liquidationScenario;

  return hf;
}

const handler = async (_req: NextApiRequest, res: NextApiResponse) => {
  try {
    if (!allowedMethods.includes(_req.method!)) {
      return res.status(405).send({ message: "Method not allowed." });
    }

    const parsedBody =
      typeof _req.body === "string" ? JSON.parse(_req.body || "{}") : _req.body || {};
    const { address } = parsedBody;
    const { marketId } = parsedBody;

    const market = markets.find(
      (m: AaveMarketDataType) => m.id === marketId
    ) as AaveMarketDataType;
    const data: HealthFactorData = await getAaveData(address, market);
    res.status(200).json(data);
  } catch (err: any) {
    console.error(err);
    const errorMessage = getAlchemyFriendlyError(err);
    res.status(500).json({ statusCode: 500, message: errorMessage });
  }
};

const getAlchemyFriendlyError = (err: any) => {
  const alchemyBody = err?.error?.body || err?.body;
  if (typeof alchemyBody === "string") {
    try {
      const parsed = JSON.parse(alchemyBody);
      if (parsed?.error?.message) {
        return parsed.error.message;
      }
    } catch {
      // ignore parse failure
    }
  }

  if (err?.message?.includes("not enabled for this app")) {
    return err.message;
  }

  return err?.message || "Unknown error while fetching Aave data.";
};

export const getAaveData = async (address: string, market: AaveMarketDataType) => {
  if (!market.api) {
    throw new Error("Missing RPC endpoint for market " + market.id);
  }

  const provider = createProvider(market.api, market.chainId);
  const user = (await getResolvedAddress(address)) || "0x87cCC67f0c1b67745989542152DD4acff3841CD6";

  // Spark uses a different ABI layout from Aave v3.3 — bypass @aave/contract-helpers entirely
  if (market.id.startsWith("SPARK")) {
    return getSparkData(provider, market, address, user);
  }

  const UiPoolDataCtx: UiPoolDataProviderContext = {
    uiPoolDataProviderAddress: market.addresses.UI_POOL_DATA_PROVIDER,
    provider,
    chainId: market.chainId,
  };
  const poolDataProviderContract = new UiPoolDataProvider(UiPoolDataCtx);

  const hasIncentives = !!market.addresses.UI_INCENTIVE_DATA_PROVIDER;

  let incentiveDataProviderContract: UiIncentiveDataProvider | null = null;
  if (hasIncentives) {
    const UiIncentiveDataCtx: UiIncentiveDataProviderContext = {
      uiIncentiveDataProviderAddress: market.addresses.UI_INCENTIVE_DATA_PROVIDER,
      provider,
      chainId: market.chainId,
    };
    incentiveDataProviderContract = new UiIncentiveDataProvider(UiIncentiveDataCtx);
  }

  // Sequential to avoid RPC rate limiting (publicnode.com limits parallel eth_calls)
  const reserves = await poolDataProviderContract.getReservesHumanized({
    lendingPoolAddressProvider: market.addresses.LENDING_POOL_ADDRESS_PROVIDER,
  });
  const userReserves = await poolDataProviderContract.getUserReservesHumanized({
    lendingPoolAddressProvider: market.addresses.LENDING_POOL_ADDRESS_PROVIDER,
    user,
  });
  const [reserveIncentives, userIncentives] = await Promise.all([
    incentiveDataProviderContract
      ? incentiveDataProviderContract.getReservesIncentivesDataHumanized({
          lendingPoolAddressProvider: market.addresses.LENDING_POOL_ADDRESS_PROVIDER,
        })
      : Promise.resolve([]),
    incentiveDataProviderContract
      ? incentiveDataProviderContract.getUserReservesIncentivesDataHumanized({
          lendingPoolAddressProvider: market.addresses.LENDING_POOL_ADDRESS_PROVIDER,
          user,
        })
      : Promise.resolve([]),
  ]);

  const reservesArray = reserves.reservesData;
  const { baseCurrencyData } = reserves;
  const userReservesArray = userReserves.userReserves;

  const currentTimestamp = dayjs().unix();

  const formattedPoolReserves = hasIncentives
    ? formatReservesAndIncentives({
        reserves: reservesArray,
        currentTimestamp,
        marketReferenceCurrencyDecimals:
          baseCurrencyData.marketReferenceCurrencyDecimals,
        marketReferencePriceInUsd:
          baseCurrencyData.marketReferenceCurrencyPriceInUsd,
        reserveIncentives: reserveIncentives as any
      })
    : formatReserves({
        reserves: reservesArray,
        currentTimestamp,
        marketReferenceCurrencyDecimals:
          baseCurrencyData.marketReferenceCurrencyDecimals,
        marketReferencePriceInUsd:
          baseCurrencyData.marketReferenceCurrencyPriceInUsd,
      });

  const userSummary = hasIncentives
    ? formatUserSummaryAndIncentives({
        currentTimestamp,
        marketReferencePriceInUsd:
          baseCurrencyData.marketReferenceCurrencyPriceInUsd,
        marketReferenceCurrencyDecimals:
          baseCurrencyData.marketReferenceCurrencyDecimals,
        userReserves: userReservesArray,
        formattedReserves: formattedPoolReserves,
        userEmodeCategoryId: userReserves.userEmodeCategoryId,
        reserveIncentives: reserveIncentives as any,
        userIncentives: userIncentives as any
      })
    : formatUserSummary({
        currentTimestamp,
        marketReferencePriceInUsd:
          baseCurrencyData.marketReferenceCurrencyPriceInUsd,
        marketReferenceCurrencyDecimals:
          baseCurrencyData.marketReferenceCurrencyDecimals,
        userReserves: userReservesArray,
        formattedReserves: formattedPoolReserves,
        userEmodeCategoryId: userReserves.userEmodeCategoryId,
      });

  const hf: HealthFactorData = aaveUserSummaryToHealthFactor(
    userSummary,
    address,
    user, // if address is an ens, user will point to the resolved address.
    market,
    baseCurrencyData,
    userReserves.userEmodeCategoryId
  );
  return hf;
};

const aaveUserSummaryToHealthFactor = (
  userSummary: FormatUserSummaryResponse,
  address: string,
  resolvedAddress: string,
  market: AaveMarketDataType,
  baseCurrencyData: any,
  userEmodeCategoryId: number
) => {
  const getAssetDetailsFromReserveItem = (reserveItem: ComputedUserReserve) => {
    const { reserve } = reserveItem;
    const reserveAny = reserve as any;
    const details: AssetDetails = {
      symbol: reserve.symbol,
      name: reserve.name,
      priceInUSD: Number(reserve.priceInUSD),
      priceInMarketReferenceCurrency: new BigNumber(
        reserve.priceInMarketReferenceCurrency
      )
        .shiftedBy(baseCurrencyData.marketReferenceCurrencyDecimals * -1)
        .toNumber(),
      baseLTVasCollateral: Number(reserve.baseLTVasCollateral),
      reserveFactor: Number(reserve.reserveFactor),
      usageAsCollateralEnabled: reserve.usageAsCollateralEnabled,
      reserveLiquidationThreshold: Number(
        reserve.reserveLiquidationThreshold
      ),
      initialPriceInUSD: Number(reserve.priceInUSD),
      aTokenAddress: reserveAny.aTokenAddress,
      stableDebtTokenAddress: reserveAny.stableDebtTokenAddress,
      variableDebtTokenAddress: reserveAny.variableDebtTokenAddress,
      underlyingAsset: reserve.underlyingAsset,
      flashLoanEnabled: reserveAny.flashLoanEnabled,
      borrowingEnabled: reserveAny.borrowingEnabled,
      isFrozen: reserveAny.isFrozen,
      isPaused: reserveAny.isPaused,
      isActive: reserveAny.isActive,
      supplyAPY: Number(reserve.supplyAPY),
      variableBorrowAPY: Number(reserve.variableBorrowAPY),
      stableBorrowAPY: Number(reserveAny.stableBorrowAPY),
      supplyAPR: Number(reserve.supplyAPR),
      variableBorrowAPR: Number(reserve.variableBorrowAPR),
      stableBorrowAPR: Number(reserveAny.stableBorrowAPR),
      availableLiquidity: Number(reserve.availableLiquidity),
      borrowCap: Number(reserve.borrowCap),
      supplyCap: Number(reserve.supplyCap),
      eModeLtv: Number(reserveAny.eModeLtv),
      eModeLiquidationThreshold: Number(reserveAny.eModeLiquidationThreshold),
      eModeCategoryId: Number(reserveAny.eModeCategoryId),
      eModeLabel: reserveAny.eModeLabel,
      borrowableInIsolation: Boolean(reserveAny.borrowableInIsolation),
      isSiloedBorrowing: Boolean(reserveAny.isSiloedBorrowing)
    };
    return details;
  };

  const reserveData = {
    healthFactor: Number(userSummary?.healthFactor),
    totalBorrowsUSD: Number(userSummary?.totalBorrowsUSD),
    availableBorrowsUSD: Number(userSummary?.availableBorrowsUSD),
    totalCollateralMarketReferenceCurrency: Number(
      userSummary?.totalCollateralMarketReferenceCurrency
    ),
    totalBorrowsMarketReferenceCurrency: Number(
      userSummary?.totalBorrowsMarketReferenceCurrency
    ),
    currentLiquidationThreshold: Number(
      userSummary?.currentLiquidationThreshold
    ),
    currentLoanToValue: Number(userSummary?.currentLoanToValue),
    userReservesData: userSummary?.userReservesData
      ?.filter(
        (reserveItem: ComputedUserReserve) =>
          reserveItem?.underlyingBalance &&
          reserveItem.underlyingBalance !== "0"
      )
      .map((reserveItem: ComputedUserReserve) => {
        const item: ReserveAssetDataItem = {
          asset: getAssetDetailsFromReserveItem(reserveItem),
          underlyingBalance: Number(reserveItem.underlyingBalance),
          underlyingBalanceUSD: Number(reserveItem.underlyingBalanceUSD),
          underlyingBalanceMarketReferenceCurrency: Number(
            reserveItem.underlyingBalanceMarketReferenceCurrency
          ),
          usageAsCollateralEnabledOnUser:
            reserveItem.usageAsCollateralEnabledOnUser,
        };
        return item;
      }),
    userBorrowsData: userSummary?.userReservesData
      ?.filter(
        (reserveItem: ComputedUserReserve) =>
          reserveItem?.totalBorrows && reserveItem.totalBorrows !== "0"
      )
      .map((reserveItem: ComputedUserReserve) => {
        const reserveItemAny = reserveItem as any;
        const item: BorrowedAssetDataItem = {
          asset: getAssetDetailsFromReserveItem(reserveItem),
          stableBorrows: Number(reserveItemAny.stableBorrows),
          variableBorrows: Number(reserveItem.variableBorrows),
          totalBorrowsUSD: Number(reserveItem.totalBorrowsUSD),
          totalBorrows: Number(reserveItem.totalBorrows),
          stableBorrowAPY: Number(reserveItemAny.stableBorrowAPY),
          totalBorrowsMarketReferenceCurrency: Number(
            reserveItem.totalBorrowsMarketReferenceCurrency
          ),
        };

        return item;
      }),
    userEmodeCategoryId,
    isInIsolationMode: userSummary.isInIsolationMode,
  };
  const reserveDataCopy = { ...reserveData };

  const marketReferenceCurrencyPriceInUSD = new BigNumber(
    baseCurrencyData.marketReferenceCurrencyPriceInUsd
  )
    .shiftedBy(-8)
    .toNumber();

  const fetchedData = {
    healthFactor: reserveData.healthFactor,
    totalBorrowsUSD: reserveData.totalBorrowsUSD,
    availableBorrowsUSD: reserveData.availableBorrowsUSD,
    totalCollateralMarketReferenceCurrency:
      reserveData.totalCollateralMarketReferenceCurrency,
    totalBorrowsMarketReferenceCurrency:
      reserveData.totalBorrowsMarketReferenceCurrency,
    currentLiquidationThreshold: reserveData.currentLiquidationThreshold,
    currentLoanToValue: reserveData.currentLoanToValue,
    userReservesData: reserveData.userReservesData,
    userBorrowsData: reserveData.userBorrowsData,
    userEmodeCategoryId: reserveData.userEmodeCategoryId,
    isInIsolationMode: reserveData.isInIsolationMode
  };

  const hf: HealthFactorData = {
    address,
    resolvedAddress,
    fetchError: "",
    isFetching: false,
    lastFetched: Date.now(),
    market,
    marketReferenceCurrencyPriceInUSD,
    availableAssets: userSummary.userReservesData.map((asset) =>
      getAssetDetailsFromReserveItem(asset)
    ),
    fetchedData,
    workingData: JSON.parse(JSON.stringify(fetchedData)),
  };
  const liquidationScenario = getCalculatedLiquidationScenario(
    hf.workingData as AaveHealthFactorData,
    marketReferenceCurrencyPriceInUSD
  );
  if (hf.workingData) {
    hf.workingData.liquidationScenario = liquidationScenario;
  }
  return hf;
};

export default handler;
