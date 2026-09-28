#!/usr/bin/env python3
"""
Deeper sibling hunt:
1. Find slots/mints where omego AND sssss both traded (from trade JSON).
2. Sample additional omego-buy slots.
3. Collect formula-class buyers; validate candidates by fetching their recent txs.
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pump_events import expected_omego_size, extract_trade_events_from_tx, size_multiple  # noqa: E402
from rpc import get_block, get_signatures, get_transaction, get_balance  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"
REPORTS = Path(__file__).resolve().parents[1] / "reports"

OMEGO = "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq"
SSSSS = "sssssDdMNAWKingjpEojkTNdVuZrBe7FsJLaGtexe7d"


def classify_mult(m: float | None) -> str | None:
    if m is None:
        return None
    for name, center in [("1x", 1.0), ("2x", 2.0), ("3x", 3.0), ("0.5x", 0.5), ("4x", 4.0)]:
        if abs(m - center) / center <= 0.15:
            return name
    return None


def load_trades(pattern: str) -> list[dict]:
    files = sorted(DATA.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        return []
    with open(files[0]) as f:
        return json.load(f)


def main() -> None:
    omego_trades = load_trades("omego_trades_*h.json")
    sssss_trades = load_trades("sssss_trades_*h.json")
    print(f"omego trades={len(omego_trades)} sssss trades={len(sssss_trades)}", flush=True)

    omego_buys = [t for t in omego_trades if t.get("is_buy")]
    sssss_buys = [t for t in sssss_trades if t.get("is_buy")]

    omego_slots = {t["slot"] for t in omego_buys if t.get("slot") is not None}
    sssss_slots = {t["slot"] for t in sssss_buys if t.get("slot") is not None}
    shared_slots = sorted(omego_slots & sssss_slots, reverse=True)
    print(f"shared buy slots in sample: {len(shared_slots)}", flush=True)

    omego_mints = {t["mint"] for t in omego_buys}
    sssss_mints = {t["mint"] for t in sssss_buys}
    shared_mints = omego_mints & sssss_mints
    print(f"shared mints in sample: {len(shared_mints)}", flush=True)

    # Prefer shared slots, then slots for shared mints, then other omego buys
    mint_to_omego_slots = defaultdict(list)
    for t in omego_buys:
        if t.get("slot") is not None:
            mint_to_omego_slots[t["mint"]].append(t["slot"])

    candidate_slots: list[int] = []
    for s in shared_slots:
        if s not in candidate_slots:
            candidate_slots.append(s)
    for m in shared_mints:
        for s in mint_to_omego_slots[m]:
            if s not in candidate_slots:
                candidate_slots.append(s)
    for t in omego_buys:
        s = t.get("slot")
        if s is not None and s not in candidate_slots:
            candidate_slots.append(s)

    max_blocks = int(os.environ.get("MAX_BLOCKS", "15"))
    sample = candidate_slots[:max_blocks]
    print(f"sampling {len(sample)} blocks", flush=True)

    observations: dict[str, list[dict]] = defaultdict(list)
    co_occurrence = []  # per block notes

    for i, slot in enumerate(sample):
        print(f"  [{i+1}/{len(sample)}] getBlock({slot})", flush=True)
        block = get_block(slot, transactions=True)
        if not block:
            continue
        order_idx = 0
        slot_events = []
        for tx_wrap in block.get("transactions") or []:
            meta = tx_wrap.get("meta") or {}
            if meta.get("err") is not None:
                order_idx += 1
                continue
            fake = {"meta": meta, "transaction": tx_wrap.get("transaction")}
            for ev in extract_trade_events_from_tx(fake):
                if not ev["is_buy"]:
                    continue
                mult = size_multiple(ev["sol_amount"], ev["real_sol"])
                klass = classify_mult(mult)
                rec = {
                    "slot": slot,
                    "order_idx": order_idx,
                    "mint": ev["mint"],
                    "user": ev["user"],
                    "sol_amount": ev["sol_amount"],
                    "real_sol": ev["real_sol"],
                    "expected_1x": expected_omego_size(ev["real_sol"]),
                    "size_mult": mult,
                    "size_class": klass,
                }
                slot_events.append(rec)
                if klass:
                    observations[ev["user"]].append(rec)
            order_idx += 1

        # Who of interest in this slot
        by_user = {e["user"]: e for e in slot_events}
        om = [e for e in slot_events if e["user"] == OMEGO]
        ss = [e for e in slot_events if e["user"] == SSSSS]
        formula = [e for e in slot_events if e.get("size_class")]
        co_occurrence.append(
            {
                "slot": slot,
                "omego": om,
                "sssss": ss,
                "formula_others": [
                    e for e in formula if e["user"] not in (OMEGO, SSSSS)
                ],
                "omego_before_sssss": None
                if not om or not ss
                else min(e["order_idx"] for e in ss) < min(e["order_idx"] for e in om),
            }
        )
        print(
            f"    omego={len(om)} sssss={len(ss)} formula_others="
            f"{len([e for e in formula if e['user'] not in (OMEGO, SSSSS)])}",
            flush=True,
        )

    # Aggregate
    wallet_stats = []
    for user, obs in observations.items():
        classes = [o["size_class"] for o in obs if o.get("size_class")]
        c = Counter(classes)
        dominant, dom_n = c.most_common(1)[0]
        label = "omego" if user == OMEGO else ("sssss" if user == SSSSS else None)
        mults = [o["size_mult"] for o in obs if o.get("size_mult") is not None]
        wallet_stats.append(
            {
                "user": user,
                "label": label,
                "n_obs": len(obs),
                "class_counts": dict(c),
                "dominant_class": dominant,
                "avg_mult": sum(mults) / len(mults) if mults else None,
                "mult_std": (
                    (sum((x - sum(mults) / len(mults)) ** 2 for x in mults) / len(mults)) ** 0.5
                    if len(mults) > 1
                    else 0.0
                ),
                "mints": sorted({o["mint"] for o in obs}),
                "slots": sorted({o["slot"] for o in obs}),
            }
        )
    wallet_stats.sort(key=lambda w: (-w["n_obs"], -(w["avg_mult"] or 0)))

    # Validate top unknown candidates (n_obs>=1 with 1x/2x/3x) by pulling their own recent buys
    candidates = [
        w
        for w in wallet_stats
        if w["label"] is None and w["dominant_class"] in ("0.5x", "1x", "2x", "3x", "4x")
    ]
    validated = []
    max_validate = int(os.environ.get("MAX_VALIDATE", "8"))
    for w in candidates[:max_validate]:
        user = w["user"]
        print(f"validating {user} ({w['dominant_class']})…", flush=True)
        try:
            bal = get_balance(user)
        except Exception:
            bal = None
        sigs = get_signatures(user, limit=40)
        buy_mults = []
        for s in sigs:
            if s.get("err") is not None:
                continue
            tx = get_transaction(s["signature"])
            if not tx:
                continue
            for ev in extract_trade_events_from_tx(tx):
                if ev["user"] != user or not ev["is_buy"]:
                    continue
                m = size_multiple(ev["sol_amount"], ev["real_sol"])
                if m is not None:
                    buy_mults.append(m)
            if len(buy_mults) >= 15:
                break
        if buy_mults:
            avg = sum(buy_mults) / len(buy_mults)
            med = sorted(buy_mults)[len(buy_mults) // 2]
            klass = classify_mult(med)
        else:
            avg = med = klass = None
        validated.append(
            {
                **w,
                "balance_sol": bal,
                "validated_n_buys": len(buy_mults),
                "validated_avg_mult": avg,
                "validated_median_mult": med,
                "validated_class": klass,
                "validated_mults_sample": buy_mults[:20],
            }
        )
        print(
            f"  bal={bal} n={len(buy_mults)} med_mult={med} class={klass}",
            flush=True,
        )

    # Ordering stats for shared slots
    order_stats = []
    for c in co_occurrence:
        if c["omego"] and c["sssss"]:
            order_stats.append(
                {
                    "slot": c["slot"],
                    "sssss_first": c["omego_before_sssss"],
                    "sssss_idx": min(e["order_idx"] for e in c["sssss"]),
                    "omego_idx": min(e["order_idx"] for e in c["omego"]),
                    "gap": min(e["order_idx"] for e in c["omego"])
                    - min(e["order_idx"] for e in c["sssss"]),
                }
            )

    report = {
        "shared_slots_in_trade_sample": shared_slots,
        "shared_mints_count": len(shared_mints),
        "shared_mints": sorted(shared_mints),
        "order_stats": order_stats,
        "wallet_stats": wallet_stats,
        "validated_candidates": validated,
        "co_occurrence": co_occurrence,
    }
    out = REPORTS / "sibling_deep.json"
    with open(out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Wrote {out}", flush=True)
    print("Order gaps (sssss before omego):", flush=True)
    for o in order_stats:
        print(f"  slot {o['slot']}: gap={o['gap']} (sssss@{o['sssss_idx']} omego@{o['omego_idx']})", flush=True)
    print("Validated:", flush=True)
    for v in validated:
        print(
            f"  {v['validated_class'] or '?':4} med={v['validated_median_mult']} "
            f"bal={v['balance_sol']} {v['user']}",
            flush=True,
        )


if __name__ == "__main__":
    main()
