import "dotenv/config";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { OMEGO_WALLET } from "./constants.js";

export type Mode = "paper" | "live";

export interface Config {
  mode: Mode;
  rpcUrl: string;
  grpcEndpoint: string | null;
  grpcToken: string | null;
  wsUrl: string;
  senderUrl: string;
  keypair: Keypair | null;
  /** Budget as % of the curve's virtual SOL reserves; omego = 1, sssss = 2. */
  sizePctOfVirtualSol: number;
  maxOpenPositions: number;
  /** Wallet whose live trades are logged next to ours for comparison. */
  shadowWallet: PublicKey | null;
  buyTipLamports: number;
  sellTipLamports: number;
  microLamportsPerCu: number;
  buyCuLimit: number;
  sellCuLimit: number;
  logFile: string | null;
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : Number(v);
}

function loadKeypair(raw: string | undefined): Keypair | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const bytes = trimmed.startsWith("[") ? Uint8Array.from(JSON.parse(trimmed) as number[]) : bs58.decode(trimmed);
  return Keypair.fromSecretKey(bytes);
}

export function loadConfig(): Config {
  const mode = env("MODE", "paper") as Mode;
  if (mode !== "paper" && mode !== "live") throw new Error(`MODE must be paper|live, got ${mode}`);
  const heliusKey = process.env.HELIUS_API_KEY;
  const rpcUrl = env("RPC_URL", heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : "https://api.mainnet-beta.solana.com");
  const keypair = loadKeypair(process.env.PRIVATE_KEY);
  if (mode === "live" && !keypair) throw new Error("MODE=live requires PRIVATE_KEY");
  const shadow = process.env.SHADOW_WALLET ?? OMEGO_WALLET.toBase58();
  return {
    mode,
    rpcUrl,
    grpcEndpoint: process.env.GRPC_ENDPOINT || null,
    grpcToken: process.env.GRPC_TOKEN || heliusKey || null,
    wsUrl: env("WS_URL", rpcUrl.replace(/^http/, "ws")),
    senderUrl: env("SENDER_URL", "https://sender.helius-rpc.com/fast"),
    keypair,
    sizePctOfVirtualSol: num("SIZE_PCT_OF_VSOL", 1),
    maxOpenPositions: num("MAX_OPEN_POSITIONS", 20),
    shadowWallet: shadow === "none" ? null : new PublicKey(shadow),
    buyTipLamports: num("BUY_TIP_LAMPORTS", 200_000),
    sellTipLamports: num("SELL_TIP_LAMPORTS", 20_000),
    microLamportsPerCu: num("MICRO_LAMPORTS_PER_CU", 500_000),
    buyCuLimit: num("BUY_CU_LIMIT", 175_000),
    sellCuLimit: num("SELL_CU_LIMIT", 200_000),
    logFile: process.env.LOG_FILE || null,
  };
}
