import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { createProvider } from "../../../lib/provider";

const COMET_IFACE = new ethers.utils.Interface([
  "function numAssets() external view returns (uint8)",
  "function getAssetInfo(uint8 i) external view returns (tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))",
  "function borrowBalanceOf(address account) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function collateralBalanceOf(address account, address asset) external view returns (uint128)",
  "function getPrice(address priceFeed) external view returns (uint128)",
  "function baseTokenPriceFeed() external view returns (address)",
]);

const ERC20_IFACE = new ethers.utils.Interface([
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function name() external view returns (string)",
]);

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external view returns (tuple(bool success, bytes returnData)[] returnData)",
];

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

// ── Market registry ─────────────────────────────────────────────────────────
const COMPOUND_MARKETS = [
  {
    id: "ETH_USDC",
    chainId: 1,
    chainName: "Ethereum",
    rpc: "https://ethereum-rpc.publicnode.com",
    comet: "0xc3d688b66703497daa19211eedff47f25384cdc3",
    baseSymbol: "USDC",
    baseDecimals: 6,
  },
  {
    id: "ETH_WETH",
    chainId: 1,
    chainName: "Ethereum",
    rpc: "https://ethereum-rpc.publicnode.com",
    comet: "0xa17581a9e3356d9a858b789d68b4d866e593ae94",
    baseSymbol: "WETH",
    baseDecimals: 18,
  },
  {
    id: "ETH_USDT",
    chainId: 1,
    chainName: "Ethereum",
    rpc: "https://ethereum-rpc.publicnode.com",
    comet: "0x3afdc9bca9213a35503b077a6072f3d0d5ab0840",
    baseSymbol: "USDT",
    baseDecimals: 6,
  },
  {
    id: "BASE_USDC",
    chainId: 8453,
    chainName: "Base",
    rpc: "https://base-rpc.publicnode.com",
    comet: "0xb125e6687d4313864e53df431d5425969c15eb2f",
    baseSymbol: "USDC",
    baseDecimals: 6,
  },
  {
    id: "BASE_WETH",
    chainId: 8453,
    chainName: "Base",
    rpc: "https://base-rpc.publicnode.com",
    comet: "0x46e6b214b524310239732d51387075e0e70970bf",
    baseSymbol: "WETH",
    baseDecimals: 18,
  },
  {
    id: "BASE_USDbC",
    chainId: 8453,
    chainName: "Base",
    rpc: "https://base-rpc.publicnode.com",
    comet: "0x9c4ec768c28520b50860ea7a15bd7213a9ff58bf",
    baseSymbol: "USDbC",
    baseDecimals: 6,
  },
  {
    id: "ARB_USDC",
    chainId: 42161,
    chainName: "Arbitrum",
    rpc: "https://arbitrum-one-rpc.publicnode.com",
    comet: "0xa5edbdd9646f8dea95cb3f9c5b8e4cc36f1edac4",
    baseSymbol: "USDC",
    baseDecimals: 6,
  },
  {
    id: "OP_USDC",
    chainId: 10,
    chainName: "Optimism",
    rpc: "https://optimism-rpc.publicnode.com",
    comet: "0x2e44e174f7d53f0212823acc11c01a11d58c5bcb",
    baseSymbol: "USDC",
    baseDecimals: 6,
  },
  {
    id: "OP_WETH",
    chainId: 10,
    chainName: "Optimism",
    rpc: "https://optimism-rpc.publicnode.com",
    comet: "0xe36a30d249f7761337cb7da3498c267925f8c3b4",
    baseSymbol: "WETH",
    baseDecimals: 18,
  },
];

type Market = typeof COMPOUND_MARKETS[0];

function call(target: string, iface: ethers.utils.Interface, fn: string, args: any[] = [], allowFailure = false) {
  return { target, allowFailure, callData: iface.encodeFunctionData(fn, args) };
}

function decode(iface: ethers.utils.Interface, fn: string, data: string) {
  return iface.decodeFunctionResult(fn, data);
}

// ── Fetch one market via Multicall3 (4 round-trips max) ──────────────────────
async function fetchMarketPosition(address: string, market: Market) {
  const provider = createProvider(market.rpc, market.chainId);
  const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);
  const comet = market.comet;

  // Round 1 — borrow + supply balances
  // If Multicall3 itself fails (e.g. RPC returns 0x for no-position accounts), treat as no position
  let r1: any[];
  try {
    r1 = await mc.aggregate3([
      call(comet, COMET_IFACE, "borrowBalanceOf", [address], true),
      call(comet, COMET_IFACE, "balanceOf", [address], true),
    ]);
  } catch {
    return null;
  }

  const hasData = (r: any) => r.success && r.returnData && r.returnData !== "0x";

  const borrowBalance: ethers.BigNumber = hasData(r1[0])
    ? decode(COMET_IFACE, "borrowBalanceOf", r1[0].returnData)[0]
    : ethers.BigNumber.from(0);
  const supplyBalance: ethers.BigNumber = hasData(r1[1])
    ? decode(COMET_IFACE, "balanceOf", r1[1].returnData)[0]
    : ethers.BigNumber.from(0);

  if (borrowBalance.isZero() && supplyBalance.isZero()) return null;

  // Round 2 — market metadata
  const r2 = await mc.aggregate3([
    call(comet, COMET_IFACE, "numAssets"),
    call(comet, COMET_IFACE, "baseTokenPriceFeed"),
  ]);

  const numAssets: number = decode(COMET_IFACE, "numAssets", r2[0].returnData)[0];
  const baseTokenPriceFeed: string = decode(COMET_IFACE, "baseTokenPriceFeed", r2[1].returnData)[0];

  // Round 3 — base price + all asset infos
  const assetIndices = Array.from({ length: numAssets }, (_, i) => i);
  const r3 = await mc.aggregate3([
    call(comet, COMET_IFACE, "getPrice", [baseTokenPriceFeed]),
    ...assetIndices.map((i) => call(comet, COMET_IFACE, "getAssetInfo", [i])),
  ]);

  const basePrice: ethers.BigNumber = decode(COMET_IFACE, "getPrice", r3[0].returnData)[0];
  const assetInfos = assetIndices.map((_, i) =>
    decode(COMET_IFACE, "getAssetInfo", r3[i + 1].returnData)[0]
  );

  const basePriceUsd = parseFloat(ethers.utils.formatUnits(basePrice, 8));
  const borrowTokens = parseFloat(ethers.utils.formatUnits(borrowBalance, market.baseDecimals));
  const supplyTokens = parseFloat(ethers.utils.formatUnits(supplyBalance, market.baseDecimals));

  // Round 4 — per-asset: collateral balance + price + ERC20 info (5 calls per asset)
  const r4Calls: any[] = [];
  for (const info of assetInfos) {
    const asset: string = info.asset.toLowerCase();
    r4Calls.push(call(comet, COMET_IFACE, "collateralBalanceOf", [address, info.asset], true));
    r4Calls.push(call(comet, COMET_IFACE, "getPrice", [info.priceFeed], true));
    r4Calls.push(call(asset, ERC20_IFACE, "symbol", [], true));
    r4Calls.push(call(asset, ERC20_IFACE, "decimals", [], true));
    r4Calls.push(call(asset, ERC20_IFACE, "name", [], true));
  }

  const r4 = await mc.aggregate3(r4Calls);

  const collaterals: any[] = [];
  for (let i = 0; i < assetInfos.length; i++) {
    const base = i * 5;
    const info = assetInfos[i];

    const balanceBN: ethers.BigNumber = r4[base].success
      ? decode(COMET_IFACE, "collateralBalanceOf", r4[base].returnData)[0]
      : ethers.BigNumber.from(0);

    const priceBN: ethers.BigNumber = r4[base + 1].success
      ? decode(COMET_IFACE, "getPrice", r4[base + 1].returnData)[0]
      : ethers.BigNumber.from(0);

    const symbol: string = r4[base + 2].success
      ? decode(ERC20_IFACE, "symbol", r4[base + 2].returnData)[0]
      : "???";
    const decimals: number = r4[base + 3].success
      ? decode(ERC20_IFACE, "decimals", r4[base + 3].returnData)[0]
      : 18;
    const name: string = r4[base + 4].success
      ? decode(ERC20_IFACE, "name", r4[base + 4].returnData)[0]
      : "Unknown";

    const balanceTokens = parseFloat(ethers.utils.formatUnits(balanceBN, decimals));
    if (balanceTokens < 1e-10) continue;

    const priceUsd = parseFloat(ethers.utils.formatUnits(priceBN, 8));
    const valueUsd = balanceTokens * priceUsd;
    const liquidateCollateralFactor = parseFloat(
      ethers.utils.formatUnits(info.liquidateCollateralFactor, 18)
    );

    collaterals.push({
      asset: String(info.asset),
      symbol,
      name,
      decimals,
      priceUsd,
      balanceTokens,
      valueUsd,
      liquidateCollateralFactor,
      liquidationValueUsd: valueUsd * liquidateCollateralFactor,
    });
  }

  const totalLiquidationValueUsd = collaterals.reduce((s: number, c: any) => s + c.liquidationValueUsd, 0);
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

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { address } = req.query;
  if (!address || typeof address !== "string") {
    return res.status(400).json({ error: "address is required" });
  }

  // Wrap each market fetch so RPC/timeout failures silently return null
  const safeResults = await Promise.all(
    COMPOUND_MARKETS.map((market) =>
      fetchMarketPosition(address, market).catch(() => null)
    )
  );

  const positions = safeResults.filter(Boolean);

  return res.status(200).json({ positions, errors: [] });
}
