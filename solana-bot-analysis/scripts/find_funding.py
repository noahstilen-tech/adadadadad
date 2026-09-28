#!/usr/bin/env python3
"""Find funding sources for bot wallets by walking signature history to genesis."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc import get_balance, get_signatures, get_transaction  # noqa: E402

WALLETS = {
    "omego": "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq",
    "sssss": "sssssDdMNAWKingjpEojkTNdVuZrBe7FsJLaGtexe7d",
}
DATA = Path(__file__).resolve().parents[1] / "data"
DATA.mkdir(parents=True, exist_ok=True)


def ts_iso(unix: int | None) -> str | None:
    if unix is None:
        return None
    return datetime.fromtimestamp(unix, tz=timezone.utc).isoformat()


def collect_all_signatures(label: str, address: str, max_pages: int = 50) -> list[dict]:
    out_path = DATA / f"{label}_signatures.json"
    sigs: list[dict] = []
    before: str | None = None
    page = 0
    while page < max_pages:
        page += 1
        batch = get_signatures(address, before=before, limit=1000)
        if not batch:
            break
        sigs.extend(batch)
        before = batch[-1]["signature"]
        oldest = batch[-1].get("blockTime")
        print(
            f"  [{label}] page {page}: +{len(batch)} (total {len(sigs)}) "
            f"oldest={ts_iso(oldest)}",
            flush=True,
        )
        if len(batch) < 1000:
            break
        # checkpoint
        with open(out_path, "w") as f:
            json.dump(sigs, f)
    with open(out_path, "w") as f:
        json.dump(sigs, f)
    print(f"  [{label}] wrote {len(sigs)} sigs → {out_path}", flush=True)
    return sigs


def extract_sol_transfers(tx: dict, wallet: str) -> list[dict]:
    """Return native SOL balance deltas involving wallet, plus parsed system transfers."""
    results: list[dict] = []
    meta = tx.get("meta") or {}
    msg = (tx.get("transaction") or {}).get("message") or {}
    keys = []
    for k in msg.get("accountKeys") or []:
        if isinstance(k, dict):
            keys.append(k.get("pubkey"))
        else:
            keys.append(k)
    if wallet not in keys:
        return results
    idx = keys.index(wallet)
    pre = (meta.get("preBalances") or [None])[idx] if idx < len(meta.get("preBalances") or []) else None
    post = (meta.get("postBalances") or [None])[idx] if idx < len(meta.get("postBalances") or []) else None
    delta = None
    if pre is not None and post is not None:
        delta = (post - pre) / 1e9

    # Parsed system transfers
    for group in (msg.get("instructions") or []) + [
        ix for inner in (meta.get("innerInstructions") or []) for ix in (inner.get("instructions") or [])
    ]:
        parsed = group.get("parsed") if isinstance(group, dict) else None
        if not isinstance(parsed, dict):
            continue
        if parsed.get("type") not in ("transfer", "transferChecked"):
            # system transfer
            info = parsed.get("info") or {}
            typ = parsed.get("type")
            if typ == "transfer" and group.get("program") == "system":
                dest = info.get("destination")
                src = info.get("source")
                lamports = info.get("lamports")
                if dest == wallet or src == wallet:
                    results.append(
                        {
                            "kind": "system_transfer",
                            "from": src,
                            "to": dest,
                            "sol": (lamports or 0) / 1e9,
                            "direction": "in" if dest == wallet else "out",
                        }
                    )
    results.append(
        {
            "kind": "balance_delta",
            "wallet": wallet,
            "pre_sol": None if pre is None else pre / 1e9,
            "post_sol": None if post is None else post / 1e9,
            "delta_sol": delta,
        }
    )
    return results


def analyze_funding(label: str, address: str, sigs: list[dict], lookback: int = 40) -> dict:
    """Inspect oldest transactions for inbound SOL funding."""
    # signatures are newest-first; reverse for chronological
    oldest = list(reversed(sigs[-lookback:]))
    funding_events: list[dict] = []
    first_inbound: dict | None = None

    for i, s in enumerate(oldest):
        sig = s["signature"]
        print(f"  [{label}] fetching oldest[{i}] {sig[:12]}… t={ts_iso(s.get('blockTime'))}", flush=True)
        tx = get_transaction(sig)
        if not tx:
            continue
        transfers = extract_sol_transfers(tx, address)
        inbound = [t for t in transfers if t.get("kind") == "system_transfer" and t.get("direction") == "in"]
        delta = next((t for t in transfers if t.get("kind") == "balance_delta"), None)
        entry = {
            "signature": sig,
            "slot": s.get("slot"),
            "blockTime": s.get("blockTime"),
            "blockTimeIso": ts_iso(s.get("blockTime")),
            "err": s.get("err"),
            "inbound_transfers": inbound,
            "balance_delta": delta,
            "fee_payer": None,
        }
        # fee payer
        msg = (tx.get("transaction") or {}).get("message") or {}
        keys = msg.get("accountKeys") or []
        if keys:
            k0 = keys[0]
            entry["fee_payer"] = k0.get("pubkey") if isinstance(k0, dict) else k0
        funding_events.append(entry)
        if inbound and first_inbound is None:
            # prefer first chronologically with meaningful amount
            meaningful = [t for t in inbound if (t.get("sol") or 0) >= 0.01]
            if meaningful:
                first_inbound = {
                    **entry,
                    "primary_funders": meaningful,
                }

    # Also scan ALL sigs for large inbound system transfers by sampling:
    # look at first N successful txs after account creation for bigger picture
    report = {
        "label": label,
        "address": address,
        "balance_sol": get_balance(address),
        "signature_count_fetched": len(sigs),
        "oldest_sig": sigs[-1] if sigs else None,
        "newest_sig": sigs[0] if sigs else None,
        "oldest_block_time": ts_iso(sigs[-1].get("blockTime")) if sigs else None,
        "newest_block_time": ts_iso(sigs[0].get("blockTime")) if sigs else None,
        "first_inbound": first_inbound,
        "oldest_tx_details": funding_events,
    }
    out = DATA / f"{label}_funding.json"
    with open(out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"  [{label}] funding report → {out}", flush=True)
    return report


def main() -> None:
    # Allow limiting pages via env for faster iteration
    max_pages = int(os.environ.get("MAX_PAGES", "80"))
    only = os.environ.get("ONLY")  # omego|sssss
    targets = WALLETS if not only else {only: WALLETS[only]}

    reports = {}
    for label, addr in targets.items():
        print(f"\n=== {label} ({addr}) ===", flush=True)
        bal = get_balance(addr)
        print(f"  balance: {bal:.4f} SOL", flush=True)
        # Resume if signatures already collected
        sig_path = DATA / f"{label}_signatures.json"
        if sig_path.exists() and os.environ.get("RESUME_SIGS") == "1":
            with open(sig_path) as f:
                sigs = json.load(f)
            print(f"  resumed {len(sigs)} signatures", flush=True)
        else:
            sigs = collect_all_signatures(label, addr, max_pages=max_pages)
        reports[label] = analyze_funding(label, addr, sigs)

    summary_path = DATA / "funding_summary.json"
    with open(summary_path, "w") as f:
        json.dump(reports, f, indent=2)
    print(f"\nSummary → {summary_path}", flush=True)

    for label, r in reports.items():
        print(f"\n--- {label} ---")
        print(f"  sigs: {r['signature_count_fetched']}")
        print(f"  oldest: {r['oldest_block_time']}")
        print(f"  newest: {r['newest_block_time']}")
        fi = r.get("first_inbound")
        if fi:
            for t in fi.get("primary_funders") or []:
                print(f"  FUNDING: {t['sol']:.4f} SOL from {t['from']} @ {fi['blockTimeIso']}")
                print(f"    tx: {fi['signature']}")
        else:
            print("  FUNDING: not found in oldest window — may need deeper look / non-system transfer")


if __name__ == "__main__":
    main()
