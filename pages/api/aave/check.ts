import type { NextApiRequest, NextApiResponse } from "next";
import { markets } from "../../../hooks/useAaveData";

const allowedMethods = ["POST", "OPTIONS"];

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    if (!allowedMethods.includes(req.method!)) {
      return res.status(405).send({ message: "Method not allowed." });
    }

    const parsedBody =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { marketId } = parsedBody;
    const market = markets.find((m) => m.id === marketId);
    if (!market) return res.status(400).json({ enabled: false, message: "Unknown market" });

    // Public RPCs (publicnode.com) don't need API-key validation.
    // Probing them in parallel for every market triggers rate limiting.
    if (market.api.includes("publicnode.com")) {
      return res.status(200).json({ enabled: true });
    }

    try {
      const response = await fetch(market.api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      });
      if (!response.ok) {
        return res.status(200).json({ enabled: false, message: `HTTP ${response.status}` });
      }
      const data = (await response.json()) as { result?: string; error?: { message: string } };
      if (data.error) {
        return res.status(200).json({ enabled: false, message: data.error.message });
      }
      return res.status(200).json({ enabled: true });
    } catch (err: any) {
      return res.status(200).json({ enabled: false, message: err.message || "Network probe failed" });
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ statusCode: 500, message: err.message });
  }
};

export default handler;
