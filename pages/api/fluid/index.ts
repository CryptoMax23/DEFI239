import { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { createProvider } from "../../../lib/provider";

// ── Constants ─────────────────────────────────────────────────────────────────

const FLUID_VAULT_RESOLVER = "0xA5C3E16523eeeDDcC34706b0E6bE88b4c6EA95cC";
const FLUID_LENDING_RESOLVER = "0x48D32f49aFeAEC7AE66ad7B9264f446fc11a1569";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Address used to represent native ETH in some Fluid vaults
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
// WETH (used as canonical ETH token for price lookup)
const WETH_ETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Known stablecoin addresses → $1
const STABLE_PRICES: Record<string, number> = {
  // Ethereum
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 1, // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7": 1, // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f": 1, // DAI
  "0x83f20f44975d03b1b09e64809b757c47f942beea": 1, // sDAI ≈ $1
  "0x0ac0cb3d5594b04e3e7d57024e2a7de79bc6f17e": 1, // USDT0
  // Arbitrum
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": 1, // USDC (Arb)
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": 1, // USDT (Arb)
  // Base
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 1, // USDC (Base)
};

// Chainlink ETH/USD price feed (Ethereum mainnet — used for cross-chain ETH price estimate too)
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";

const CHAINS = [
  { chainId: 1, chainName: "Ethereum", rpc: "https://ethereum-rpc.publicnode.com" },
  { chainId: 42161, chainName: "Arbitrum One", rpc: "https://arbitrum-one-rpc.publicnode.com" },
  { chainId: 8453, chainName: "Base", rpc: "https://base-rpc.publicnode.com" },
];

// ── ABIs ──────────────────────────────────────────────────────────────────────

const VAULT_RESOLVER_ABI = [
  {
    inputs: [{ internalType: "address", name: "user_", type: "address" }],
    name: "positionsByUser",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "nftId", type: "uint256" },
          { internalType: "address", name: "owner", type: "address" },
          { internalType: "bool", name: "isLiquidated", type: "bool" },
          { internalType: "bool", name: "isSupplyPosition", type: "bool" },
          { internalType: "int256", name: "tick", type: "int256" },
          { internalType: "uint256", name: "tickId", type: "uint256" },
          { internalType: "uint256", name: "beforeSupply", type: "uint256" },
          { internalType: "uint256", name: "beforeBorrow", type: "uint256" },
          { internalType: "uint256", name: "beforeDustBorrow", type: "uint256" },
          { internalType: "uint256", name: "supply", type: "uint256" },
          { internalType: "uint256", name: "borrow", type: "uint256" },
          { internalType: "uint256", name: "dustBorrow", type: "uint256" },
        ],
        internalType: "struct Structs.UserPosition[]",
        name: "userPositions_",
        type: "tuple[]",
      },
      {
        components: [
          { internalType: "address", name: "vault", type: "address" },
          { internalType: "bool", name: "isSmartCol", type: "bool" },
          { internalType: "bool", name: "isSmartDebt", type: "bool" },
          {
            components: [
              { internalType: "address", name: "liquidity", type: "address" },
              { internalType: "address", name: "factory", type: "address" },
              { internalType: "address", name: "operateImplementation", type: "address" },
              { internalType: "address", name: "adminImplementation", type: "address" },
              { internalType: "address", name: "secondaryImplementation", type: "address" },
              { internalType: "address", name: "deployer", type: "address" },
              { internalType: "address", name: "supply", type: "address" },
              { internalType: "address", name: "borrow", type: "address" },
              {
                components: [
                  { internalType: "address", name: "token0", type: "address" },
                  { internalType: "address", name: "token1", type: "address" },
                ],
                internalType: "struct IFluidVault.Tokens",
                name: "supplyToken",
                type: "tuple",
              },
              {
                components: [
                  { internalType: "address", name: "token0", type: "address" },
                  { internalType: "address", name: "token1", type: "address" },
                ],
                internalType: "struct IFluidVault.Tokens",
                name: "borrowToken",
                type: "tuple",
              },
              { internalType: "uint256", name: "vaultId", type: "uint256" },
              { internalType: "uint256", name: "vaultType", type: "uint256" },
              { internalType: "bytes32", name: "supplyExchangePriceSlot", type: "bytes32" },
              { internalType: "bytes32", name: "borrowExchangePriceSlot", type: "bytes32" },
              { internalType: "bytes32", name: "userSupplySlot", type: "bytes32" },
              { internalType: "bytes32", name: "userBorrowSlot", type: "bytes32" },
            ],
            internalType: "struct IFluidVault.ConstantViews",
            name: "constantVariables",
            type: "tuple",
          },
          {
            components: [
              { internalType: "uint16", name: "supplyRateMagnifier", type: "uint16" },
              { internalType: "uint16", name: "borrowRateMagnifier", type: "uint16" },
              { internalType: "uint16", name: "collateralFactor", type: "uint16" },
              { internalType: "uint16", name: "liquidationThreshold", type: "uint16" },
              { internalType: "uint16", name: "liquidationMaxLimit", type: "uint16" },
              { internalType: "uint16", name: "withdrawalGap", type: "uint16" },
              { internalType: "uint16", name: "liquidationPenalty", type: "uint16" },
              { internalType: "uint16", name: "borrowFee", type: "uint16" },
              { internalType: "address", name: "oracle", type: "address" },
              { internalType: "uint256", name: "oraclePriceOperate", type: "uint256" },
              { internalType: "uint256", name: "oraclePriceLiquidate", type: "uint256" },
              { internalType: "address", name: "rebalancer", type: "address" },
              { internalType: "uint256", name: "lastUpdateTimestamp", type: "uint256" },
            ],
            internalType: "struct Structs.Configs",
            name: "configs",
            type: "tuple",
          },
          {
            components: [
              { internalType: "uint256", name: "lastStoredLiquiditySupplyExchangePrice", type: "uint256" },
              { internalType: "uint256", name: "lastStoredLiquidityBorrowExchangePrice", type: "uint256" },
              { internalType: "uint256", name: "lastStoredVaultSupplyExchangePrice", type: "uint256" },
              { internalType: "uint256", name: "lastStoredVaultBorrowExchangePrice", type: "uint256" },
              { internalType: "uint256", name: "liquiditySupplyExchangePrice", type: "uint256" },
              { internalType: "uint256", name: "liquidityBorrowExchangePrice", type: "uint256" },
              { internalType: "uint256", name: "vaultSupplyExchangePrice", type: "uint256" },
              { internalType: "uint256", name: "vaultBorrowExchangePrice", type: "uint256" },
              { internalType: "uint256", name: "supplyRateLiquidity", type: "uint256" },
              { internalType: "uint256", name: "borrowRateLiquidity", type: "uint256" },
              { internalType: "int256", name: "supplyRateVault", type: "int256" },
              { internalType: "int256", name: "borrowRateVault", type: "int256" },
              { internalType: "int256", name: "rewardsOrFeeRateSupply", type: "int256" },
              { internalType: "int256", name: "rewardsOrFeeRateBorrow", type: "int256" },
            ],
            internalType: "struct Structs.ExchangePricesAndRates",
            name: "exchangePricesAndRates",
            type: "tuple",
          },
          {
            components: [
              { internalType: "uint256", name: "totalSupplyVault", type: "uint256" },
              { internalType: "uint256", name: "totalBorrowVault", type: "uint256" },
              { internalType: "uint256", name: "totalSupplyLiquidityOrDex", type: "uint256" },
              { internalType: "uint256", name: "totalBorrowLiquidityOrDex", type: "uint256" },
              { internalType: "uint256", name: "absorbedSupply", type: "uint256" },
              { internalType: "uint256", name: "absorbedBorrow", type: "uint256" },
            ],
            internalType: "struct Structs.TotalSupplyAndBorrow",
            name: "totalSupplyAndBorrow",
            type: "tuple",
          },
          {
            components: [
              { internalType: "uint256", name: "withdrawLimit", type: "uint256" },
              { internalType: "uint256", name: "withdrawableUntilLimit", type: "uint256" },
              { internalType: "uint256", name: "withdrawable", type: "uint256" },
              { internalType: "uint256", name: "borrowLimit", type: "uint256" },
              { internalType: "uint256", name: "borrowableUntilLimit", type: "uint256" },
              { internalType: "uint256", name: "borrowable", type: "uint256" },
              { internalType: "uint256", name: "borrowLimitUtilization", type: "uint256" },
              { internalType: "uint256", name: "minimumBorrowing", type: "uint256" },
            ],
            internalType: "struct Structs.LimitsAndAvailability",
            name: "limitsAndAvailability",
            type: "tuple",
          },
          {
            components: [
              { internalType: "uint256", name: "totalPositions", type: "uint256" },
              { internalType: "int256", name: "topTick", type: "int256" },
              { internalType: "uint256", name: "currentBranch", type: "uint256" },
              { internalType: "uint256", name: "totalBranch", type: "uint256" },
              { internalType: "uint256", name: "totalBorrow", type: "uint256" },
              { internalType: "uint256", name: "totalSupply", type: "uint256" },
              {
                components: [
                  { internalType: "uint256", name: "status", type: "uint256" },
                  { internalType: "int256", name: "minimaTick", type: "int256" },
                  { internalType: "uint256", name: "debtFactor", type: "uint256" },
                  { internalType: "uint256", name: "partials", type: "uint256" },
                  { internalType: "uint256", name: "debtLiquidity", type: "uint256" },
                  { internalType: "uint256", name: "baseBranchId", type: "uint256" },
                  { internalType: "int256", name: "baseBranchMinima", type: "int256" },
                ],
                internalType: "struct Structs.CurrentBranchState",
                name: "currentBranchState",
                type: "tuple",
              },
            ],
            internalType: "struct Structs.VaultState",
            name: "vaultState",
            type: "tuple",
          },
          {
            components: [
              { internalType: "bool", name: "modeWithInterest", type: "bool" },
              { internalType: "uint256", name: "supply", type: "uint256" },
              { internalType: "uint256", name: "withdrawalLimit", type: "uint256" },
              { internalType: "uint256", name: "lastUpdateTimestamp", type: "uint256" },
              { internalType: "uint256", name: "expandPercent", type: "uint256" },
              { internalType: "uint256", name: "expandDuration", type: "uint256" },
              { internalType: "uint256", name: "baseWithdrawalLimit", type: "uint256" },
              { internalType: "uint256", name: "withdrawableUntilLimit", type: "uint256" },
              { internalType: "uint256", name: "withdrawable", type: "uint256" },
              { internalType: "uint256", name: "decayEndTimestamp", type: "uint256" },
              { internalType: "uint256", name: "decayAmount", type: "uint256" },
            ],
            internalType: "struct Structs.UserSupplyData",
            name: "liquidityUserSupplyData",
            type: "tuple",
          },
          {
            components: [
              { internalType: "bool", name: "modeWithInterest", type: "bool" },
              { internalType: "uint256", name: "borrow", type: "uint256" },
              { internalType: "uint256", name: "borrowLimit", type: "uint256" },
              { internalType: "uint256", name: "lastUpdateTimestamp", type: "uint256" },
              { internalType: "uint256", name: "expandPercent", type: "uint256" },
              { internalType: "uint256", name: "expandDuration", type: "uint256" },
              { internalType: "uint256", name: "baseBorrowLimit", type: "uint256" },
              { internalType: "uint256", name: "maxBorrowLimit", type: "uint256" },
              { internalType: "uint256", name: "borrowableUntilLimit", type: "uint256" },
              { internalType: "uint256", name: "borrowable", type: "uint256" },
              { internalType: "uint256", name: "borrowLimitUtilization", type: "uint256" },
            ],
            internalType: "struct Structs.UserBorrowData",
            name: "liquidityUserBorrowData",
            type: "tuple",
          },
        ],
        internalType: "struct Structs.VaultEntireData[]",
        name: "vaultsData_",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const LENDING_RESOLVER_ABI = [
  {
    inputs: [{ internalType: "address", name: "user_", type: "address" }],
    name: "getUserPositions",
    outputs: [
      {
        components: [
          {
            components: [
              { internalType: "address", name: "tokenAddress", type: "address" },
              { internalType: "bool", name: "eip2612Deposits", type: "bool" },
              { internalType: "bool", name: "isNativeUnderlying", type: "bool" },
              { internalType: "string", name: "name", type: "string" },
              { internalType: "string", name: "symbol", type: "string" },
              { internalType: "uint256", name: "decimals", type: "uint256" },
              { internalType: "address", name: "asset", type: "address" },
              { internalType: "uint256", name: "totalAssets", type: "uint256" },
              { internalType: "uint256", name: "totalSupply", type: "uint256" },
              { internalType: "uint256", name: "convertToShares", type: "uint256" },
              { internalType: "uint256", name: "convertToAssets", type: "uint256" },
              { internalType: "uint256", name: "rewardsRate", type: "uint256" },
              { internalType: "uint256", name: "supplyRate", type: "uint256" },
              { internalType: "int256", name: "rebalanceDifference", type: "int256" },
              {
                components: [
                  { internalType: "bool", name: "modeWithInterest", type: "bool" },
                  { internalType: "uint256", name: "supply", type: "uint256" },
                  { internalType: "uint256", name: "withdrawalLimit", type: "uint256" },
                  { internalType: "uint256", name: "lastUpdateTimestamp", type: "uint256" },
                  { internalType: "uint256", name: "expandPercent", type: "uint256" },
                  { internalType: "uint256", name: "expandDuration", type: "uint256" },
                  { internalType: "uint256", name: "baseWithdrawalLimit", type: "uint256" },
                  { internalType: "uint256", name: "withdrawableUntilLimit", type: "uint256" },
                  { internalType: "uint256", name: "withdrawable", type: "uint256" },
                  { internalType: "uint256", name: "decayEndTimestamp", type: "uint256" },
                  { internalType: "uint256", name: "decayAmount", type: "uint256" },
                ],
                internalType: "struct Structs.UserSupplyData",
                name: "liquidityUserSupplyData",
                type: "tuple",
              },
            ],
            internalType: "struct Structs.FTokenDetails",
            name: "fTokenDetails",
            type: "tuple",
          },
          {
            components: [
              { internalType: "uint256", name: "fTokenShares", type: "uint256" },
              { internalType: "uint256", name: "underlyingAssets", type: "uint256" },
              { internalType: "uint256", name: "underlyingBalance", type: "uint256" },
              { internalType: "uint256", name: "allowance", type: "uint256" },
            ],
            internalType: "struct Structs.UserPosition",
            name: "userPosition",
            type: "tuple",
          },
        ],
        internalType: "struct Structs.FTokenDetailsUserPosition[]",
        name: "",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const ERC20_ABI = [
  { inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "decimals", outputs: [{ type: "uint8" }], stateMutability: "view", type: "function" },
];

const MC3_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "target", type: "address" },
          { internalType: "bytes", name: "callData", type: "bytes" },
        ],
        internalType: "struct Multicall3.Call[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "aggregate",
    outputs: [
      { internalType: "uint256", name: "blockNumber", type: "uint256" },
      { internalType: "bytes[]", name: "returnData", type: "bytes[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const CHAINLINK_ABI = [
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeAddress(addr: string): string {
  if (!addr || addr === ethers.constants.AddressZero) return "";
  if (addr.toLowerCase() === NATIVE_ETH.toLowerCase()) return WETH_ETH.toLowerCase();
  return addr.toLowerCase();
}

async function getEthPriceUsd(provider: ethers.providers.Provider): Promise<number> {
  try {
    const feed = new ethers.Contract(ETH_USD_FEED, CHAINLINK_ABI, provider);
    const round = await feed.latestRoundData();
    return Number(round.answer) / 1e8;
  } catch {
    return 0;
  }
}

// ── Chain fetcher ──────────────────────────────────────────────────────────────

async function fetchChainPositions(address: string, chainId: number, chainName: string, rpc: string) {
  const provider = createProvider(rpc, chainId);
  const mc3 = new ethers.Contract(MULTICALL3, MC3_ABI, provider);
  const vaultResolver = new ethers.Contract(FLUID_VAULT_RESOLVER, VAULT_RESOLVER_ABI, provider);
  const lendingResolver = new ethers.Contract(FLUID_LENDING_RESOLVER, LENDING_RESOLVER_ABI, provider);

  // Parallel: vault positions + lending positions + ETH price (only on Ethereum)
  const [vaultResult, lendingResult, ethPriceUsd] = await Promise.all([
    vaultResolver.positionsByUser(address).catch(() => [[], []]),
    lendingResolver.getUserPositions(address).catch(() => []),
    chainId === 1 ? getEthPriceUsd(provider) : Promise.resolve(0),
  ]);

  const [userPositions, vaultsData] = vaultResult as [any[], any[]];
  const lendingPositions = lendingResult as any[];

  const results: any[] = [];

  // ── Vault positions ──────────────────────────────────────────────────────────

  // Collect unique token addresses for ERC20 metadata batch call
  const tokenSet = new Set<string>();
  const vaultItems: { pos: any; vault: any }[] = [];

  for (let i = 0; i < userPositions.length; i++) {
    const pos = userPositions[i];
    const vault = vaultsData[i];
    if (!vault) continue;

    // Skip smart col/debt (DEX-based vaults — complex T2/T3/T4 vaults)
    if (vault.isSmartCol || vault.isSmartDebt) continue;
    // Skip liquidated positions
    if (pos.isLiquidated) continue;
    // Skip zero positions
    if (pos.supply.isZero() && pos.borrow.isZero()) continue;

    const colAddr = normalizeAddress(vault.constantVariables.supplyToken.token0);
    const debtAddr = normalizeAddress(vault.constantVariables.borrowToken.token0);
    if (colAddr) tokenSet.add(colAddr);
    if (debtAddr) tokenSet.add(debtAddr);
    vaultItems.push({ pos, vault });
  }

  // Batch ERC20 symbol + decimals for all unique tokens
  const tokenAddrs = Array.from(tokenSet);
  const erc20Iface = new ethers.utils.Interface(ERC20_ABI);
  const symbolData = erc20Iface.encodeFunctionData("symbol");
  const decimalsData = erc20Iface.encodeFunctionData("decimals");

  const tokenMeta: Record<string, { symbol: string; decimals: number }> = {};

  if (tokenAddrs.length > 0) {
    const calls = tokenAddrs.flatMap((addr) => [
      { target: addr, callData: symbolData },
      { target: addr, callData: decimalsData },
    ]);
    try {
      const { returnData } = await mc3.aggregate(calls);
      for (let i = 0; i < tokenAddrs.length; i++) {
        const addr = tokenAddrs[i];
        try {
          const sym = erc20Iface.decodeFunctionResult("symbol", returnData[i * 2])[0] as string;
          const dec = erc20Iface.decodeFunctionResult("decimals", returnData[i * 2 + 1])[0] as number;
          tokenMeta[addr] = { symbol: sym, decimals: dec };
        } catch {
          tokenMeta[addr] = { symbol: addr.slice(0, 8), decimals: 18 };
        }
      }
    } catch {
      // fallback: unknown metadata
    }
  }

  // Process vault positions
  for (const { pos, vault } of vaultItems) {
    const colAddr = normalizeAddress(vault.constantVariables.supplyToken.token0);
    const debtAddr = normalizeAddress(vault.constantVariables.borrowToken.token0);
    const colMeta = tokenMeta[colAddr] ?? { symbol: "?", decimals: 18 };
    const debtMeta = tokenMeta[debtAddr] ?? { symbol: "?", decimals: 18 };

    const supplyTokens = parseFloat(ethers.utils.formatUnits(pos.supply, colMeta.decimals));
    const borrowTokens = parseFloat(ethers.utils.formatUnits(pos.borrow, debtMeta.decimals));

    const liqThresholdBps = Number(vault.configs.liquidationThreshold); // e.g. 8500
    const colFactorBps = Number(vault.configs.collateralFactor);       // e.g. 8000
    const liqThreshold = liqThresholdBps / 10000;
    const colFactor = colFactorBps / 10000;

    // oraclePriceOperate = debt_raw per col_raw × 1e27
    const oraclePriceBN: ethers.BigNumber = vault.configs.oraclePriceOperate;
    const oraclePrice = parseFloat(ethers.utils.formatUnits(oraclePriceBN, 27));

    // Derive USD prices
    // oraclePrice (in raw units) = debtRaw per colRaw
    // To get USD: oraclePrice × 10^colDecimals / 10^debtDecimals = debtUnits per colUnit
    const debtPerCol = oraclePrice * Math.pow(10, colMeta.decimals) / Math.pow(10, debtMeta.decimals);

    let debtPriceUsd: number | null = STABLE_PRICES[debtAddr] ?? null;
    let colPriceUsd: number | null = null;

    // ETH-based collateral → use Chainlink ETH price if available
    if (chainId === 1 && ethPriceUsd > 0) {
      const ethLike = [
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
        "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", // wstETH (approx same as ETH for display)
        "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // stETH
        "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee", // weETH
        "0xbf5495efe5db9ce00f80364c8b423567e58d2110", // ezETH
        "0xfae103dc9cf190ed75350761e95403b7b8afa6c0", // rswETH
      ];
      if (ethLike.includes(colAddr)) colPriceUsd = ethPriceUsd;
    }

    // Derive missing price from oracle
    if (colPriceUsd === null && debtPriceUsd !== null && debtPerCol !== 0) {
      colPriceUsd = debtPriceUsd * debtPerCol;
    }
    if (debtPriceUsd === null && colPriceUsd !== null && debtPerCol !== 0) {
      debtPriceUsd = colPriceUsd / debtPerCol;
    }

    const supplyUsd = colPriceUsd !== null ? supplyTokens * colPriceUsd : null;
    const borrowUsd = debtPriceUsd !== null ? borrowTokens * debtPriceUsd : null;

    // Health factor: use oracle for accuracy, fall back to USD-based
    let healthFactor: number | null = null;
    if (borrowTokens > 0) {
      if (!oraclePriceBN.isZero()) {
        // HF = supply × oraclePrice × liqThreshold / (borrow × 1e27)
        // where supply and borrow are in raw token units
        const supplyRaw = pos.supply as ethers.BigNumber;
        const borrowRaw = pos.borrow as ethers.BigNumber;
        // Use BigInt arithmetic to avoid precision loss
        try {
          const numerator = supplyRaw.mul(oraclePriceBN).mul(liqThresholdBps);
          const denominator = borrowRaw.mul(ethers.BigNumber.from("10").pow(27)).mul(10000);
          const hfRay = numerator.mul(ethers.BigNumber.from("10").pow(18)).div(denominator);
          healthFactor = parseFloat(ethers.utils.formatUnits(hfRay, 18));
        } catch {
          if (supplyUsd !== null && borrowUsd !== null && borrowUsd > 0) {
            healthFactor = (supplyUsd * liqThreshold) / borrowUsd;
          }
        }
      } else if (supplyUsd !== null && borrowUsd !== null && borrowUsd > 0) {
        healthFactor = (supplyUsd * liqThreshold) / borrowUsd;
      }
    }

    const borrowApy = Number(vault.exchangePricesAndRates.borrowRateVault) / 10000;
    const supplyApy = Number(vault.exchangePricesAndRates.supplyRateVault) / 10000;

    results.push({
      id: pos.nftId.toString(),
      chainId,
      chainName,
      positionType: "vault",
      supplyAsset: {
        address: colAddr,
        symbol: colMeta.symbol,
        decimals: colMeta.decimals,
        priceUsd: colPriceUsd,
      },
      borrowAsset: {
        address: debtAddr,
        symbol: debtMeta.symbol,
        decimals: debtMeta.decimals,
        priceUsd: debtPriceUsd,
      },
      supplyTokens,
      borrowTokens,
      supplyUsd,
      borrowUsd,
      collateralFactor: colFactor,
      liquidationThreshold: liqThreshold,
      healthFactor,
      borrowApy,
      supplyApy,
      // lending fields (unused for vault)
      lendingAsset: null,
      lendingTokens: 0,
      lendingUsd: null,
    });
  }

  // ── Lending (fToken) positions ────────────────────────────────────────────────

  for (const item of lendingPositions) {
    const details = item.fTokenDetails;
    const userPos = item.userPosition;
    if (!details || !userPos) continue;

    const underlyingAssets: ethers.BigNumber = userPos.underlyingAssets;
    if (underlyingAssets.isZero()) continue;

    const decimals = Number(details.decimals);
    const lendingTokens = parseFloat(ethers.utils.formatUnits(underlyingAssets, decimals));
    if (lendingTokens <= 0) continue;

    const assetAddr = normalizeAddress(details.asset);
    const symbol = details.symbol as string; // e.g. "fUSDC"
    // Strip the leading 'f' to get underlying token symbol
    const underlyingSymbol = symbol.startsWith("f") ? symbol.slice(1) : symbol;

    let lendingPriceUsd: number | null = STABLE_PRICES[assetAddr] ?? null;
    if (lendingPriceUsd === null && chainId === 1 && ethPriceUsd > 0) {
      const ethLike = [
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
        "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
        "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee",
      ];
      if (ethLike.includes(assetAddr)) lendingPriceUsd = ethPriceUsd;
    }

    const lendingUsd = lendingPriceUsd !== null ? lendingTokens * lendingPriceUsd : null;
    // supplyRate is in 1e2 BPS format: 1% = 100 → /10000 = decimal
    const supplyApy = Number(details.supplyRate) / 10000;

    results.push({
      id: details.tokenAddress as string,
      chainId,
      chainName,
      positionType: "lending",
      supplyAsset: null,
      borrowAsset: null,
      supplyTokens: 0,
      borrowTokens: 0,
      supplyUsd: null,
      borrowUsd: null,
      collateralFactor: 0,
      liquidationThreshold: 0,
      healthFactor: null,
      borrowApy: 0,
      supplyApy,
      lendingAsset: {
        address: assetAddr,
        symbol: underlyingSymbol,
        decimals,
        priceUsd: lendingPriceUsd,
      },
      lendingTokens,
      lendingUsd,
    });
  }

  return results;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { address } = req.query;
  if (!address || typeof address !== "string") {
    return res.status(400).json({ error: "address is required" });
  }

  const settled = await Promise.allSettled(
    CHAINS.map(({ chainId, chainName, rpc }) =>
      fetchChainPositions(address, chainId, chainName, rpc)
    )
  );

  const positions: any[] = [];
  const errors: string[] = [];

  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      positions.push(...result.value);
    } else {
      errors.push(`${CHAINS[i].chainName}: ${(result.reason as Error).message}`);
    }
  });

  return res.status(200).json({ positions, errors });
}
