import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { createProvider } from "../../../lib/provider";

const ANCHOR_VAULT = "0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const NUM_SUB_ACCOUNTS = 5;

// Known prime vaults — fallback scan when EVC returns no collaterals
const PRIME_VAULTS = [
  "0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9",
  "0xD8b27CF359b7D15710a5BE299AF6e7Bf904984C2",
  "0x313603FA690301b0CaeEf8069c065862f9162162",
  "0x998D761eC1BAdaCeb064624cc3A1d37A46C88bA4",
  "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee",
  "0x83F20F44975D03b1b09e64809B757c47f942BEeA",
];

// ── ABIs ────────────────────────────────────────────────────────────────────

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
];

const EVAULT_ABI = [
  "function EVC() view returns (address)",
  "function asset() view returns (address)",
  "function debtOf(address account) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function LTVFull(address collateral) view returns (uint16 borrowLTV, uint16 liquidationLTV, uint16 initialLiquidationLTV, uint48 targetTimestamp, uint32 rampDuration)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function oracle() view returns (address)",
  "function unitOfAccount() view returns (address)",
];

const EVC_ABI = [
  "function getControllers(address account) view returns (address[])",
  "function getCollaterals(address account) view returns (address[])",
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const CHAINLINK_ABI = [
  "function latestAnswer() view returns (int256)",
  "function decimals() view returns (uint8)",
];

const PRICE_ORACLE_ABI = [
  "function getQuote(uint256 inAmount, address base, address quote) view returns (uint256 outAmount)",
];

// ── Price data ───────────────────────────────────────────────────────────────

const CHAINLINK_FEEDS: Record<string, string> = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D",
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  "0x6b175474e89094c44da98b954eedeac495271d0f": "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9",
  "0x83f20f44975d03b1b09e64809b757c47f942beea": "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9",
  "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  // stablecoins priced at $1 — handled in getUsdPrice directly
};

const STABLE_TOKENS = new Set([
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "0x6c3ea9036406852006290770bedfcaba0e23a0e8", // PYUSD
  "0x8f1960098c4dC5EeEb33D3E288c5d9Ca3b82f92e".toLowerCase(), // RLUSD
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
]);

const USD_UNIT_OF_ACCOUNTS = new Set([
  "0x0000000000000000000000000000000000000348",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0x6b175474e89094c44da98b954eedeac495271d0f",
  "0xdac17f958d2ee523a2206206994597c13d831ec7",
]);

const VIRTUAL_USD = "0x0000000000000000000000000000000000000348";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSubAccountAddress(primary: string, subAccountId: number): string {
  const addr = BigInt(primary.toLowerCase());
  const lastByte = addr & BigInt(0xff);
  const prefix = addr & ~BigInt(0xff);
  const subAddr = prefix | (lastByte ^ BigInt(subAccountId));
  return ethers.utils.getAddress("0x" + subAddr.toString(16).padStart(40, "0"));
}

/** Batch multicall3 — returns raw hex returnData per call (empty string if failed) */
async function multicall(
  provider: ethers.providers.Provider,
  calls: Array<{ target: string; callData: string }>
): Promise<string[]> {
  const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);
  const results: Array<{ success: boolean; returnData: string }> = await mc.aggregate3(
    calls.map((c) => ({ target: c.target, allowFailure: true, callData: c.callData }))
  );
  return results.map((r) => (r.success ? r.returnData : "0x"));
}

async function getChainlinkPrice(feedAddress: string, provider: ethers.providers.Provider): Promise<number> {
  const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider);
  const [answer, dec] = await Promise.all([feed.latestAnswer(), feed.decimals()]);
  return Number(answer) / 10 ** Number(dec);
}

async function getUsdPrice(
  assetAddress: string,
  assetDecimals: number,
  oracleAddress: string | null,
  unitOfAccount: string | null,
  provider: ethers.providers.Provider,
  wethUsd: number
): Promise<number> {
  const assetLower = assetAddress.toLowerCase();

  if (STABLE_TOKENS.has(assetLower)) return 1.0;

  const feed = CHAINLINK_FEEDS[assetLower];
  if (feed) {
    try { return await getChainlinkPrice(feed, provider); } catch {}
  }

  if (oracleAddress && oracleAddress !== ethers.constants.AddressZero && unitOfAccount) {
    try {
      const oracle = new ethers.Contract(oracleAddress, PRICE_ORACLE_ABI, provider);
      const inAmount = ethers.BigNumber.from(10).pow(assetDecimals);
      const uoaLower = unitOfAccount.toLowerCase();
      const outAmount = await oracle.getQuote(inAmount, assetAddress, unitOfAccount);

      if (uoaLower === VIRTUAL_USD.toLowerCase()) return Number(outAmount) / 1e18;
      if (USD_UNIT_OF_ACCOUNTS.has(uoaLower)) {
        const isSmall = uoaLower === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
        return Number(outAmount) / 10 ** (isSmall ? 6 : 18);
      }
      if (uoaLower === WETH_ADDRESS.toLowerCase()) {
        return (Number(outAmount) / 1e18) * wethUsd;
      }
    } catch {}
  }
  return 0;
}

// ── Main handler ─────────────────────────────────────────────────────────────

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const address = req.query.address as string;
  if (!address || !ethers.utils.isAddress(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }

  const provider = createProvider("https://ethereum-rpc.publicnode.com", 1);
  const evaultIface = new ethers.utils.Interface(EVAULT_ABI);
  const erc20Iface = new ethers.utils.Interface(ERC20_ABI);
  const chainlinkIface = new ethers.utils.Interface(CHAINLINK_ABI);

  // ── 1. Bootstrap EVC address ──────────────────────────────────────────────
  const anchorVault = new ethers.Contract(ANCHOR_VAULT, EVAULT_ABI, provider);
  let evcAddress: string;
  try {
    evcAddress = await anchorVault.EVC();
  } catch {
    return res.status(500).json({ error: "Failed to connect to Euler v2" });
  }
  const evc = new ethers.Contract(evcAddress, EVC_ABI, provider);

  // Prefetch WETH price once (used as fallback for oracle conversions)
  const wethUsd = await getChainlinkPrice(
    CHAINLINK_FEEDS[WETH_ADDRESS.toLowerCase()], provider
  ).catch(() => 2500);

  // ── 2. Sub-accounts: controllers + collaterals ────────────────────────────
  const accounts = [
    address,
    ...Array.from({ length: NUM_SUB_ACCOUNTS - 1 }, (_, i) => getSubAccountAddress(address, i + 1)),
  ];

  const accountStates = await Promise.all(
    accounts.map(async (account, idx) => {
      const [controllers, collaterals] = await Promise.all([
        evc.getControllers(account).catch(() => [] as string[]),
        evc.getCollaterals(account).catch(() => [] as string[]),
      ]);
      return {
        account,
        subAccountId: idx,
        controllers: controllers as string[],
        collaterals: collaterals as string[],
      };
    })
  );

  const activeAccounts = accountStates.filter((a) => a.controllers.length > 0);
  const supplyOnlyAccounts = accountStates.filter((a) => a.controllers.length === 0);

  // ── 3. Supply-only positions (no borrow) ─────────────────────────────────
  // Batch balanceOf across all prime vaults × supply-only accounts
  const supplyOnlyPositions: any[] = [];
  if (supplyOnlyAccounts.length > 0) {
    const balCalls = supplyOnlyAccounts.flatMap((a) =>
      PRIME_VAULTS.map((v) => ({
        target: v,
        callData: evaultIface.encodeFunctionData("balanceOf", [a.account]),
      }))
    );
    const balResults = await multicall(provider, balCalls);

    for (let ai = 0; ai < supplyOnlyAccounts.length; ai++) {
      const { account, subAccountId } = supplyOnlyAccounts[ai];
      const found: Array<{ vault: string; shares: ethers.BigNumber }> = [];
      for (let vi = 0; vi < PRIME_VAULTS.length; vi++) {
        const raw = balResults[ai * PRIME_VAULTS.length + vi];
        if (raw === "0x" || raw === "0x" + "0".repeat(64)) continue;
        const shares = evaultIface.decodeFunctionResult("balanceOf", raw)[0] as ethers.BigNumber;
        if (!shares.isZero()) found.push({ vault: PRIME_VAULTS[vi], shares });
      }
      if (found.length === 0) continue;

      // Fetch vault info + assets
      const infoCalls = found.flatMap(({ vault, shares }) => [
        { target: vault, callData: evaultIface.encodeFunctionData("asset", []) },
        { target: vault, callData: evaultIface.encodeFunctionData("symbol", []) },
        { target: vault, callData: evaultIface.encodeFunctionData("oracle", []) },
        { target: vault, callData: evaultIface.encodeFunctionData("unitOfAccount", []) },
        { target: vault, callData: evaultIface.encodeFunctionData("convertToAssets", [shares]) },
      ]);
      const infoResults = await multicall(provider, infoCalls);

      const collaterals = await Promise.all(
        found.map(async ({ vault }, i) => {
          const base = i * 5;
          const tryDecode = (fn: string, data: string) => {
            try { return evaultIface.decodeFunctionResult(fn, data); } catch { return null; }
          };
          const assetAddress = tryDecode("asset", infoResults[base])?.[0] ?? "";
          const vaultSymbol = tryDecode("symbol", infoResults[base + 1])?.[0] ?? "?";
          const oracle = tryDecode("oracle", infoResults[base + 2])?.[0] ?? null;
          const uoa = tryDecode("unitOfAccount", infoResults[base + 3])?.[0] ?? null;
          const assets = tryDecode("convertToAssets", infoResults[base + 4])?.[0] as ethers.BigNumber | null;

          let assetSymbol = "?";
          let assetDecimals = 18;
          if (assetAddress) {
            const erc20 = new ethers.Contract(assetAddress, ERC20_ABI, provider);
            [assetSymbol, assetDecimals] = await Promise.all([
              erc20.symbol().catch(() => "?"),
              erc20.decimals().catch(() => 18),
            ]);
          }
          const tokens = assets ? Number(assets) / 10 ** assetDecimals : 0;
          const priceUsd = assetAddress ? await getUsdPrice(assetAddress, assetDecimals, oracle, uoa, provider, wethUsd) : 0;
          return { vaultAddress: vault, vaultSymbol, assetSymbol, tokens, priceUsd, valueUsd: tokens * priceUsd, liquidationLTV: 0, liquidationValueUsd: 0 };
        })
      );

      supplyOnlyPositions.push({
        subAccountId, account,
        liabilityVaultAddress: "", liabilityVaultSymbol: "",
        debtAssetSymbol: "", debtTokens: 0, debtPriceUsd: 0, debtUsd: 0,
        collaterals, healthFactor: -1,
      });
    }
  }

  if (activeAccounts.length === 0 && supplyOnlyPositions.length === 0) {
    return res.status(200).json({ positions: [] });
  }

  // ── 4. Borrow positions ───────────────────────────────────────────────────
  const borrowPositions = await Promise.all(
    activeAccounts.map(async ({ account, subAccountId, controllers, collaterals: evcCollaterals }) => {
      const liabilityVaultAddress = controllers[0];

      // Batch: liability vault info in one multicall
      const liabCalls = [
        { target: liabilityVaultAddress, callData: evaultIface.encodeFunctionData("debtOf", [account]) },
        { target: liabilityVaultAddress, callData: evaultIface.encodeFunctionData("asset", []) },
        { target: liabilityVaultAddress, callData: evaultIface.encodeFunctionData("symbol", []) },
        { target: liabilityVaultAddress, callData: evaultIface.encodeFunctionData("oracle", []) },
        { target: liabilityVaultAddress, callData: evaultIface.encodeFunctionData("unitOfAccount", []) },
      ];
      const liabResults = await multicall(provider, liabCalls);
      const tryD = (fn: string, data: string) => { try { return evaultIface.decodeFunctionResult(fn, data); } catch { return null; } };

      const debtAmount = tryD("debtOf", liabResults[0])?.[0] as ethers.BigNumber ?? ethers.BigNumber.from(0);
      const liabilityAssetAddress: string = tryD("asset", liabResults[1])?.[0] ?? "";
      const liabilitySymbol: string = tryD("symbol", liabResults[2])?.[0] ?? "?";
      const liabilityOracle: string | null = tryD("oracle", liabResults[3])?.[0] ?? null;
      const liabilityUoA: string | null = tryD("unitOfAccount", liabResults[4])?.[0] ?? null;

      let liabilityAssetSymbol = "?";
      let liabilityAssetDecimals = 18;
      if (liabilityAssetAddress) {
        const erc20 = new ethers.Contract(liabilityAssetAddress, ERC20_ABI, provider);
        [liabilityAssetSymbol, liabilityAssetDecimals] = await Promise.all([
          erc20.symbol().catch(() => "?"),
          erc20.decimals().catch(() => 18),
        ]);
      }
      const debtTokens = Number(debtAmount) / 10 ** liabilityAssetDecimals;
      const debtPriceUsd = liabilityAssetAddress
        ? await getUsdPrice(liabilityAssetAddress, liabilityAssetDecimals, liabilityOracle, liabilityUoA, provider, wethUsd)
        : 0;
      const debtUsd = debtTokens * debtPriceUsd;

      // Candidate collateral vaults: EVC list + prime vaults not already included
      const evcSet = new Set(evcCollaterals.map((a: string) => a.toLowerCase()));
      const candidateVaults = [
        ...evcCollaterals,
        ...PRIME_VAULTS.filter((v) => !evcSet.has(v.toLowerCase())),
      ];

      // Batch: balanceOf for all candidates in one multicall
      const balCalls = candidateVaults.map((v) => ({
        target: v,
        callData: evaultIface.encodeFunctionData("balanceOf", [account]),
      }));
      const balResults = await multicall(provider, balCalls);

      const nonZeroVaults = candidateVaults.filter((_, i) => {
        const raw = balResults[i];
        if (raw === "0x") return false;
        try {
          const bal = evaultIface.decodeFunctionResult("balanceOf", raw)[0] as ethers.BigNumber;
          return !bal.isZero();
        } catch { return false; }
      });

      if (nonZeroVaults.length === 0) {
        return { subAccountId, account, liabilityVaultAddress, liabilityVaultSymbol: liabilitySymbol, debtAssetSymbol: liabilityAssetSymbol, debtTokens, debtPriceUsd, debtUsd, collaterals: [], healthFactor: 0 };
      }

      // Get shares for non-zero vaults
      const shareMap: Record<string, ethers.BigNumber> = {};
      nonZeroVaults.forEach((v) => {
        const idx = candidateVaults.indexOf(v);
        try {
          shareMap[v] = evaultIface.decodeFunctionResult("balanceOf", balResults[idx])[0] as ethers.BigNumber;
        } catch { shareMap[v] = ethers.BigNumber.from(0); }
      });

      // Batch: vault info + LTV + convertToAssets for non-zero vaults
      const infoCalls = nonZeroVaults.flatMap((v) => [
        { target: v, callData: evaultIface.encodeFunctionData("asset", []) },
        { target: v, callData: evaultIface.encodeFunctionData("symbol", []) },
        { target: v, callData: evaultIface.encodeFunctionData("oracle", []) },
        { target: v, callData: evaultIface.encodeFunctionData("unitOfAccount", []) },
        { target: v, callData: evaultIface.encodeFunctionData("convertToAssets", [shareMap[v]]) },
        { target: liabilityVaultAddress, callData: evaultIface.encodeFunctionData("LTVFull", [v]) },
      ]);
      const infoResults = await multicall(provider, infoCalls);

      const collateralDetails = await Promise.all(
        nonZeroVaults.map(async (v, i) => {
          const base = i * 6;
          const td = (fn: string, data: string) => { try { return evaultIface.decodeFunctionResult(fn, data); } catch { return null; } };

          const colAssetAddress: string = td("asset", infoResults[base])?.[0] ?? "";
          const colSymbol: string = td("symbol", infoResults[base + 1])?.[0] ?? "?";
          const colOracle: string | null = td("oracle", infoResults[base + 2])?.[0] ?? null;
          const colUoA: string | null = td("unitOfAccount", infoResults[base + 3])?.[0] ?? null;
          const assets = td("convertToAssets", infoResults[base + 4])?.[0] as ethers.BigNumber | null;
          const ltvData = td("LTVFull", infoResults[base + 5]);

          let colAssetSymbol = "?";
          let colAssetDecimals = 18;
          if (colAssetAddress) {
            const erc20 = new ethers.Contract(colAssetAddress, ERC20_ABI, provider);
            [colAssetSymbol, colAssetDecimals] = await Promise.all([
              erc20.symbol().catch(() => "?"),
              erc20.decimals().catch(() => 18),
            ]);
          }

          const tokens = assets ? Number(assets) / 10 ** colAssetDecimals : 0;
          const priceUsd = colAssetAddress
            ? await getUsdPrice(colAssetAddress, colAssetDecimals, colOracle, colUoA, provider, wethUsd)
            : 0;
          const valueUsd = tokens * priceUsd;
          const liquidationLTV = ltvData ? Number(ltvData[1]) / 10000 : 0;
          const liquidationValueUsd = valueUsd * liquidationLTV;

          return { vaultAddress: v, vaultSymbol: colSymbol, assetSymbol: colAssetSymbol, tokens, priceUsd, valueUsd, liquidationLTV, liquidationValueUsd };
        })
      );

      const totalLiquidationUsd = collateralDetails.reduce((s, c) => s + c.liquidationValueUsd, 0);
      const healthFactor = debtUsd > 0 ? totalLiquidationUsd / debtUsd : -1;

      return { subAccountId, account, liabilityVaultAddress, liabilityVaultSymbol: liabilitySymbol, debtAssetSymbol: liabilityAssetSymbol, debtTokens, debtPriceUsd, debtUsd, collaterals: collateralDetails, healthFactor };
    })
  );

  return res.status(200).json({ positions: [...borrowPositions, ...supplyOnlyPositions] });
};

export default handler;
