import { NextApiRequest, NextApiResponse } from "next";

const MORPHO_GRAPHQL_URL = "https://blue-api.morpho.org/graphql";

const CHAINS = [
  { chainId: 1, chainName: "Ethereum" },
  { chainId: 8453, chainName: "Base" },
];

const USER_POSITIONS_QUERY = `
  query UserPositions($address: String!, $chainId: Int!) {
    userByAddress(address: $address, chainId: $chainId) {
      marketPositions {
        healthFactor
        state {
          collateral
          collateralUsd
          borrowAssets
          borrowAssetsUsd
          supplyAssets
          supplyAssetsUsd
        }
        market {
          marketId
          lltv
          collateralAsset {
            address
            symbol
            name
            decimals
            price { usd }
          }
          loanAsset {
            address
            symbol
            name
            decimals
            price { usd }
          }
          state {
            supplyApy
            borrowApy
          }
        }
      }
    }
  }
`;

async function fetchChainPositions(address: string, chainId: number, chainName: string) {
  const response = await fetch(MORPHO_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: USER_POSITIONS_QUERY,
      variables: { address, chainId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Morpho API error: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0]?.message || "GraphQL error");
  }

  const marketPositions = data.data?.userByAddress?.marketPositions || [];

  return marketPositions
    .filter((pos: any) => {
      const state = pos.state;
      if (!state) return false;
      const hasBorrow = parseFloat(state.borrowAssets || "0") > 0;
      const hasSupply = parseFloat(state.supplyAssets || "0") > 0;
      return hasBorrow || hasSupply;
    })
    .map((pos: any) => {
      const market = pos.market;
      const state = pos.state;

      const lltv = parseFloat(market.lltv || "0") / 1e18;
      const collateralDecimals = market.collateralAsset?.decimals ?? 18;
      const loanDecimals = market.loanAsset?.decimals ?? 18;

      const collateralTokens = parseFloat(state.collateral || "0") / Math.pow(10, collateralDecimals);
      const borrowTokens = parseFloat(state.borrowAssets || "0") / Math.pow(10, loanDecimals);
      const supplyTokens = parseFloat(state.supplyAssets || "0") / Math.pow(10, loanDecimals);

      const collateralPriceUsd: number | null = market.collateralAsset?.price?.usd ?? null;
      const loanPriceUsd: number | null = market.loanAsset?.price?.usd ?? null;

      const collateralUsd: number | null =
        state.collateralUsd !== null && state.collateralUsd !== undefined
          ? state.collateralUsd
          : collateralPriceUsd !== null
          ? collateralTokens * collateralPriceUsd
          : null;

      const borrowUsd: number | null =
        state.borrowAssetsUsd !== null && state.borrowAssetsUsd !== undefined
          ? state.borrowAssetsUsd
          : loanPriceUsd !== null
          ? borrowTokens * loanPriceUsd
          : null;

      const supplyUsd: number | null =
        state.supplyAssetsUsd !== null && state.supplyAssetsUsd !== undefined
          ? state.supplyAssetsUsd
          : loanPriceUsd !== null
          ? supplyTokens * loanPriceUsd
          : null;

      const healthFactor: number | null = pos.healthFactor ?? null;

      return {
        marketId: market.marketId,
        chainId,
        chainName,
        lltv,
        collateralAsset: market.collateralAsset
          ? {
              address: market.collateralAsset.address,
              symbol: market.collateralAsset.symbol,
              name: market.collateralAsset.name,
              decimals: collateralDecimals,
              priceUsd: collateralPriceUsd,
            }
          : null,
        loanAsset: {
          address: market.loanAsset.address,
          symbol: market.loanAsset.symbol,
          name: market.loanAsset.name,
          decimals: loanDecimals,
          priceUsd: loanPriceUsd,
        },
        supplyApy: market.state?.supplyApy ?? 0,
        borrowApy: market.state?.borrowApy ?? 0,
        collateralTokens,
        collateralUsd,
        borrowTokens,
        borrowUsd,
        supplyTokens,
        supplyUsd,
        healthFactor,
      };
    });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { address } = req.query;

  if (!address || typeof address !== "string") {
    return res.status(400).json({ error: "address is required" });
  }

  try {
    const results = await Promise.allSettled(
      CHAINS.map(({ chainId, chainName }) => fetchChainPositions(address, chainId, chainName))
    );

    const positions: any[] = [];
    const errors: string[] = [];

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        positions.push(...result.value);
      } else {
        errors.push(`${CHAINS[i].chainName}: ${(result.reason as Error).message}`);
      }
    });

    return res.status(200).json({ positions, errors });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
