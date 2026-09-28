import { PublicKey } from "@solana/web3.js";
import { TRADE_EVENT_LOG_PREFIX } from "./constants.js";

export interface TradeEvent {
  mint: string;
  /** Lamports moved into/out of the curve, excluding protocol and creator fees. */
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: number;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  feeBasisPoints: bigint;
  creator: string;
  creatorFeeBasisPoints: bigint;
  ixName: string;
  mayhemMode: boolean;
  cashbackFeeBasisPoints: bigint;
}

const MIN_LEN = 258;

function pubkeyAt(buf: Buffer, offset: number): string {
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
}

export function decodeTradeEventBase64(b64: string): TradeEvent | null {
  if (!b64.startsWith(TRADE_EVENT_LOG_PREFIX)) return null;
  const buf = Buffer.from(b64, "base64");
  if (buf.length < MIN_LEN) return null;
  const ev: TradeEvent = {
    mint: pubkeyAt(buf, 8),
    solAmount: buf.readBigUInt64LE(40),
    tokenAmount: buf.readBigUInt64LE(48),
    isBuy: buf[56] === 1,
    user: pubkeyAt(buf, 57),
    timestamp: Number(buf.readBigInt64LE(89)),
    virtualSolReserves: buf.readBigUInt64LE(97),
    virtualTokenReserves: buf.readBigUInt64LE(105),
    realSolReserves: buf.readBigUInt64LE(113),
    realTokenReserves: buf.readBigUInt64LE(121),
    feeBasisPoints: buf.readBigUInt64LE(161),
    creator: pubkeyAt(buf, 177),
    creatorFeeBasisPoints: buf.readBigUInt64LE(209),
    ixName: "",
    mayhemMode: false,
    cashbackFeeBasisPoints: 0n,
  };
  // ix_name is a borsh string (u32 length + utf8) followed by mayhem_mode and cashback bps.
  if (buf.length >= 262) {
    const len = buf.readUInt32LE(258);
    const end = 262 + len;
    if (len < 64 && buf.length >= end + 9) {
      ev.ixName = buf.subarray(262, end).toString("utf8");
      ev.mayhemMode = buf[end] === 1;
      ev.cashbackFeeBasisPoints = buf.readBigUInt64LE(end + 1);
    }
  }
  return ev;
}

export function extractTradeEvents(logMessages: readonly string[] | null | undefined): TradeEvent[] {
  const out: TradeEvent[] = [];
  for (const line of logMessages ?? []) {
    if (!line.startsWith("Program data: ")) continue;
    const ev = decodeTradeEventBase64(line.slice("Program data: ".length).trim());
    if (ev) out.push(ev);
  }
  return out;
}

/** Spot price in lamports per raw token unit, from virtual reserves. */
export function spotPrice(ev: Pick<TradeEvent, "virtualSolReserves" | "virtualTokenReserves">): number {
  return Number(ev.virtualSolReserves) / Number(ev.virtualTokenReserves);
}
