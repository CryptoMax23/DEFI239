import { ethers } from "ethers";

class CloudflareRpcProvider extends ethers.providers.StaticJsonRpcProvider {
  private readonly _rpcUrl: string;

  constructor(url: string, chainId: number) {
    super({ url }, chainId);
    this._rpcUrl = url;
  }

  async send(method: string, params: Array<unknown>): Promise<unknown> {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, attempt * 600));
      }
      const response = await fetch(this._rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      });
      if (response.status === 429 && attempt < MAX_RETRIES - 1) continue;
      if (!response.ok) {
        throw new Error(`RPC HTTP ${response.status} for ${method} on ${this._rpcUrl}`);
      }
      const json = (await response.json()) as {
        result?: unknown;
        error?: { message: string; code: number; data?: unknown };
      };
      if (json.error) {
        const err: any = new Error(json.error.message);
        err.code = json.error.code;
        err.data = json.error.data;
        throw err;
      }
      return json.result;
    }
  }
}

export function createProvider(url: string, chainId: number): CloudflareRpcProvider {
  return new CloudflareRpcProvider(url, chainId);
}
