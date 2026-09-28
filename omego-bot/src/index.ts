import { Connection } from "@solana/web3.js";
import { loadConfig } from "./config.js";
import { Engine } from "./engine.js";
import { DEFAULT_PARAMS } from "./strategy.js";
import { streamPumpTrades } from "./stream.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const connection = new Connection(cfg.rpcUrl, { commitment: "processed", wsEndpoint: cfg.wsUrl });
  const engine = new Engine(cfg, DEFAULT_PARAMS, connection);
  await engine.start();
  console.log(
    `[omego-bot] mode=${cfg.mode} size=${cfg.sizePctOfVirtualSol}% of virtual SOL wallet=${cfg.keypair?.publicKey.toBase58() ?? "-"} shadow=${cfg.shadowWallet?.toBase58() ?? "-"}`,
  );
  const stop = await streamPumpTrades(
    { grpcEndpoint: cfg.grpcEndpoint, grpcToken: cfg.grpcToken, connection },
    (tx) => engine.onTx(tx),
  );
  const shutdown = () => {
    stop();
    engine.stop();
    const s = engine.stats;
    console.log(`[omego-bot] rounds=${s.rounds} wins=${s.wins} pnl=${(s.pnlLamports / 1e9).toFixed(4)} SOL`);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
