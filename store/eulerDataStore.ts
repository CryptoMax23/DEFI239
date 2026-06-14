import { hookstate } from "@hookstate/core";

export type EulerCollateral = {
  vaultAddress: string;
  vaultSymbol: string;
  assetSymbol: string;
  tokens: number;
  priceUsd: number;
  valueUsd: number;
  liquidationLTV: number;
  liquidationValueUsd: number;
  workingTokens: number;
  workingPriceUsd: number;
  workingLiquidationValueUsd: number;
};

export type EulerPosition = {
  subAccountId: number;
  account: string;
  liabilityVaultAddress: string;
  liabilityVaultSymbol: string;
  debtAssetSymbol: string;
  debtTokens: number;
  debtPriceUsd: number;
  debtUsd: number;
  collaterals: EulerCollateral[];
  healthFactor: number;
  workingDebtTokens: number;
  workingDebtPriceUsd: number;
  workingDebtUsd: number;
  workingHealthFactor: number;
};

export type EulerAddressData = {
  isFetching: boolean;
  lastFetched: number;
  positions: EulerPosition[];
  fetchError: string;
};

export type EulerStore = {
  addressData: Record<string, EulerAddressData>;
};

export const eulerDataStore = hookstate<EulerStore>({ addressData: {} });
