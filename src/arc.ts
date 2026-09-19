export class ArcClient {
  constructor(private url: string) {}

  async balance(contract: string, wallet: string) {
    const data = "0x70a08231" + wallet.slice(2).padStart(64, "0");
    const result = await this.call({ to: contract, data });
    // An eth_call against an address with no contract returns "0x", which BigInt cannot parse.
    // That means the contract is missing on this chain, not that the wallet holds nothing.
    if (result === "0x" || result === "0x0") {
      throw Error("No contract responded at " + contract + " on this RPC. Check the contract address and that the RPC points at the right Arc network.");
    }
    const n = BigInt(result);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Balance too large");
    return Number(n);
  }

  async chainId() {
    return Number(BigInt(await this.send("eth_chainId", [])));
  }

  private call(tx: { to: string; data: string }) {
    return this.send("eth_call", [tx, "latest"]);
  }

  private async send(method: string, params: unknown[]) {
    const r = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error("Arc RPC HTTP " + r.status);
    const p = (await r.json()) as { result?: string; error?: { message?: string } };
    if (p.result === undefined) throw Error(p.error?.message || "Invalid RPC response");
    return p.result;
  }
}
