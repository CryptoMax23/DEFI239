import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
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

    // quick provider probe
    try {
      const provider = new ethers.providers.StaticJsonRpcProvider(market.api, market.chainId);
      // lightweight call
      await provider.getBlockNumber();
      return res.status(200).json({ enabled: true });
    } catch (err: any) {
      // attempt to extract a friendly message
      const body = err?.error?.body || err?.body || err?.message || "Network probe failed";
      let parsedMessage = String(body);
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body);
          if (parsed?.error?.message) parsedMessage = parsed.error.message;
        } catch {}
      }
      return res.status(200).json({ enabled: false, message: parsedMessage });
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ statusCode: 500, message: err.message });
  }
};

export default handler;
