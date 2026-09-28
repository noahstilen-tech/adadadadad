# Solana bot on-chain analyse — omego & sssss

Dato: 2026-09-28  
RPC: `https://api.mainnet-beta.solana.com`

## Wallets

| Label | Address | Balance (ca.) | Historik nået |
|-------|---------|---------------|---------------|
| omego | `omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq` | ~63 SOL | ≥630k tx, tilbage til **2026-07-25** (ikke genesis endnu) |
| sssss | `sssssDdMNAWKingjpEojkTNdVuZrBe7FsJLaGtexe7d` | ~123 SOL | ≥280k tx, tilbage til **2026-08-14** (ikke genesis endnu) |

**Korrektion:** sssss er *ikke* “ny” (27. sep). Den har kørt mindst siden midten af august 2026. omego har kørt mindst siden slutningen af juli.

---

## 1. Funding-kilde

### Status
- Ingen native SOL `system transfer` ≥0.5–10 SOL fundet ind i omego eller sssss i:
  - ældste 200 tx i den hentede historik
  - jævn sampling på tværs af hele historikken (hver 2.5k–5k. tx)
- Ved ældste kendte punkt havde begge allerede fuld handelskapital:
  - omego: **~66 SOL** (2026-07-25)
  - sssss: **~117 SOL** (2026-08-14)
- Konklusion: initial funding ligger **før** den hentede historik. Public RPC kræver fortsat paging (~hundreder af tusinde tx mere for omego).

### Stærkt operatør-signal (uden funding)
omego og sssss deler **samme Helius Sender tip-rotation**. I en stikprøve på ~60 tx overlappede **7 tip-konti**, bl.a.:

- `3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT`
- `4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or`
- `5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn`
- `2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD`
- `2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ`
- `4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey`
- `wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF`

Det er stærkere end copy-trading: **samme afsendelses-infrastruktur**.

---

## 2. Størrelsesformel — bekræftet

Formel (1x): `buy_sol ≈ 0.286 + 0.00934 × real_sol`

| Wallet | Median size-mult | p10–p90 | Fortolkning |
|--------|------------------|---------|-------------|
| omego | **1.000** | 0.992–1.008 | eksakt 1x |
| sssss | **1.949** | 1.939–1.976 | eksakt ~2x |
| sssss/omego på 18 delte mints | ratio **1.959** | — | samme regel, dobbelt indsats |

Entry real-SOL median: omego ~14.9, sssss ~15.9 (stadig mid-curve, ikke launch-snipe).

---

## 3. Søskende-wallets (samme formel-familie)

Fra `getBlock` på slots hvor omego (+ ofte sssss) købte, plus validering via egne recent buys:

| Address | Klasse | Median mult | Balance | Tip-overlap med omego/sssss | Funding fundet |
|---------|--------|-------------|---------|------------------------------|----------------|
| `CAvvAFNRfXDWTTDqwgxb9qSyYT8fTuTXWSFwL7Jsz8vT` | **3x** | ~3.16–3.25 | ~219 SOL | Nej | Ikke i 8k tx (tilbage til 24. sep) |
| `CvKBPvEmcvsVPa5gCcvKwNAGUwUhMQNbRv4mdpGtTEWo` | **4x** | ~4.01–4.43 | ~173 SOL | Nej (egne tip-konti) | **110.53 SOL** fra `D9vPfXoYuqjzwpe9FaMzF6JYm2QiTUMcjDDX7q7LL1Mm` (2026-07-27) |
| `9NiikpALis1FGMJCH56q5onuPf2q7Vv7SYo8UsKGjyH5` | **~2x** (ikke 3x) | ~1.94 | ~11–15 SOL | Nej | **12.94 SOL** fra `5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9` (Binance-hotwallet, ~1.16M SOL) |

### Fortolkning
- **omego + sssss** = samme stack/operatør (delte Helius-tips + 1x/2x skala).
- **CAvv (3x) / CvKB (4x)** = samme *strategi-familie* (størrelsesregel), men **anden tip-infrastruktur** → sandsynligvis andre operatører eller anden bot-leverandør med samme sizing-logik.
- **9Nii** ligner en mindre 2x-variant fundet via CEX; ikke tip-linket til omego/sssss.
- Enkelte 0.5x-hits i samme blok er ofte one-off og validerer ikke som stabile siblings.

### Blok-rækkefølge omego vs sssss
I 9 delte buy-slots (stikprøve): sssss før omego i 7/9 tilfælde (gap 1–327 positioner), men omego før sssss i 2/9 (store negative gaps). Så sssss er *ofte* hurtigere, men ikke deterministisk — understøtter parallelle bots frem for ren copy-trade.

---

## 4. PnL og exit-regler

### Kort vindue (TradeEvent-rekonstruktion, nyeste ~350 ok-tx ≈ 30–45 min)
| | omego | sssss |
|--|-------|-------|
| Fail-rate (6h sigs) | 18.8% | 27.9% |
| Closed rounds | 155 | 158 |
| Win-rate | 43% | 46% |
| Closed PnL | +4.78 SOL | +10.26 SOL |
| PnL/time (dette vindue) | ~9 SOL/t | ~14 SOL/t |
| Median hold | 33 s | 29 s |
| Winner med. exit | **+12.4%** | **+15.1%** |
| Loser med. exit | **−8.4%** | **−10.9%** |

### Længere vindue (SOL-saldo-proxy — mere ærligt)
| Horisont | omego Δ | omego /t | sssss Δ | sssss /t |
|----------|---------|----------|---------|----------|
| 24h | **−4.02 SOL** | −0.17 | **+3.21 SOL** | +0.13 |
| 72h | **+2.75 SOL** | +0.038 | **+4.85 SOL** | +0.067 |

Kortvindues-PnL overdriver edge (selektivt hot streak). Over 1–3 døgn er edge **lille men positiv for sssss**, **blandet for omego** (rød 24h, grøn 72h). Begge balancer svinger ±5–15 SOL intradag.

### Exit-regler (empirisk)
Ikke et skarpt enkelt TP/SL, men tydelige zoner:

- **Take-profit-zone:** mange vindere lander +10% til +50%; median ~+12–15%.
- **Stop/cut-zone:** mange tabere lander −5% til −20%; median ~−8 til −11%.
- Holdetid typisk **15–90 s** (p25–p75); lidt længere på vindere end tabere.
- I denne stikprøve næsten kun **1 buy / 1 sell** pr. round (få multi-sell) — tidligere “køb i trin”-mønster er ikke dominerende i det seneste vindue.

---

## 5. Hypotese-update

| Hypotese | Status |
|----------|--------|
| Samme strategi | **Bekræftet** (eksakt 1x/2x formel, samme entry-regime) |
| Samme operatør / kommerciel bot | **Stærkt understøttet** via delt Helius tip-rotation |
| sssss altid hurtigere | **Delvist** — oftest før, ikke altid |
| sssss er ny | **Falsk** — aktiv siden mindst 14. aug 2026 |
| Familie med 3x/4x siblings | **Ja, strategisk**; tip-data tyder på *andre* operatører for CAvv/CvKB |
| Samme funding-kilde | **Uafklaret** — genesis ikke nået endnu |

---

## 6. Næste skridt

1. Fortsæt paging til **første tx** for begge (omego stadig før 25. jul; sssss før 14. aug).
2. Når genesis findes: sammenlign funders; tjek om `D9vPfX…` eller andre mellemled overlapper.
3. Track CAvv/CvKB 24–72h PnL og se om de co-trader samme mints systematisk.
4. Kortlæg fuld tip-konto-mængde (Helius Sender set) som fingerprint til at finde flere 1x/2x wallets.
5. Udvid TradeEvent-PnL til stratificeret 24h-sample (ikke kun nyeste 350 tx).

---

## Artefakter

```
solana-bot-analysis/
  scripts/          # rpc, pump_events, find_funding, analyze_pnl, find_siblings*, balance_trajectory
  reports/          # JSON-resultater (PnL, siblings, tips, trajectories)
  data/             # store signature-dumps (gitignored)
```

Kør fx:

```bash
cd solana-bot-analysis
ONLY=omego MAX_PAGES=100 python3 scripts/continue_sigs.py
ONLY=omego HOURS=6 MAX_TXS=350 python3 scripts/analyze_pnl.py
MAX_BLOCKS=12 python3 scripts/find_siblings_deep.py
HOURS=24 POINTS=24 python3 scripts/balance_trajectory.py
```
