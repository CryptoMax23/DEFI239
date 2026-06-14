import { useEffect } from "react";
import { useHookstate } from "@hookstate/core";
import { eulerDataStore, EulerPosition, EulerCollateral } from "../store/eulerDataStore";

const CACHE_MS = 30_000;

function computeHF(pos: EulerPosition): number {
  const totalLiq = pos.collaterals.reduce(
    (s, c) => s + c.workingTokens * c.workingPriceUsd * c.liquidationLTV,
    0
  );
  const debtUsd = pos.workingDebtTokens * pos.workingDebtPriceUsd;
  return debtUsd > 0 ? totalLiq / debtUsd : -1;
}

export function useEulerData(address: string) {
  const store = useHookstate(eulerDataStore);

  useEffect(() => {
    if (!address) return;

    const existing = store.addressData[address]?.ornull?.get({ noproxy: true });
    if (existing?.isFetching) return;
    if (existing?.lastFetched && Date.now() - existing.lastFetched < CACHE_MS) return;

    if (!store.addressData[address]?.ornull) {
      store.addressData[address].set({
        isFetching: true,
        lastFetched: 0,
        positions: [],
        fetchError: "",
      });
    } else {
      store.addressData[address].isFetching.set(true);
      store.addressData[address].fetchError.set("");
    }

    fetch(`/api/euler?address=${address}`)
      .then((r) => r.json())
      .then((data) => {
        const positions: EulerPosition[] = (data.positions || []).map((p: any) => ({
          ...p,
          workingDebtTokens: p.debtTokens,
          workingDebtPriceUsd: p.debtPriceUsd,
          workingDebtUsd: p.debtUsd,
          workingHealthFactor: p.healthFactor,
          collaterals: (p.collaterals || []).map((c: any) => ({
            ...c,
            workingTokens: c.tokens,
            workingPriceUsd: c.priceUsd,
            workingLiquidationValueUsd: c.liquidationValueUsd,
          })),
        }));
        store.addressData[address].set({
          isFetching: false,
          lastFetched: Date.now(),
          positions,
          fetchError: "",
        });
      })
      .catch((err) => {
        store.addressData[address].set({
          isFetching: false,
          lastFetched: Date.now(),
          positions: [],
          fetchError: err?.message || "Failed to fetch Euler data",
        });
      });
  }, [address]);

  const addressData = store.addressData[address]?.ornull?.get({ noproxy: true });

  const updatePosition = (
    posIdx: number,
    posUpdate: { workingDebtTokens?: number; workingDebtPriceUsd?: number },
    collateralUpdates?: Array<{ idx: number; workingTokens?: number; workingPriceUsd?: number }>
  ) => {
    if (!address || !store.addressData[address]?.ornull) return;
    const pos = store.addressData[address].positions[posIdx];
    if (!pos) return;

    if (posUpdate.workingDebtTokens !== undefined)
      pos.workingDebtTokens.set(posUpdate.workingDebtTokens);
    if (posUpdate.workingDebtPriceUsd !== undefined)
      pos.workingDebtPriceUsd.set(posUpdate.workingDebtPriceUsd);

    collateralUpdates?.forEach(({ idx, workingTokens, workingPriceUsd }) => {
      const col = pos.collaterals[idx];
      if (!col) return;
      if (workingTokens !== undefined) col.workingTokens.set(workingTokens);
      if (workingPriceUsd !== undefined) col.workingPriceUsd.set(workingPriceUsd);
      const cd = col.get({ noproxy: true });
      col.workingLiquidationValueUsd.set(cd.workingTokens * cd.workingPriceUsd * cd.liquidationLTV);
    });

    const posData = pos.get({ noproxy: true });
    pos.workingDebtUsd.set(posData.workingDebtTokens * posData.workingDebtPriceUsd);
    pos.workingHealthFactor.set(computeHF(posData));
  };

  const resetPosition = (posIdx: number) => {
    if (!address || !store.addressData[address]?.ornull) return;
    const pos = store.addressData[address].positions[posIdx];
    if (!pos) return;
    const orig = pos.get({ noproxy: true });
    pos.workingDebtTokens.set(orig.debtTokens);
    pos.workingDebtPriceUsd.set(orig.debtPriceUsd);
    pos.workingDebtUsd.set(orig.debtUsd);
    pos.workingHealthFactor.set(orig.healthFactor);
    orig.collaterals.forEach((c, i) => {
      pos.collaterals[i].workingTokens.set(c.tokens);
      pos.collaterals[i].workingPriceUsd.set(c.priceUsd);
      pos.collaterals[i].workingLiquidationValueUsd.set(c.liquidationValueUsd);
    });
  };

  return {
    positions: addressData?.positions ?? [],
    isFetching: addressData?.isFetching ?? false,
    fetchError: addressData?.fetchError ?? "",
    updatePosition,
    resetPosition,
  };
}
