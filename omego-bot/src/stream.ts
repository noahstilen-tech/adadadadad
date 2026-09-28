import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import * as yellowstone from "@triton-one/yellowstone-grpc";
import { CommitmentLevel, type SubscribeRequest, type SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import { PUMP_PROGRAM_ID } from "./constants.js";
import { extractTradeEvents, type TradeEvent } from "./events.js";

export interface TradeTx {
  signature: string;
  slot: number;
  /** Position within the block; only known on the gRPC path. */
  txIndex: number | null;
  events: TradeEvent[];
  receivedAt: number;
}

export type TradeHandler = (tx: TradeTx) => void;

export interface StreamOptions {
  grpcEndpoint: string | null;
  grpcToken: string | null;
  connection: Connection;
}

/** Streams successful pump.fun transactions at processed commitment. */
export async function streamPumpTrades(opts: StreamOptions, onTx: TradeHandler): Promise<() => void> {
  if (opts.grpcEndpoint) return streamGrpc(opts.grpcEndpoint, opts.grpcToken, onTx);
  return streamWebsocket(opts.connection, onTx);
}

type GrpcClientCtor = new (
  endpoint: string,
  xToken: string | undefined,
  channelOptions: undefined,
  reconnect?: { enabled?: boolean },
) => { connect(): Promise<void>; subscribe(): Promise<import("node:stream").Duplex> };

// CJS package: the class is `exports.default`, which ESM interop may or may not unwrap.
function grpcClientCtor(): GrpcClientCtor {
  const mod = yellowstone as unknown as { default: GrpcClientCtor | { default: GrpcClientCtor } };
  return typeof mod.default === "function" ? mod.default : mod.default.default;
}

async function streamGrpc(endpoint: string, token: string | null, onTx: TradeHandler): Promise<() => void> {
  const client = new (grpcClientCtor())(endpoint, token ?? undefined, undefined, { enabled: true });
  await client.connect();
  const stream = await client.subscribe();
  stream.on("data", (u: SubscribeUpdate) => {
    const t = u.transaction?.transaction;
    if (!t?.meta || t.meta.err) return;
    const events = extractTradeEvents(t.meta.logMessages);
    if (events.length === 0) return;
    onTx({
      signature: bs58.encode(t.signature),
      slot: Number(u.transaction!.slot),
      txIndex: Number(t.index),
      events,
      receivedAt: Date.now(),
    });
  });
  stream.on("error", (e: Error) => console.error("[grpc] stream error", e.message));
  await new Promise<void>((resolve, reject) =>
    stream.write(
      {
        accounts: {},
        slots: {},
        transactions: {
          pump: { vote: false, failed: false, accountInclude: [PUMP_PROGRAM_ID.toBase58()], accountExclude: [], accountRequired: [] },
        },
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        accountsDataSlice: [],
        commitment: CommitmentLevel.PROCESSED,
      } as unknown as SubscribeRequest,
      (err: Error | null | undefined) => (err ? reject(err) : resolve()),
    ),
  );
  console.log(`[grpc] subscribed to pump.fun via ${endpoint}`);
  return () => stream.destroy();
}

async function streamWebsocket(connection: Connection, onTx: TradeHandler): Promise<() => void> {
  const id = connection.onLogs(
    PUMP_PROGRAM_ID,
    (logs, ctx) => {
      if (logs.err) return;
      const events = extractTradeEvents(logs.logs);
      if (events.length === 0) return;
      onTx({ signature: logs.signature, slot: ctx.slot, txIndex: null, events, receivedAt: Date.now() });
    },
    "processed",
  );
  console.log("[ws] subscribed to pump.fun logs (fallback; slower than gRPC)");
  return () => void connection.removeOnLogsListener(id);
}
