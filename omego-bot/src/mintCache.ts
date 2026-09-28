import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants.js";

/** Token program per mint (new pump.fun coins are Token-2022, older ones SPL Token). */
export class TokenProgramCache {
  private readonly cache = new Map<string, Promise<PublicKey>>();

  constructor(private readonly connection: Connection) {}

  /** Resolved on-chain once; call early (on first trade seen) so entries don't wait on RPC. */
  get(mint: string): Promise<PublicKey> {
    let p = this.cache.get(mint);
    if (!p) {
      p = this.connection.getAccountInfo(new PublicKey(mint), "processed").then((info) => {
        if (!info) throw new Error(`mint ${mint} not found`);
        return info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      });
      p.catch(() => this.cache.delete(mint));
      this.cache.set(mint, p);
    }
    return p;
  }
}
