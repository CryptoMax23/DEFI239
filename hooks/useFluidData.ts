import { useEffect } from "react";
import { useHookstate } from "@hookstate/core";
import { FluidDataStore, FluidPosition } from "../store/fluidDataStore";

export function computeFluidHF(
  supplyTokens: number,
  supplyPriceUsd: number,
  borrowTokens: number,
  borrowPriceUsd: number,
  liquidationThreshold: number
): number {
  if (borrowTokens <= 0) return Infinity;
  if (!supplyPriceUsd || !borrowPriceUsd) return NaN;
  return (supplyTokens * supplyPriceUsd * liquidationThreshold) / (borrowTokens * borrowPriceUsd);
}

export function useFluidData(address: string) {
  const store = useHookstate(FluidDataStore);

  useEffect(() => {
    if (!address) return;

    const existing = store.addressData.get({ noproxy: true })?.[address];
    if (existing?.isFetching) return;
    if (existing?.lastFetched && Date.now() - existing.lastFetched < 30_000) return;

    store.addressData.nested(address).set({
      isFetching: true,
      fetchError: "",
      lastFetched: 0,
      positions: existing?.positions ?? [],
    });

    fetch(`/api/fluid?address=${address}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch");
        return data;
      })
      .then((data) => {
        const positions: FluidPosition[] = (data.positions || []).map((pos: any) => {
          const initHF =
            pos.borrowTokens === 0
              ? Infinity
              : pos.healthFactor !== null
              ? pos.healthFactor
              : NaN;
          return {
            ...pos,
            workingSupplyTokens: pos.supplyTokens,
            workingBorrowTokens: pos.borrowTokens,
            workingSupplyPriceUsd: pos.supplyAsset?.priceUsd ?? 0,
            workingBorrowPriceUsd: pos.borrowAsset?.priceUsd ?? 0,
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

  const currentData = address
    ? store.addressData.get({ noproxy: true })?.[address]
    : null;

  function updatePosition(
    id: string,
    chainId: number,
    update: Partial<{
      workingSupplyTokens: number;
      workingBorrowTokens: number;
      workingSupplyPriceUsd: number;
      workingBorrowPriceUsd: number;
    }>
  ) {
    if (!address || !currentData) return;
    const idx = currentData.positions.findIndex(
      (p) => p.id === id && p.chainId === chainId
    );
    if (idx < 0) return;
    const pos = currentData.positions[idx];
    const merged = { ...pos, ...update };
    const newHF = computeFluidHF(
      merged.workingSupplyTokens,
      merged.workingSupplyPriceUsd,
      merged.workingBorrowTokens,
      merged.workingBorrowPriceUsd,
      pos.liquidationThreshold
    );
    store.addressData.nested(address).positions[idx].set({
      ...merged,
      workingHealthFactor: newHF,
    });
  }

  function resetPosition(id: string, chainId: number) {
    if (!address || !currentData) return;
    const idx = currentData.positions.findIndex(
      (p) => p.id === id && p.chainId === chainId
    );
    if (idx < 0) return;
    const pos = currentData.positions[idx];
    const resetHF =
      pos.borrowTokens === 0
        ? Infinity
        : pos.healthFactor !== null
        ? pos.healthFactor
        : NaN;
    store.addressData.nested(address).positions[idx].set({
      ...pos,
      workingSupplyTokens: pos.supplyTokens,
      workingBorrowTokens: pos.borrowTokens,
      workingSupplyPriceUsd: pos.supplyAsset?.priceUsd ?? 0,
      workingBorrowPriceUsd: pos.borrowAsset?.priceUsd ?? 0,
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
