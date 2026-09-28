# omego-bot

TypeScript-genopbygning af pump.fun-botten `omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq`, baseret på on-chain-analysen i `../solana-bot-analysis`.

Standard er **paper mode**: botten handler kun på papir (simulerede fyld på de reelle reserver) og logger omegos rigtige handler ved siden af (shadow).

## Hvad der er kopieret 1:1 fra omego

| Del | Værdi | Kilde |
|-----|-------|-------|
| Sizing | `max_sol_cost = virtual_sol/100`, tokens = kvote for `max × 0.95/1.0005` | 159 køb, lamport-præcis |
| Instruktioner | legacy pump `buy`/`sell`, samme konti og writability | `npm run verify-accounts` |
| Salg | hele beholdningen, `min_sol_output = 0`, luk token-ATA, genudsend hver ~800 ms | fingerprint |
| Compute | 175k CU køb / 200k CU salg, 500 000 µLamports/CU | fingerprint |
| Tip | 200 000 lamports køb / 20 000 salg til tilfældig Helius Sender-tip-konto | fingerprint |
| Tidsstop | 1800 s | 148 runder |

**Status for beslutningslogikken:** omegos *hvornår*-signal kunne ikke udledes af on-chain-data (se `../solana-bot-analysis/reports/ANALYSE.md` §4e). Den køber i samme slot lige efter et andet køb, men hvilke køb den vælger, forklares ikke af størrelse, aktivitet, pris eller wallets. `src/strategy.ts` er en parametriseret tilnærmelse (aktivitetsfilter, trigger-køb, trailing/TP/stop/big-sell, 30 min tidsstop). Standardværdierne er **ikke** profitable i replay; brug paper mode.

## Opsætning

```bash
npm install
cp .env.example .env    # udfyld
npm test
npm run dev             # paper mode
```

Miljøvariabler (se `.env.example`):

- `HELIUS_API_KEY`: bruges til RPC, LaserStream-token og Sender. Tilføj den i Cursor Dashboard → Cloud Agents → Secrets.
- `GRPC_ENDPOINT`: LaserStream/Yellowstone-endpoint, fx `https://laserstream-mainnet-ewr.helius-rpc.com`. Uden den bruges WebSocket `logsSubscribe` (langsommere).
- `MODE=paper|live`. `live` kræver `PRIVATE_KEY` (base58 eller JSON-array).
- `SIZE_PCT_OF_VSOL`: 1 = omego, 2 = sssss.

## Værktøjer

```bash
OUT=data/stream.jsonl npx tsx scripts/record.ts          # optag alle pump.fun-handler
IN=data/stream.jsonl npx tsx scripts/replay.ts           # afspil gennem paper-motoren, sammenlign med omego
PARAMS='{"trailingStop":0.06}' npx tsx scripts/replay.ts # prøv andre tærskler
npm run verify-accounts                                  # genbyg omegos tx og sammenlign konti/data
```
