import { hookstate } from "@hookstate/core";

export interface MorphoAsset {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number | null;
}

export interface MorphoPosition {
  marketId: string;
  chainId: number;
  chainName: string;
  positionType: "market" | "vault";
  vaultName?: string;
  lltv: number;
  collateralAsset: MorphoAsset | null;
  loanAsset: MorphoAsset;
  supplyApy: number;
  borrowApy: number;
  // original values from API
  collateralTokens: number;
  collateralUsd: number | null;
  borrowTokens: number;
  borrowUsd: number | null;
  supplyTokens: number;
  supplyUsd: number | null;
  healthFactor: number | null;
  // working copies for simulation
  workingCollateralTokens: number;
  workingBorrowTokens: number;
  workingCollateralPriceUsd: number;
  workingLoanPriceUsd: number;
  workingHealthFactor: number;
}

export interface MorphoAddressData {
  isFetching: boolean;
  fetchError: string;
  lastFetched: number;
  positions: MorphoPosition[];
}

interface MorphoStore {
  currentAddress: string;
  addressData: Record<string, MorphoAddressData>;
}

const defaultState: MorphoStore = {
  currentAddress: "",
  addressData: {},
};

export const MorphoDataStore: MorphoStore = hookstate(defaultState);
