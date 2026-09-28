import { Connection, VersionedTransaction } from "@solana/web3.js";

/** Submits through Helius Sender (dual-routes to validators and Jito). No preflight, no RPC retries. */
export async function sendViaSender(senderUrl: string, tx: VersionedTransaction): Promise<string> {
  const res = await fetch(senderUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "sendTransaction",
      params: [Buffer.from(tx.serialize()).toString("base64"), { encoding: "base64", skipPreflight: true, maxRetries: 0 }],
    }),
  });
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error) throw new Error(`Sender: ${body.error.message}`);
  if (!body.result) throw new Error(`Sender: HTTP ${res.status}`);
  return body.result;
}

/** Keeps a fresh blockhash in memory so building a tx never waits on RPC. */
export class BlockhashCache {
  private value: { blockhash: string; lastValidBlockHeight: number } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly connection: Connection, private readonly intervalMs = 1_000) {}

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get(): string {
    if (!this.value) throw new Error("blockhash cache not started");
    return this.value.blockhash;
  }

  private async refresh(): Promise<void> {
    this.value = await this.connection.getLatestBlockhash("confirmed");
  }
}
