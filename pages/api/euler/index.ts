import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { createProvider } from "../../../lib/provider";

// Any Euler v2 vault to bootstrap the EVC address
const ANCHOR_VAULT = "0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9"; // eUSDC prime
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const NUM_SUB_ACCOUNTS = 5; // main + 4 sub-accounts

// Known Euler v2 prime vaults on Ethereum mainnet — used to discover deposits
// even when collateral isn't explicitly enabled in the EVC
const PRIME_VAULTS = [
  "0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9", // eUSDC
  "0xD8b27CF359b7D15710a5BE299AF6e7Bf904984C2", // eWETH
  "0x313603FA690301b0CaeEf8069c065862f9162162", // eUSDT
  "0x998D761eC1BAdaCeb064624cc3A1d37A46C88bA4", // eWBTC
  "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee", // eweETH
  "0x83F20F44975D03b1b09e64809B757c47f942BEeA", // esDAI
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

// Chainlink USD price feeds on Ethereum mainnet (token → feed)
const CHAINLINK_FEEDS: Record<string, string> = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // WETH
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D", // USDT
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", // WBTC
  "0x6b175474e89094c44da98b954eedeac495271d0f": "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9", // DAI
  "0x83f20f44975d03b1b09e64809b757c47f942beea": "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9", // sDAI ≈ DAI
  "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // weETH ≈ ETH
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // stETH ≈ ETH
};

// Addresses recognised as USD unit of account
const USD_UNIT_OF_ACCOUNTS = new Set([
  "0x0000000000000000000000000000000000000348", // Virtual USD (ISO 4217 840)
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
]);

const VIRTUAL_USD = "0x0000000000000000000000000000000000000348";

function getSubAccountAddress(primary: string, subAccountId: number): string {
  const addr = BigInt(primary.toLowerCase());
  const lastByte = addr & BigInt(0xff);
  const prefix = addr & ~BigInt(0xff);
  const subAddr = prefix | (lastByte ^ BigInt(subAccountId));
  return ethers.utils.getAddress("0x" + subAddr.toString(16).padStart(40, "0"));
}

async function getChainlinkPrice(
  feedAddress: string,
  provider: ethers.providers.Provider
): Promise<number> {
  const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider);
  const [answer, dec] = await Promise.all([feed.latestAnswer(), feed.decimals()]);
  return Number(answer) / 10 ** Number(dec);
}

async function getUsdPrice(
  assetAddress: string,
  assetDecimals: number,
  oracleAddress: string | null,
  unitOfAccount: string | null,
  provider: ethers.providers.Provider
): Promise<number> {
  const assetLower = assetAddress.toLowerCase();

  // Chainlink first
  const feed = CHAINLINK_FEEDS[assetLower];
  if (feed) {
    try {
      return await getChainlinkPrice(feed, provider);
    } catch {}
  }

  // Euler oracle fallback
  if (oracleAddress && oracleAddress !== ethers.constants.AddressZero && unitOfAccount) {
    try {
      const oracle = new ethers.Contract(oracleAddress, PRICE_ORACLE_ABI, provider);
      const inAmount = ethers.BigNumber.from(10).pow(assetDecimals);
      const uoaLower = unitOfAccount.toLowerCase();
      const outAmount = await oracle.getQuote(inAmount, assetAddress, unitOfAccount);

      if (uoaLower === VIRTUAL_USD.toLowerCase()) {
        return Number(outAmount) / 1e18;
      }
      if (USD_UNIT_OF_ACCOUNTS.has(uoaLower)) {
        const isSmallDecimal = uoaLower === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC = 6 decimals
        return Number(outAmount) / 10 ** (isSmallDecimal ? 6 : 18);
      }
      if (uoaLower === WETH_ADDRESS.toLowerCase()) {
        const wethFeed = CHAINLINK_FEEDS[WETH_ADDRESS.toLowerCase()];
        if (wethFeed) {
          const wethUsd = await getChainlinkPrice(wethFeed, provider);
          return (Number(outAmount) / 1e18) * wethUsd;
        }
      }
    } catch {}
  }

  return 0;
}

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const address = req.query.address as string;
  if (!address || !ethers.utils.isAddress(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }

  const provider = createProvider("https://ethereum-rpc.publicnode.com", 1);

  // Bootstrap EVC address from any known vault
  const anchorVault = new ethers.Contract(ANCHOR_VAULT, EVAULT_ABI, provider);
  let evcAddress: string;
  try {
    evcAddress = await anchorVault.EVC();
  } catch {
    return res.status(500).json({ error: "Failed to connect to Euler v2" });
  }
  const evc = new ethers.Contract(evcAddress, EVC_ABI, provider);

  // Build sub-account list: main + 4 sub-accounts
  const accounts = [
    address,
    ...Array.from({ length: NUM_SUB_ACCOUNTS - 1 }, (_, i) =>
      getSubAccountAddress(address, i + 1)
    ),
  ];

  // Parallel: fetch controllers + collaterals for all sub-accounts
  const accountStates = await Promise.all(
    accounts.map(async (account, idx) => {
      const [controllers, collaterals] = await Promise.all([
        evc.getControllers(account).catch(() => [] as string[]),
        evc.getCollaterals(account).catch(() => [] as string[]),
      ]);
      return { account, subAccountId: idx, controllers: controllers as string[], collaterals: collaterals as string[] };
    })
  );

  // Accounts with active borrows
  const activeAccounts = accountStates.filter((a) => a.controllers.length > 0);

  // Accounts without borrows — scan prime vaults to detect supply-only positions
  const supplyOnlyAccounts = accountStates.filter((a) => a.controllers.length === 0);
  const supplyOnlyPositions = (
    await Promise.all(
      supplyOnlyAccounts.map(async ({ account, subAccountId }) => {
        const vaultBalances = await Promise.all(
          PRIME_VAULTS.map(async (vaultAddress) => {
            const vault = new ethers.Contract(vaultAddress, EVAULT_ABI, provider);
            const shares = await vault.balanceOf(account).catch(() => ethers.BigNumber.from(0));
            if ((shares as ethers.BigNumber).isZero()) return null;
            return { vaultAddress, shares: shares as ethers.BigNumber, vault };
          })
        );
        const found = vaultBalances.filter(Boolean) as NonNullable<(typeof vaultBalances)[number]>[];
        if (found.length === 0) return null;

        const collaterals = await Promise.all(
          found.map(async ({ vaultAddress, shares, vault }) => {
            const [colAssetAddress, colSymbol, colOracle, colUoA] = await Promise.all([
              vault.asset().catch(() => ""),
              vault.symbol().catch(() => "?"),
              vault.oracle().catch(() => null),
              vault.unitOfAccount().catch(() => null),
            ]);
            const assets = await vault.convertToAssets(shares).catch(() => shares) as ethers.BigNumber;
            let colAssetSymbol = "?";
            let colAssetDecimals = 18;
            if (colAssetAddress) {
              const erc20 = new ethers.Contract(colAssetAddress, ERC20_ABI, provider);
              [colAssetSymbol, colAssetDecimals] = await Promise.all([
                erc20.symbol().catch(() => "?"),
                erc20.decimals().catch(() => 18),
              ]);
            }
            const tokens = Number(assets) / 10 ** colAssetDecimals;
            const priceUsd = colAssetAddress
              ? await getUsdPrice(colAssetAddress, colAssetDecimals, colOracle, colUoA, provider)
              : 0;
            return {
              vaultAddress,
              vaultSymbol: colSymbol,
              assetSymbol: colAssetSymbol,
              tokens,
              priceUsd,
              valueUsd: tokens * priceUsd,
              liquidationLTV: 0,
              liquidationValueUsd: 0,
            };
          })
        );

        return {
          subAccountId,
          account,
          liabilityVaultAddress: "",
          liabilityVaultSymbol: "",
          debtAssetSymbol: "",
          debtTokens: 0,
          debtPriceUsd: 0,
          debtUsd: 0,
          collaterals,
          healthFactor: -1,
        };
      })
    )
  ).filter(Boolean) as NonNullable<ReturnType<typeof Promise.resolve<any>>>;

  if (activeAccounts.length === 0 && supplyOnlyPositions.length === 0) {
    return res.status(200).json({ positions: [] });
  }

  // For each active sub-account (with borrow), fetch full position data
  const positions = await Promise.all(
    activeAccounts.map(async ({ account, subAccountId, controllers, collaterals }) => {
      const liabilityVaultAddress = controllers[0];
      const liabilityVault = new ethers.Contract(liabilityVaultAddress, EVAULT_ABI, provider);

      const [debtAmount, liabilityAssetAddress, liabilitySymbol, liabilityOracle, liabilityUoA] =
        await Promise.all([
          liabilityVault.debtOf(account).catch(() => ethers.BigNumber.from(0)),
          liabilityVault.asset().catch(() => ""),
          liabilityVault.symbol().catch(() => "?"),
          liabilityVault.oracle().catch(() => null),
          liabilityVault.unitOfAccount().catch(() => null),
        ]);

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
        ? await getUsdPrice(liabilityAssetAddress, liabilityAssetDecimals, liabilityOracle, liabilityUoA, provider)
        : 0;
      const debtUsd = debtTokens * debtPriceUsd;

      // Merge EVC collaterals with prime vault scan so we never miss a deposit.
      // The EVC only tracks vaults explicitly enabled as collateral; a direct scan
      // catches vaults where the user deposited without calling enableCollateral().
      const evcColSet = new Set((collaterals as string[]).map((a) => a.toLowerCase()));
      const candidateVaults = [
        ...collaterals,
        ...PRIME_VAULTS.filter((v) => !evcColSet.has(v.toLowerCase())),
      ];

      // Collaterals in parallel
      const collateralResults = await Promise.all(
        candidateVaults.map(async (colVaultAddress: string) => {
          const colVault = new ethers.Contract(colVaultAddress, EVAULT_ABI, provider);

          const [shares, colAssetAddress, colSymbol, colOracle, colUoA, ltvData] = await Promise.all([
            colVault.balanceOf(account).catch(() => ethers.BigNumber.from(0)),
            colVault.asset().catch(() => ""),
            colVault.symbol().catch(() => "?"),
            colVault.oracle().catch(() => null),
            colVault.unitOfAccount().catch(() => null),
            liabilityVault.LTVFull(colVaultAddress).catch(() => null),
          ]);

          if ((shares as ethers.BigNumber).isZero()) return null;

          const assets = await colVault
            .convertToAssets(shares)
            .catch(() => shares) as ethers.BigNumber;

          let colAssetSymbol = "?";
          let colAssetDecimals = 18;
          if (colAssetAddress) {
            const erc20 = new ethers.Contract(colAssetAddress, ERC20_ABI, provider);
            [colAssetSymbol, colAssetDecimals] = await Promise.all([
              erc20.symbol().catch(() => "?"),
              erc20.decimals().catch(() => 18),
            ]);
          }

          const tokens = Number(assets) / 10 ** colAssetDecimals;
          const priceUsd = colAssetAddress
            ? await getUsdPrice(colAssetAddress, colAssetDecimals, colOracle, colUoA, provider)
            : 0;
          const valueUsd = tokens * priceUsd;

          // liquidationLTV is index 1 in the tuple, in 1e4 units (e.g. 8500 = 85%)
          const liquidationLTV = ltvData ? Number(ltvData[1]) / 10000 : 0;
          const liquidationValueUsd = valueUsd * liquidationLTV;

          return {
            vaultAddress: colVaultAddress,
            vaultSymbol: colSymbol,
            assetSymbol: colAssetSymbol,
            tokens,
            priceUsd,
            valueUsd,
            liquidationLTV,
            liquidationValueUsd,
          };
        })
      );

      const validCollaterals = collateralResults.filter(Boolean) as NonNullable<(typeof collateralResults)[number]>[];
      const totalLiquidationUsd = validCollaterals.reduce((s, c) => s + c.liquidationValueUsd, 0);
      const healthFactor = debtUsd > 0 ? totalLiquidationUsd / debtUsd : -1;

      return {
        subAccountId,
        account,
        liabilityVaultAddress,
        liabilityVaultSymbol: liabilitySymbol,
        debtAssetSymbol: liabilityAssetSymbol,
        debtTokens,
        debtPriceUsd,
        debtUsd,
        collaterals: validCollaterals,
        healthFactor,
      };
    })
  );

  return res.status(200).json({ positions: [...positions, ...supplyOnlyPositions] });
};

export default handler;
