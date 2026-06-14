import { useEffect } from "react";
import { useHookstate } from "@hookstate/core";
import { CompoundDataStore, CompoundCollateral, CompoundPosition } from "../store/compoundDataStore";

export function computeCompoundHF(
  collaterals: Pick<CompoundCollateral, "workingBalanceTokens" | "workingPriceUsd" | "liquidateCollateralFactor">[],
  workingBorrowTokens: number,
  workingBasePriceUsd: number
): number {
  if (workingBorrowTokens <= 0) return Infinity;
  const borrowValueUsd = workingBorrowTokens * workingBasePriceUsd;
  if (borrowValueUsd <= 0) return Infinity;
  const totalLiquidationValue = collaterals.reduce(
    (sum, c) => sum + c.workingBalanceTokens * c.workingPriceUsd * c.liquidateCollateralFactor,
    0
  );
  return totalLiquidationValue / borrowValueUsd;
}

export function useCompoundData(address: string) {
  const store = useHookstate(CompoundDataStore);

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

    fetch(`/api/compound?address=${address}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch Compound data");
        return data;
      })
      .then((data) => {
        const positions: CompoundPosition[] = (data.positions || []).map((pos: any) => {
          const initHF = pos.borrowTokens <= 0 ? Infinity : (pos.healthFactor ?? NaN);
          return {
            ...pos,
            collaterals: pos.collaterals.map((c: any) => ({
              ...c,
              workingBalanceTokens: c.balanceTokens,
              workingPriceUsd: c.priceUsd,
            })),
            workingBorrowTokens: pos.borrowTokens,
            workingBasePriceUsd: pos.basePriceUsd,
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
    posUpdate: Partial<{ workingBorrowTokens: number; workingBasePriceUsd: number }>,
    collateralUpdates?: { asset: string; workingBalanceTokens?: number; workingPriceUsd?: number }[]
  ) {
    if (!address || !currentData) return;
    const posIndex = currentData.positions.findIndex((p) => p.marketId === marketId);
    if (posIndex < 0) return;

    const pos = currentData.positions[posIndex];
    const merged: CompoundPosition = { ...pos, ...posUpdate };

    if (collateralUpdates?.length) {
      merged.collaterals = pos.collaterals.map((c) => {
        const upd = collateralUpdates.find((u) => u.asset === c.asset);
        return upd ? { ...c, ...upd } : c;
      });
    }

    merged.workingHealthFactor = computeCompoundHF(
      merged.collaterals,
      merged.workingBorrowTokens,
      merged.workingBasePriceUsd
    );

    store.addressData.nested(address).positions[posIndex].set(merged);
  }

  function resetPosition(marketId: string) {
    if (!address || !currentData) return;
    const posIndex = currentData.positions.findIndex((p) => p.marketId === marketId);
    if (posIndex < 0) return;
    const pos = currentData.positions[posIndex];
    store.addressData.nested(address).positions[posIndex].set({
      ...pos,
      collaterals: pos.collaterals.map((c) => ({
        ...c,
        workingBalanceTokens: c.balanceTokens,
        workingPriceUsd: c.priceUsd,
      })),
      workingBorrowTokens: pos.borrowTokens,
      workingBasePriceUsd: pos.basePriceUsd,
      workingHealthFactor: pos.borrowTokens <= 0 ? Infinity : (pos.healthFactor ?? NaN),
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
