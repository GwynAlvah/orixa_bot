const RETRYABLE_RPC_CODES = new Set([-32005, -32016, -32097, -32098]);
const RETRYABLE_MESSAGE = /rate ?limit|too many|throttl|capacity|overloaded|busy|timeout|try again/i;

class RetryableRpcError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export class ArcClient {
  constructor(
    private url: string,
    private maxAttempts = 4,
    private timeoutMs = 10_000,
  ) {}

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

  // Retries rate limits, transient server errors, and network failures. A genuine RPC error,
  // such as a reverted call, is thrown immediately rather than retried.
  private async send(method: string, params: unknown[]): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.sendOnce(method, params);
      } catch (e) {
        if (!(e instanceof RetryableRpcError) || attempt >= this.maxAttempts) throw e;
        await sleep(backoffMs(attempt, e.retryAfterMs));
      }
    }
  }

  private async sendOnce(method: string, params: unknown[]) {
    let r: Response;
    try {
      r = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      // DNS failures, resets, and timeouts are all worth another attempt.
      throw new RetryableRpcError("Arc RPC request failed: " + (e instanceof Error ? e.message : String(e)));
    }

    if (r.status === 429 || r.status >= 500) {
      throw new RetryableRpcError("Arc RPC HTTP " + r.status, retryAfterMs(r.headers.get("retry-after")));
    }
    if (!r.ok) throw Error("Arc RPC HTTP " + r.status);

    let p: { result?: string; error?: { code?: number; message?: string } };
    try {
      p = (await r.json()) as typeof p;
    } catch {
      throw new RetryableRpcError("Arc RPC returned a malformed response");
    }

    if (p.result === undefined) {
      const message = p.error?.message || "Invalid RPC response";
      const code = p.error?.code;
      if ((code !== undefined && RETRYABLE_RPC_CODES.has(code)) || RETRYABLE_MESSAGE.test(message)) {
        throw new RetryableRpcError("Arc RPC: " + message);
      }
      throw Error(message);
    }
    return p.result;
  }
}

function retryAfterMs(header: string | null) {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.min(Math.max(date - Date.now(), 0), 30_000);
}

function backoffMs(attempt: number, retryAfter?: number) {
  const base = Math.min(500 * 2 ** (attempt - 1), 8000);
  return Math.max(retryAfter ?? 0, base) + Math.random() * 250;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
