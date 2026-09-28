#!/usr/bin/env python3
"""
Scan collected signatures for large native SOL system transfers INTO the wallet.
Also continues to walk older signatures if needed.

This finds funding / top-ups without needing the absolute first tx.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import get_signatures, get_transaction  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data"
REPORTS = Path(__file__).resolve().parents[1] / "reports"
REPORTS.mkdir(parents=True, exist_ok=True)

WALLETS = {
    "omego": "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq",
    "sssss": "sssssDdMNAWKingjpEojkTNdVuZrBe7FsJLaGtexe7d",
}


def ts_iso(unix: int | None) -> str | None:
    if unix is None:
        return None
    return datetime.fromtimestamp(unix, tz=timezone.utc).isoformat()


def extract_inbound_system(tx: dict, wallet: str) -> list[dict]:
    meta = tx.get("meta") or {}
    msg = (tx.get("transaction") or {}).get("message") or {}
    found = []

    def consider(ix: dict):
        if not isinstance(ix, dict):
            return
        if ix.get("program") != "system":
            return
        parsed = ix.get("parsed")
        if not isinstance(parsed, dict):
            return
        if parsed.get("type") != "transfer":
            return
        info = parsed.get("info") or {}
        if info.get("destination") != wallet:
            return
        sol = (info.get("lamports") or 0) / 1e9
        found.append({"from": info.get("source"), "to": wallet, "sol": sol})

    for ix in msg.get("instructions") or []:
        consider(ix)
    for inner in meta.get("innerInstructions") or []:
        for ix in inner.get("instructions") or []:
            consider(ix)
    return found


def scan_label(label: str, address: str, min_sol: float, sample_step: int, max_fetches: int) -> dict:
    path = DATA / f"{label}_signatures.json"
    with open(path) as f:
        sigs = json.load(f)

    # Heuristic: funding/top-ups are rare. Sample every Nth sig PLUS always check
    # the oldest chunk. Also look for balance jumps by fetching when we can't know.
    # Primary: walk oldest 200 + evenly sample older half + newest 50 for top-ups.
    indices = set()
    n = len(sigs)
    for i in range(min(200, n)):
        indices.add(n - 1 - i)  # oldest
    for i in range(0, n, sample_step):
        indices.add(i)
    for i in range(min(50, n)):
        indices.add(i)  # newest

    ordered = sorted(indices)
    if len(ordered) > max_fetches:
        # keep all oldest 200, then downsample rest
        oldest_idx = {n - 1 - i for i in range(min(200, n))}
        rest = [i for i in ordered if i not in oldest_idx]
        need = max_fetches - len(oldest_idx)
        step = max(1, len(rest) // max(1, need))
        chosen = sorted(oldest_idx | set(rest[::step][:need]))
    else:
        chosen = ordered

    print(f"[{label}] scanning {len(chosen)}/{n} txs for inbound ≥{min_sol} SOL", flush=True)
    inbounds: list[dict] = []
    for j, idx in enumerate(chosen):
        s = sigs[idx]
        if j % 40 == 0:
            print(
                f"  [{label}] {j}/{len(chosen)} hits={len(inbounds)} "
                f"t={ts_iso(s.get('blockTime'))}",
                flush=True,
            )
        tx = get_transaction(s["signature"])
        if not tx:
            continue
        for tr in extract_inbound_system(tx, address):
            if tr["sol"] >= min_sol:
                inbounds.append(
                    {
                        **tr,
                        "signature": s["signature"],
                        "slot": s.get("slot"),
                        "blockTime": s.get("blockTime"),
                        "blockTimeIso": ts_iso(s.get("blockTime")),
                        "sig_index_from_newest": idx,
                    }
                )
                print(
                    f"  HIT {tr['sol']:.4f} SOL from {tr['from']} @ {ts_iso(s.get('blockTime'))}",
                    flush=True,
                )

    # Also try to continue toward genesis a bit and scan new oldest
    extra_pages = int(os.environ.get("EXTRA_PAGES", "0"))
    if extra_pages > 0:
        before = sigs[-1]["signature"]
        for p in range(extra_pages):
            batch = get_signatures(address, before=before, limit=1000)
            if not batch:
                break
            sigs.extend(batch)
            before = batch[-1]["signature"]
            print(f"  [{label}] extra page {p+1}: oldest={ts_iso(batch[-1].get('blockTime'))}", flush=True)
            # scan this whole page for funding
            for s in reversed(batch):
                tx = get_transaction(s["signature"])
                if not tx:
                    continue
                for tr in extract_inbound_system(tx, address):
                    if tr["sol"] >= min_sol:
                        inbounds.append(
                            {
                                **tr,
                                "signature": s["signature"],
                                "slot": s.get("slot"),
                                "blockTime": s.get("blockTime"),
                                "blockTimeIso": ts_iso(s.get("blockTime")),
                            }
                        )
                        print(
                            f"  HIT {tr['sol']:.4f} SOL from {tr['from']} @ {ts_iso(s.get('blockTime'))}",
                            flush=True,
                        )
            if len(batch) < 1000:
                break
        with open(path, "w") as f:
            json.dump(sigs, f)

    inbounds.sort(key=lambda x: x.get("blockTime") or 0)
    # Aggregate by funder
    by_funder: dict[str, dict] = {}
    for ev in inbounds:
        f = ev["from"]
        if f not in by_funder:
            by_funder[f] = {"from": f, "total_sol": 0.0, "n": 0, "events": []}
        by_funder[f]["total_sol"] += ev["sol"]
        by_funder[f]["n"] += 1
        by_funder[f]["events"].append(ev)

    report = {
        "label": label,
        "address": address,
        "min_sol": min_sol,
        "sigs_available": n,
        "oldest_available": ts_iso(sigs[-1].get("blockTime")) if sigs else None,
        "newest_available": ts_iso(sigs[0].get("blockTime")) if sigs else None,
        "inbound_events": inbounds,
        "funders": sorted(by_funder.values(), key=lambda x: -x["total_sol"]),
    }
    out = REPORTS / f"{label}_funding_scan.json"
    with open(out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"[{label}] {len(inbounds)} inbound events, {len(by_funder)} funders → {out}", flush=True)
    return report


def main() -> None:
    min_sol = float(os.environ.get("MIN_SOL", "1.0"))
    sample_step = int(os.environ.get("SAMPLE_STEP", "200"))
    max_fetches = int(os.environ.get("MAX_FETCHES", "600"))
    only = os.environ.get("ONLY")
    targets = WALLETS if not only else {only: WALLETS[only]}
    for label, addr in targets.items():
        if not (DATA / f"{label}_signatures.json").exists():
            print(f"SKIP {label}", flush=True)
            continue
        scan_label(label, addr, min_sol, sample_step, max_fetches)


if __name__ == "__main__":
    main()
