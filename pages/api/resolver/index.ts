import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { createProvider } from "../../../lib/provider";

const allowedMethods = ["POST", "OPTIONS"];

const handler = async (_req: NextApiRequest, res: NextApiResponse) => {
  try {
    if (!allowedMethods.includes(_req.method!)) {
      return res.status(405).send({ message: "Method not allowed." });
    }

    const { address } = JSON.parse(_req.body);
    let resolvedAddress = address;
    if (!ethers.utils.isAddress(address)) {
      resolvedAddress =
        (await getResolvedAddress(address)) ||
        "0x87cCC67f0c1b67745989542152DD4acff3841CD6";
    }

    res.status(200).send(resolvedAddress);
  } catch (err: any) {
    res.status(500).json({ statusCode: 500, message: err.message });
  }
};

export const getResolvedAddress = async (address: string) => {
  if (ethers.utils.isAddress(address)) return address;
  const provider = createProvider("https://rpc.ankr.com/eth", 1);
  const resolvedAddress = await provider.resolveName(address);
  return resolvedAddress;
};

export default handler;
