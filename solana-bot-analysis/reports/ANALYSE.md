# Solana bot on-chain analyse — omego & sssss

Dato: 2026-09-28  
RPC: `https://api.mainnet-beta.solana.com`

## Wallets

| Label | Address | Balance (ca.) | Historik |
|-------|---------|---------------|----------|
| omego | `omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq` | ~63 SOL | ≥930k tx, tilbage til **2026-06-02** (genesis ikke nået) |
| sssss | `sssssDdMNAWKingjpEojkTNdVuZrBe7FsJLaGtexe7d` | ~118 SOL | **292 497 tx — fuld historik** fra **2026-08-13 19:25 UTC** |

**Korrektion:** sssss er ikke “ny” den 27. sep. Den blev oprettet **13. aug 2026**.

---

## 1. Funding — FUNDET for sssss

### sssss genesis
- **Tx:** `37QCRGhCN7nfMHGqAbDo5NW2gkX1bccxzN3CeCohAgemNM4mygnCHeGqvhXpZjTCE7inPM5mDGZAJFPSfJmCLWoS`
- **Tid:** 2026-08-13T19:25:51Z
- **Beløb:** **120.0 SOL** (konto 0 → 120)
- **Funder / fee payer:** `CsWMAj1XMK9bCZHjXM7eaYw3era7apSUcG43EZtiy85u`
- Relateret dust-afsender (samme vanity-suffix `…z85u`): `Cs12bfrems1WjNBz8r7wRJ9mviXcG2KzBdvzvpx3z85u`

### CsWMA = profit-treasury / master-wallet
- Saldo nu: **~1122 SOL**
- Modtager **timevise profit-sweeps** fra sssss (typisk :53 hvert time)
- Samplede sweeps fra `sssssDd…` alene: **≥1250 SOL** (ikke komplet historik)
- Seneste dage (sssssDd → CsWMA):

| Dag | Swept SOL |
|-----|-----------|
| 2026-09-24 | 103 |
| 2026-09-25 | 195 |
| 2026-09-26 | **388** |
| 2026-09-27 | **245** |
| 2026-09-28 (delvis) | 40 |

→ **Reel PnL for sssss er titals–hundreder SOL/dag**, ikke de ~0.07 SOL/t man ser på wallet-saldoen (saldoen holdes flad ~120 SOL mens overskud fejes væk).

### Andre CsWMA-links (samme operatør-klynge)
| Address | Rolle |
|---------|--------|
| `ssssswdk4RR8HqkE3uwUWzDbd6mXFTTPjcXBKNzQ57E` | Søskende-bot (samme `sssss`-prefix); har også fejet profit til CsWMA (≥823 SOL i sample) |
| `HK3J9zTFz3qBTNtcja3v9cZmSRfGEM3upXwK6GBuKHrT` | Kapital-buffer (cirkulære transfers med CsWMA) |
| `8bAVCeuQd9akudbotz4Ug3nv7e2KHVL2NTPtDaZLjvee` | Stor udbetalingsadresse (~**13 000 SOL** saldo; modtog 1500 fra CsWMA) |
| `CXdZ6m2PotNq4D7zKK3af426ohGro1xingNuf68SoKmv` | Indbetalingskilde til CsWMA (427 SOL, 13. aug) |

### omego funding
- Stadig **uafklaret** (historik til juni, stadig ikke genesis).
- Ingen store system-transfer top-ups i samplede vinduer.
- Ingen direkte funding fra CsWMA observeeret.
- Ingen tydelig profit-sweep til ekstern treasury i sample (store outs ≥5 SOL ikke fundet; `7Leyget…` er midlertidig wSOL som tidligere noteret).

### Delte tip-konti er IKKE et operatør-signal
omego og sssss tipper de samme konti (`3KCKozb…`, `4TQLFNWK…`, `5VY91ws6…`, `2nyhqdwK…`, `2q5pghRs…`, `4vieeGHP…`, `wyvPkWjV…`, `D2L6yPZ2…`), men det er Helius Senders **offentlige, faste tip-sæt**, som alle Sender-brugere roterer imellem. Overlappet viser kun, at begge bruger Helius Sender. Koblingen omego ↔ sssss hviler derfor alene på den identiske størrelsesformel (1x/2x) og co-trading, ikke på fælles funding eller treasury.

---

## 2. Størrelsesformel — bekræftet

`buy_sol ≈ 0.286 + 0.00934 × real_sol`

| Wallet | Median mult | p10–p90 |
|--------|-------------|---------|
| omego | **1.000** | 0.992–1.008 |
| sssss | **1.949** | 1.939–1.976 |
| ratio på 18 delte mints | **1.959** | — |

Entry real-SOL median ~15 SOL (mid-curve).

---

## 3. Søskende (formel-familie)

| Address | Klasse | Tip-overlap omego/sssss | Note |
|---------|--------|-------------------------|------|
| `ssssswdk4RR8HqkE3uwUWzDbd6mXFTTPjcXBKNzQ57E` | sssss-familie | via CsWMA | Samme vanity + treasury |
| `CAvvAFNRfXDWTTDqwgxb9qSyYT8fTuTXWSFwL7Jsz8vT` | **3x** (~3.2) | Nej | ~219 SOL |
| `CvKBPvEmcvsVPa5gCcvKwNAGUwUhMQNbRv4mdpGtTEWo` | **4x** (~4.0) | Nej | Fundet med 110 SOL fra `D9vPfX…` |
| `9NiikpALis1FGMJCH56q5onuPf2q7Vv7SYo8UsKGjyH5` | **~2x** | Nej | Fundet fra Binance-hotwallet `5tzFki…` |

CAvv/CvKB = samme *sizing-strategi*, sandsynligvis **anden operatør** (ingen tip-/treasury-overlap).

### Blok-rækkefølge
I 9 delte buy-slots: sssss før omego i 7/9 (gap 1–327). Ikke ren copy-trade.

---

## 4. PnL og exit-regler

### TradeEvent-stikprøve (~30–45 min, 350 ok-tx)
| | omego | sssss |
|--|-------|-------|
| Fail-rate (6h) | 18.8% | 27.9% |
| Win-rate | 43% | 46% |
| Median hold | 33 s | 29 s |
| Winner exit (med.) | **+12.4%** | **+15.1%** |
| Loser exit (med.) | **−8.4%** | **−10.9%** |

### Wallet-saldo-proxy (MISVISENDE for sssss pga. sweeps)
| Horisont | omego Δ | sssss Δ |
|----------|---------|---------|
| 24h | −4.0 SOL | +3.2 SOL |
| 72h | +2.8 SOL | +4.9 SOL |

### Reel sssss-PnL via treasury-sweeps
- **~200–390 SOL/dag** i de mest profitable seneste dage (25–27. sep)
- Wallet holdes bevidst omkring seed-kapital (~120 SOL)

### Exit-regler (empirisk)
- TP-zone ca. **+10% til +50%** (median vindere ~+12–15%)
- SL/cut-zone ca. **−5% til −20%** (median tabere ~−8 til −11%)
- Holdetid typisk **15–90 s**
- Seneste vindue: mest 1 buy / 1 sell pr. round

---

## 4b. Eksakt sizing-regel (erstatter den fittede formel)

Rekonstrueret lamport-præcist fra 159 omego-køb (`reports/omego_execution_fingerprint.json`):

```
max_sol_cost = floor(virtual_sol_reserves / 100)            # 1 % af kurvens virtuelle SOL
token_amount = tokens for (max_sol_cost × 0.95 / 1.0005) SOL  # 5 % slippage-pude
```

- 81/159 køb rammer `max_sol_cost = vs/100` **eksakt**; resten afviger kun fordi andre handler landede foran omego i blokken (reserverne havde flyttet sig).
- Den tidligere fittede `0.286 + 0.00934 × real_sol` er blot netto-fyldet af denne regel (0.286/0.00934 ≈ 30.6 ≈ de 30 SOL initiale virtuelle reserver).
- sssss (≈1.95×) svarer til 2 % af virtual SOL.
- Kurvematematik (`cost = t·vs/(vt−t)+1`, `proceeds = t·vs/(vt+t)`) matcher 159/159 køb og 160/160 salg.

## 4c. Execution-fingerprint (400 tx)

| | Køb | Salg |
|--|-----|------|
| Rute | 54 % direkte / 46 % wrapper `bDZuQL…` | 51 % / 49 % |
| Instruktion | `buy` 65 % / `buy_v2` 35 % | `sell` 57 % / `sell_v2` 43 % |
| CU-limit (direkte/wrapper) | 175k / 200k | 200k / 220k |
| Prioritet | 500 000 µLamports/CU | 500 000 µLamports/CU |
| Tip (Helius Sender) | 200 000 lamports | 20 000 lamports |
| Slippage | `max_sol_cost` = 5.3 % over netto-fyld | `min_sol_output = 0` |
| Fejlrate | 27 % (6002 TooMuchSolRequired) | 7.5 % (3012 = allerede solgt; retries) |

- Transaktions-version 1 uden LUT'er og uden ComputeBudget-instruktioner (budget ligger i v1-headeren).
- Køb: opret token-ATA → (wrap wSOL) → pump `buy` → luk wSOL → tip. Salg: pump `sell` → luk token-ATA og wSOL → tip. Altid fuld exit i én tx.
- Salg genudsendes hver 1–2 slots, indtil ét lander.

## 4d. Exit-adfærd (148 runder, egne handler)

- **Hårdt tidsstop på 1800 s** (flere runder slutter på præcis 1800/1801 s).
- Exit-afkast klumper ikke ved faste TP/SL-niveauer → exits er hændelsesdrevne.
- Tidslinjer (reserve-kædet rækkefølge i slot) viser: gevinst-exits sker typisk **på toppen i samme slot som et stort køb** (sælger ind i styrke); tabs-exits sker ved **drawdown fra top ≈ 5–10 %** eller i samme slot som store salg (gap-downs giver −30…−50 %).
- Entries sker oftest efter et **prisspring på +5…12 % over 1–2 slots** / et køb på ≈2–4 % af virtual SOL, og på **meget aktive mints** (omego genhandler de samme få mints).

## 4e. Beslutningslogik: hvad kan og kan ikke genskabes (live-optagelse)

Datagrundlag: 17 min fuld pump.fun-strøm via WebSocket (`omego-bot/scripts/record.ts`, ~95 % dækning), 91 omego-køb / 77 runder, omego-PnL **+2.03 SOL** (≈ +7 SOL/t, win 48 %, median-runde −0.5 %, gennemsnit +2.4 %).

| Test | Resultat |
|------|----------|
| Timing | **92 % af omegos køb lander lige efter et andet køb**, 75 % i samme slot → backrunning i samme slot |
| Trigger-købets størrelse | 0.006–3 SOL (bredt); kun svagt forskelligt fra andre køb (runde beløb 24 % vs 12 %, mid-curve 85 % vs 53 %) |
| Mint-udvælgelse | Omegos mint er top-5 mest aktive (10 s) ved ~55 % af købene; genhandler samme få mints |
| Copy-trade af én leder-wallet | Nej (entry-køber sælger før exit i 17/77 runder) |
| Exit = trailing/TP/stop | Bedste prisregel rammer exit-slot ±2 i 18/77 runder |
| Beslutningstræer (markedsfeatures) | Test-præcision 5 % (entry) / 15 % (exit) — generaliserer ikke |
| Random search af regelsæt (samme engine som botten) | Top-5 på træning taber alle på test |
| **Spejling af omego** (købe/sælge når vi ser dens tx) | lag 0 slots: +0.26 SOL, **lag 1: −0.23**, lag 2: −1.31 (vs omego +2.03) |

**Konklusion:** Sizing, eksekvering og tidsstop er genskabt eksakt. Selve *hvornår*-beslutningen styres af et signal, der ikke kan udledes af on-chain-handelsdata alene, og omegos fordel ligger i at handle **i samme slot** som signalet. At følge efter (≥1 slot) er tabsgivende.

## 5. Hypoteser — status

| Hypotese | Status |
|----------|--------|
| Samme strategi (1x/2x formel) | **Bekræftet** |
| Samme infrastruktur | Begge bruger Helius Sender (offentligt tip-sæt, siger intet om operatør) |
| Samme operatør | **Stærkt for sssss-klyngen** (CsWMA treasury + sssss* vanity). omego: kun formel-lighed; kan være samme kommercielle bot med anden konfiguration. Funding åben |
| sssss “ny og ekstremt profitabel” | Delvist: ikke ny (aug); **meget profitabel** (hundreder SOL/dag via sweeps) |
| sssss altid hurtigere end omego | Ofte, ikke altid |

---

## 6. Næste skridt

1. Nå **omego genesis** (stadig før 2. jun) og sammenlign funder med CsWMA / `8bAVCeu…` / `CXdZ6m2…`.
2. Fingerprint flere wallets via størrelsesformel, vanity `sssss*` og sweeps til CsWMA (tip-konti er ubrugelige som fingerprint).
3. Fuld sum af CsWMA-inbounds (scan alle 1476 sigs) for præcis lifetime-PnL.
4. Analysér `ssssswdk4…` sizing og om den stadig er aktiv.
5. Stratificeret 24h TradeEvent-PnL for omego (uden treasury-bias).

---

## Artefakter & kørsel

```bash
cd solana-bot-analysis
pip install -r requirements.txt
ONLY=sssss MAX_PAGES=50 python3 scripts/continue_sigs.py   # done: reached genesis
ONLY=omego HOURS=6 MAX_TXS=350 python3 scripts/analyze_pnl.py
MAX_BLOCKS=12 python3 scripts/find_siblings_deep.py
HOURS=24 POINTS=24 python3 scripts/balance_trajectory.py
```

Nøglerapporter: `reports/ANALYSE.md`, `sssss_genesis.json`, `sssss_funder_CsWMA.json`, `tip_overlap.json`, `sibling_deep.json`, `*_pnl_*`, `*_balance_traj_*`.
