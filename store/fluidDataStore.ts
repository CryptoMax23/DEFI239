import { hookstate } from "@hookstate/core";

export interface FluidAsset {
  address: string;
  symbol: string;
  decimals: number;
  priceUsd: number | null;
}

export type FluidPositionType = "vault" | "lending";

export interface FluidPosition {
  id: string; // nftId for vault, fToken address for lending
  chainId: number;
  chainName: string;
  positionType: FluidPositionType;
  // vault-only
  supplyAsset: FluidAsset | null;
  borrowAsset: FluidAsset | null;
  supplyTokens: number;
  borrowTokens: number;
  supplyUsd: number | null;
  borrowUsd: number | null;
  collateralFactor: number; // decimal, e.g. 0.8
  liquidationThreshold: number; // decimal, e.g. 0.85
  healthFactor: number | null;
  borrowApy: number; // decimal, e.g. 0.05 for 5%
  supplyApy: number;
  // simulation working copies (vault only)
  workingSupplyTokens: number;
  workingBorrowTokens: number;
  workingSupplyPriceUsd: number;
  workingBorrowPriceUsd: number;
  workingHealthFactor: number;
  // lending-only
  lendingAsset: FluidAsset | null;
  lendingTokens: number;
  lendingUsd: number | null;
}

export interface FluidAddressData {
  isFetching: boolean;
  fetchError: string;
  lastFetched: number;
  positions: FluidPosition[];
}

interface FluidStore {
  addressData: Record<string, FluidAddressData>;
}

const defaultState: FluidStore = { addressData: {} };

export const FluidDataStore: FluidStore = hookstate(defaultState);
