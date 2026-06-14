import { hookstate } from "@hookstate/core";

export interface CompoundCollateral {
  asset: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  balanceTokens: number;
  valueUsd: number;
  liquidateCollateralFactor: number;
  liquidationValueUsd: number;
  // working copies for simulation
  workingBalanceTokens: number;
  workingPriceUsd: number;
}

export interface CompoundPosition {
  marketId: string;
  chainId: number;
  chainName: string;
  baseSymbol: string;
  baseDecimals: number;
  basePriceUsd: number;
  borrowTokens: number;
  borrowUsd: number;
  supplyTokens: number;
  supplyUsd: number;
  collaterals: CompoundCollateral[];
  healthFactor: number | null;
  // working copies for simulation
  workingBorrowTokens: number;
  workingBasePriceUsd: number;
  workingHealthFactor: number;
}

export interface CompoundAddressData {
  isFetching: boolean;
  fetchError: string;
  lastFetched: number;
  positions: CompoundPosition[];
}

interface CompoundStore {
  addressData: Record<string, CompoundAddressData>;
}

export const CompoundDataStore: CompoundStore = hookstate<CompoundStore>({
  addressData: {},
});
