import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { createProvider } from "../../../lib/provider";

// ── Comet (Compound v3) ABI — only what we need ────────────────────────────
const COMET_ABI = [
  "function numAssets() external view returns (uint8)",
  "function getAssetInfo(uint8 i) external view returns (tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))",
  "function borrowBalanceOf(address account) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function userCollateral(address account, address asset) external view returns (tuple(uint128 balance, uint128 _reserved))",
  "function getPrice(address priceFeed) external view returns (uint128)",
  "function baseTokenPriceFeed() external view returns (address)",
  "function decimals() external view returns (uint8)",
];

const ERC20_ABI = [
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function name() external view returns (string)",
];

// ── Market registry ─────────────────────────────────────────────────────────
const COMPOUND_MARKETS = [
  {
    id: "ETH_USDC",
    chainId: 1,
    chainName: "Ethereum",
    rpc: "https://ethereum-rpc.publicnode.com",
    comet: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
    baseSymbol: "USDC",
    baseDecimals: 6,
  },
  {
    id: "ETH_WETH",
    chainId: 1,
    chainName: "Ethereum",
    rpc: "https://ethereum-rpc.publicnode.com",
    comet: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
    baseSymbol: "WETH",
    baseDecimals: 18,
  },
  {
    id: "ETH_USDT",
    chainId: 1,
    chainName: "Ethereum",
    rpc: "https://ethereum-rpc.publicnode.com",
    comet: "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840",
    baseSymbol: "USDT",
    baseDecimals: 6,
  },
  {
    id: "BASE_USDC",
    chainId: 8453,
    chainName: "Base",
    rpc: "https://base-rpc.publicnode.com",
    comet: "0xb125E6687d4313864e53df431d5425969c15Eb2",
    baseSymbol: "USDC",
    baseDecimals: 6,
  },
  {
    id: "BASE_WETH",
    chainId: 8453,
    chainName: "Base",
    rpc: "https://base-rpc.publicnode.com",
    comet: "0x46e6b214b524310239732D51387075E0e70970bf",
    baseSymbol: "WETH",
    baseDecimals: 18,
  },
  {
    id: "ARB_USDC",
    chainId: 42161,
    chainName: "Arbitrum",
    rpc: "https://arbitrum-one-rpc.publicnode.com",
    comet: "0xA5EDBDD9646f8dEA95cB3f9c5B8e4CC36F1eDaC4",
    baseSymbol: "USDC",
    baseDecimals: 6,
  },
];

type Market = typeof COMPOUND_MARKETS[0];

// ── Fetch one market's position for a given address ──────────────────────────
async function fetchMarketPosition(address: string, market: Market) {
  const provider = createProvider(market.rpc, market.chainId);
  const comet = new ethers.Contract(market.comet, COMET_ABI, provider);

  // Round 1 — quick check: any activity?
  const [borrowBalance, supplyBalance] = await Promise.all([
    comet.borrowBalanceOf(address) as Promise<ethers.BigNumber>,
    comet.balanceOf(address) as Promise<ethers.BigNumber>,
  ]);
  if (borrowBalance.isZero() && supplyBalance.isZero()) return null;

  // Round 2 — market metadata
  const [numAssets, baseTokenPriceFeed] = await Promise.all([
    comet.numAssets() as Promise<number>,
    comet.baseTokenPriceFeed() as Promise<string>,
  ]);

  // Round 3 — base price + all asset infos in parallel
  const assetIndices = Array.from({ length: numAssets }, (_, i) => i);
  const [basePrice, ...assetInfos] = await Promise.all([
    comet.getPrice(baseTokenPriceFeed) as Promise<ethers.BigNumber>,
    ...assetIndices.map((i) => comet.getAssetInfo(i)),
  ]);

  const basePriceUsd = parseFloat(ethers.utils.formatUnits(basePrice, 8));
  const borrowTokens = parseFloat(ethers.utils.formatUnits(borrowBalance, market.baseDecimals));
  const supplyTokens = parseFloat(ethers.utils.formatUnits(supplyBalance, market.baseDecimals));

  // Round 4 — collateral balances + prices + ERC20 info in parallel
  const [collateralBalances, assetPrices, erc20Infos] = await Promise.all([
    Promise.all(assetInfos.map((info: any) => comet.userCollateral(address, info.asset))),
    Promise.all(assetInfos.map((info: any) => comet.getPrice(info.priceFeed) as Promise<ethers.BigNumber>)),
    Promise.all(
      assetInfos.map(async (info: any) => {
        const erc20 = new ethers.Contract(info.asset, ERC20_ABI, provider);
        try {
          const [symbol, decimals, name] = await Promise.all([
            erc20.symbol(),
            erc20.decimals(),
            erc20.name(),
          ]);
          return { symbol: String(symbol), decimals: Number(decimals), name: String(name) };
        } catch {
          return { symbol: "???", decimals: 18, name: "Unknown" };
        }
      })
    ),
  ]);

  // Build collateral list (only assets with a balance)
  const collaterals = assetInfos
    .map((info: any, i: number) => {
      const balance: ethers.BigNumber = collateralBalances[i].balance;
      const price: ethers.BigNumber = assetPrices[i];
      const { symbol, decimals, name } = erc20Infos[i];

      const balanceTokens = parseFloat(ethers.utils.formatUnits(balance, decimals));
      if (balanceTokens < 1e-10) return null;

      const priceUsd = parseFloat(ethers.utils.formatUnits(price, 8));
      const valueUsd = balanceTokens * priceUsd;
      const liquidateCollateralFactor = parseFloat(
        ethers.utils.formatUnits(info.liquidateCollateralFactor, 18)
      );

      return {
        asset: String(info.asset),
        symbol,
        name,
        decimals,
        priceUsd,
        balanceTokens,
        valueUsd,
        liquidateCollateralFactor,
        liquidationValueUsd: valueUsd * liquidateCollateralFactor,
      };
    })
    .filter(Boolean) as NonNullable<ReturnType<typeof mapCollateral>>[];

  // Health factor = total liquidation value (USD) / borrow value (USD)
  const totalLiquidationValueUsd = collaterals.reduce((s, c) => s + c.liquidationValueUsd, 0);
  const borrowUsd = borrowTokens * basePriceUsd;
  const healthFactor = borrowUsd > 0 ? totalLiquidationValueUsd / borrowUsd : null;

  return {
    marketId: market.id,
    chainId: market.chainId,
    chainName: market.chainName,
    baseSymbol: market.baseSymbol,
    baseDecimals: market.baseDecimals,
    basePriceUsd,
    borrowTokens,
    borrowUsd,
    supplyTokens,
    supplyUsd: supplyTokens * basePriceUsd,
    collaterals,
    healthFactor,
  };
}

// Dummy type helper so TypeScript doesn't complain about the filter(Boolean)
function mapCollateral(x: {
  asset: string; symbol: string; name: string; decimals: number;
  priceUsd: number; balanceTokens: number; valueUsd: number;
  liquidateCollateralFactor: number; liquidationValueUsd: number;
}) { return x; }

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { address } = req.query;
  if (!address || typeof address !== "string") {
    return res.status(400).json({ error: "address is required" });
  }

  const results = await Promise.allSettled(
    COMPOUND_MARKETS.map((market) => fetchMarketPosition(address, market))
  );

  const positions: any[] = [];
  const errors: string[] = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      if (result.value) positions.push(result.value);
    } else {
      const msg = (result.reason as Error).message;
      errors.push(`${COMPOUND_MARKETS[i].chainName} ${COMPOUND_MARKETS[i].baseSymbol}: ${msg}`);
    }
  });

  return res.status(200).json({ positions, errors });
}
