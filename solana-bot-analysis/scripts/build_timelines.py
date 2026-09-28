#!/usr/bin/env python3
"""
Build per-round trade timelines around a bot's rounds (entry → exit).

Input: reports/<label>_execution_fingerprint.json (bot's own decoded trades).
Output: data/timelines/<mint>_<entry_ts>.json with every pump.fun TradeEvent on
that mint in [entry - PRE_S, exit + POST_S], ordered by (slot, tx index, event).
"""
from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pump_events import extract_trade_events_from_tx  # noqa: E402
from rpc import get_signatures, get_transactions_batch  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
TL_DIR = ROOT / "data" / "timelines"
TL_DIR.mkdir(parents=True, exist_ok=True)

PRE_S = int(os.environ.get("PRE_S", "45"))
POST_S = int(os.environ.get("POST_S", "10"))
MAX_TX = int(os.environ.get("MAX_TX", "600"))


def bot_rounds(label: str) -> tuple[str, list[dict]]:
    d = json.loads((REPORTS / f"{label}_execution_fingerprint.json").read_text())
    trades = []
    for r in d["records"]:
        e = r.get("event")
        if r["err"] or not e:
            continue
        trades.append({**e, "signature": r["signature"], "slot": r["slot"]})
    trades.sort(key=lambda t: (t["slot"], t["timestamp"]))
    by_mint: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        by_mint[t["mint"]].append(t)
    rounds = []
    for mint, ts in by_mint.items():
        cur: list[dict] = []
        for t in ts:
            if t["is_buy"]:
                cur.append(t)
            elif cur:
                cur.append(t)
                rounds.append({"mint": mint, "trades": cur})
                cur = []
    return d["wallet"], rounds


def window_sigs(mint: str, t_start: int, t_end: int, before: str | None = None) -> list[dict]:
    out: list[dict] = []
    for _ in range(30):
        batch = get_signatures(mint, before=before, limit=1000)
        if not batch:
            break
        for s in batch:
            bt = s.get("blockTime") or 0
            if t_start <= bt <= t_end and s.get("err") is None:
                out.append(s)
        before = batch[-1]["signature"]
        if (batch[-1].get("blockTime") or 0) < t_start or len(batch) < 1000:
            break
    return out


def build(rnd: dict) -> dict:
    mint = rnd["mint"]
    entry = rnd["trades"][0]["timestamp"]
    exit_ = rnd["trades"][-1]["timestamp"]
    # Page backwards from the bot's own exit so busy mints don't require walking
    # through everything that happened since; the exit tx itself is appended.
    last = rnd["trades"][-1]
    sigs = window_sigs(mint, entry - PRE_S, exit_, before=last["signature"])
    sigs.append({"signature": last["signature"], "slot": last["slot"], "transactionIndex": None})
    own = {t["signature"] for t in rnd["trades"]}
    if len(sigs) > MAX_TX:
        sigs = [s for s in sigs if s["signature"] in own] + [
            s for s in sigs if s["signature"] not in own
        ][:MAX_TX]
    txs = get_transactions_batch([s["signature"] for s in sigs], chunk=8, pause_ms=200)
    events = []
    for s in sigs:
        tx = txs.get(s["signature"])
        if not tx:
            continue
        for k, ev in enumerate(extract_trade_events_from_tx(tx)):
            if ev["mint"] != mint:
                continue
            events.append(
                {
                    **ev,
                    "signature": s["signature"],
                    "slot": s["slot"],
                    "tx_index": s.get("transactionIndex"),
                    "ev_index": k,
                }
            )
    events.sort(key=lambda e: (e["slot"], e["tx_index"] or 0, e["ev_index"]))
    return {
        "mint": mint,
        "entry_ts": entry,
        "exit_ts": exit_,
        "bot_signatures": sorted(own),
        "n_sigs": len(sigs),
        "events": events,
    }


def main() -> None:
    label = os.environ.get("LABEL", "omego")
    max_rounds = int(os.environ.get("MAX_ROUNDS", "60"))
    workers = int(os.environ.get("WORKERS", "2"))
    wallet, rounds = bot_rounds(label)
    rounds = rounds[:max_rounds]
    todo = [
        r for r in rounds
        if not (TL_DIR / f"{r['mint']}_{r['trades'][0]['timestamp']}.json").exists()
    ]
    print(f"[{label}] {len(rounds)} rounds, building {len(todo)}", flush=True)

    def work(r: dict) -> None:
        try:
            tl = build(r)
            tl["bot_wallet"] = wallet
            path = TL_DIR / f"{r['mint']}_{tl['entry_ts']}.json"
            path.write_text(json.dumps(tl))
            n_bot = sum(1 for e in tl["events"] if e["user"] == wallet)
            print(
                f"  {r['mint'][:8]}… sigs={tl['n_sigs']} events={len(tl['events'])} bot={n_bot}",
                flush=True,
            )
        except Exception as e:  # noqa: BLE001
            print(f"  {r['mint'][:8]}… FAILED {e}", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, todo))
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
