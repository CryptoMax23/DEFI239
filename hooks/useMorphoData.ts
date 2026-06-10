import { useEffect } from "react";
import { useHookstate } from "@hookstate/core";
import { MorphoDataStore, MorphoPosition } from "../store/morphoDataStore";

export function computeMorphoHF(
  collateralTokens: number,
  collateralPriceUsd: number,
  borrowTokens: number,
  loanPriceUsd: number,
  lltv: number
): number {
  if (borrowTokens <= 0) return Infinity;
  if (!collateralPriceUsd || !loanPriceUsd) return NaN;
  return (collateralTokens * collateralPriceUsd * lltv) / (borrowTokens * loanPriceUsd);
}

export function useMorphoData(address: string) {
  const store = useHookstate(MorphoDataStore);

  useEffect(() => {
    if (!address) return;

    const existing = store.addressData.get({ noproxy: true })?.[address];
    if (existing?.isFetching) return;
    if (existing?.lastFetched && Date.now() - existing.lastFetched < 30_000) return;

    // Initialize entry
    store.addressData.nested(address).set({
      isFetching: true,
      fetchError: "",
      lastFetched: 0,
      positions: existing?.positions ?? [],
    });

    fetch(`/api/morpho?address=${address}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch");
        return data;
      })
      .then((data) => {
        const positions: MorphoPosition[] = (data.positions || []).map((pos: any) => {
          const initHF =
            pos.borrowTokens === 0
              ? Infinity
              : (pos.healthFactor !== null ? pos.healthFactor : NaN);
          return {
            ...pos,
            workingCollateralTokens: pos.collateralTokens,
            workingBorrowTokens: pos.borrowTokens,
            workingCollateralPriceUsd: pos.collateralAsset?.priceUsd ?? 0,
            workingLoanPriceUsd: pos.loanAsset?.priceUsd ?? 0,
            workingHealthFactor: initHF,
          };
        });

        store.addressData.nested(address).set({
          isFetching: false,
          fetchError: (data.errors || []).join(", "),
          lastFetched: Date.now(),
          positions,
        });
      })
      .catch((err: Error) => {
        store.addressData.nested(address).merge({
          isFetching: false,
          fetchError: err.message,
          lastFetched: Date.now(),
        });
      });
  }, [address]);

  const addressData = store.addressData.get({ noproxy: true });
  const currentData = address ? addressData?.[address] : null;

  function updatePosition(
    marketId: string,
    chainId: number,
    update: Partial<{
      workingCollateralTokens: number;
      workingBorrowTokens: number;
      workingCollateralPriceUsd: number;
      workingLoanPriceUsd: number;
    }>
  ) {
    if (!address || !currentData) return;
    const posIndex = currentData.positions.findIndex(
      (p) => p.marketId === marketId && p.chainId === chainId
    );
    if (posIndex < 0) return;

    const pos = currentData.positions[posIndex];
    const merged = { ...pos, ...update };

    const newHF = computeMorphoHF(
      merged.workingCollateralTokens,
      merged.workingCollateralPriceUsd,
      merged.workingBorrowTokens,
      merged.workingLoanPriceUsd,
      pos.lltv
    );

    store.addressData.nested(address).positions[posIndex].set({
      ...merged,
      workingHealthFactor: newHF,
    });
  }

  function resetPosition(marketId: string, chainId: number) {
    if (!address || !currentData) return;
    const posIndex = currentData.positions.findIndex(
      (p) => p.marketId === marketId && p.chainId === chainId
    );
    if (posIndex < 0) return;
    const pos = currentData.positions[posIndex];
    const resetHF =
      pos.borrowTokens === 0
        ? Infinity
        : (pos.healthFactor !== null ? pos.healthFactor : NaN);
    store.addressData.nested(address).positions[posIndex].set({
      ...pos,
      workingCollateralTokens: pos.collateralTokens,
      workingBorrowTokens: pos.borrowTokens,
      workingCollateralPriceUsd: pos.collateralAsset?.priceUsd ?? 0,
      workingLoanPriceUsd: pos.loanAsset?.priceUsd ?? 0,
      workingHealthFactor: resetHF,
    });
  }

  return {
    isFetching: currentData?.isFetching ?? false,
    fetchError: currentData?.fetchError ?? "",
    positions: currentData?.positions ?? [],
    updatePosition,
    resetPosition,
  };
}
