#!/usr/bin/env python3
"""
Execution fingerprint of a bot wallet: how its pump.fun transactions are built.

Per tx: route (direct pump vs wrapper program), buy_v2/sell_v2 args vs actual
fill (slippage tolerance), compute-unit limit, priority fee, tip, sell fraction.
"""
from __future__ import annotations

import json
import os
import re
import struct
import sys
from collections import Counter
from pathlib import Path
from statistics import median

import base58

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pump_events import PUMP_PROGRAM, extract_trade_events_from_tx  # noqa: E402
from rpc import get_signatures, get_transactions_batch  # noqa: E402

REPORTS = Path(__file__).resolve().parents[1] / "reports"
DATA = Path(__file__).resolve().parents[1] / "data"

DISC = {
    bytes([184, 23, 238, 97, 103, 197, 211, 61]): "buy_v2",
    bytes([93, 246, 130, 60, 231, 233, 64, 178]): "sell_v2",
    bytes([102, 6, 61, 18, 1, 218, 235, 234]): "buy",
    bytes([51, 230, 133, 164, 1, 127, 131, 173]): "sell",
    bytes([56, 252, 116, 8, 158, 223, 205, 95]): "buy_exact_sol_in",
}
SYSTEM = "11111111111111111111111111111111"
CU_RE = re.compile(r"consumed (\d+) of (\d+) compute units")


def account_keys(tx: dict) -> list[str]:
    msg = tx["transaction"]["message"]
    return [k["pubkey"] if isinstance(k, dict) else k for k in msg["accountKeys"]]


def decode_pump_ix(data_b58: str) -> dict | None:
    raw = base58.b58decode(data_b58)
    name = DISC.get(raw[:8])
    if not name or len(raw) < 24:
        return None
    a, b = struct.unpack_from("<QQ", raw, 8)
    return {"name": name, "arg0": a, "arg1": b}


def fingerprint_tx(sig: str, tx: dict, wallet: str) -> dict:
    meta = tx["meta"]
    msg = tx["transaction"]["message"]
    logs = meta.get("logMessages") or []
    rec: dict = {
        "signature": sig,
        "slot": tx["slot"],
        "err": meta.get("err"),
        "fee": meta["fee"],
        "cu_consumed": meta.get("computeUnitsConsumed"),
        "version": tx.get("version"),
        "n_ix": len(msg["instructions"]),
    }
    m = CU_RE.search("\n".join(logs))
    first_budget = None
    for line in logs:
        mm = CU_RE.search(line)
        if mm:
            # first top-level "consumed X of Y" after first invoke gives limit-ish value
            first_budget = int(mm.group(2))
            break
    rec["cu_limit_est"] = None
    # the first logged budget is remaining budget at an inner program; use the outer
    # top-level instruction's "of Y" which equals the tx limit for the first ix
    for line in logs:
        if line.startswith("Program ") and " consumed " in line and "invoke" not in line:
            pass
    tops = [l for l in logs if re.match(r"Program \S+ consumed \d+ of \d+ compute units", l)]
    # the first *top-level* ix consumes against the full limit; its line has the largest Y
    if tops:
        rec["cu_limit_est"] = max(int(CU_RE.search(l).group(2)) for l in tops)
    elif first_budget:
        rec["cu_limit_est"] = first_budget
    prio = meta["fee"] - 5000 * len(
        [k for k in msg["accountKeys"] if isinstance(k, dict) and k.get("signer")]
    )
    rec["priority_lamports"] = prio
    if rec["cu_limit_est"]:
        rec["micro_lamports_per_cu"] = round(prio * 1_000_000 / rec["cu_limit_est"])

    programs = []
    tips = []
    wsol_in = 0
    route = None
    pump_args = None
    for ix in msg["instructions"]:
        pid = ix.get("programId")
        programs.append(pid)
        parsed = ix.get("parsed")
        if pid == SYSTEM and isinstance(parsed, dict) and parsed.get("type") == "transfer":
            info = parsed["info"]
            if info.get("source") == wallet:
                lam = info["lamports"]
                if lam <= 2_000_000:
                    tips.append({"to": info["destination"], "lamports": lam})
                else:
                    wsol_in += lam
        if pid == PUMP_PROGRAM and "data" in ix:
            route = "direct"
            pump_args = decode_pump_ix(ix["data"])
        elif pid not in (
            SYSTEM,
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
            "ComputeBudget111111111111111111111111111111",
        ) and "data" in ix:
            route = f"wrapper:{pid}"
            rec["wrapper_data_len"] = len(base58.b58decode(ix["data"]))
            rec["wrapper_data_hex"] = base58.b58decode(ix["data"]).hex()
    # wrapper → pump args live in inner instructions
    if pump_args is None:
        for inner in meta.get("innerInstructions") or []:
            for ix in inner["instructions"]:
                if ix.get("programId") == PUMP_PROGRAM and "data" in ix:
                    d = decode_pump_ix(ix["data"])
                    if d:
                        pump_args = d
                        break
            if pump_args:
                break
    rec["route"] = route
    rec["programs"] = programs
    rec["tips"] = tips
    rec["wsol_wrapped_lamports"] = wsol_in
    rec["pump_ix"] = pump_args

    ev = [e for e in extract_trade_events_from_tx(tx) if e["user"] == wallet]
    if ev:
        e = ev[0]
        rec["event"] = e
    if pump_args:
        name = pump_args["name"]
        if name.startswith("buy"):
            rec["side"] = "buy"
            rec["amount_tokens_req"] = pump_args["arg0"]
            rec["max_sol_cost"] = pump_args["arg1"]
            if ev:
                e = ev[0]
                rec["fill_sol"] = e["sol_amount"]
                rec["slippage_cap_vs_fill"] = pump_args["arg1"] / 1e9 / e["sol_amount"] - 1 if e["sol_amount"] else None
                rec["tokens_req_vs_fill"] = pump_args["arg0"] / e["token_amount"] if e["token_amount"] else None
        else:
            rec["side"] = "sell"
            rec["amount_tokens"] = pump_args["arg0"]
            rec["min_sol_output"] = pump_args["arg1"]
            if ev:
                e = ev[0]
                rec["fill_sol"] = e["sol_amount"]
                rec["min_out_vs_fill"] = (pump_args["arg1"] / 1e9) / e["sol_amount"] - 1 if e["sol_amount"] else None
        if meta.get("err") and rec["side"] == "buy":
            # parse Left/Right from slippage failure
            left = right = None
            for line in logs:
                if line.startswith("Program log: Left: "):
                    left = int(line.split(": ")[-1])
                if line.startswith("Program log: Right: "):
                    right = int(line.split(": ")[-1])
            if left and right:
                rec["fail_required_over_cap"] = right / left - 1
    # closes token ATA on sell → full exit
    closes = [
        ix for ix in msg["instructions"]
        if isinstance(ix.get("parsed"), dict) and ix["parsed"].get("type") == "closeAccount"
    ]
    rec["n_close"] = len(closes)
    err = meta.get("err")
    if err:
        rec["err_code"] = json.dumps(err)
    return rec


def summarize(recs: list[dict]) -> dict:
    def med(vals):
        vals = [v for v in vals if v is not None]
        return median(vals) if vals else None

    def pct(vals, p):
        vals = sorted(v for v in vals if v is not None)
        if not vals:
            return None
        return vals[int(round((len(vals) - 1) * p))]

    buys = [r for r in recs if r.get("side") == "buy"]
    sells = [r for r in recs if r.get("side") == "sell"]
    ok_buys = [r for r in buys if not r["err"]]
    ok_sells = [r for r in sells if not r["err"]]
    s = {
        "n": len(recs),
        "n_buy": len(buys),
        "n_sell": len(sells),
        "fail_rate_buy": sum(1 for r in buys if r["err"]) / len(buys) if buys else None,
        "fail_rate_sell": sum(1 for r in sells if r["err"]) / len(sells) if sells else None,
        "err_codes": Counter(r.get("err_code") for r in recs if r["err"]).most_common(6),
        "routes_buy": Counter(r["route"] for r in buys).most_common(),
        "routes_sell": Counter(r["route"] for r in sells).most_common(),
        "pump_ix_names": Counter((r.get("pump_ix") or {}).get("name") for r in recs).most_common(),
        "cu_limit_buy": Counter(r["cu_limit_est"] for r in buys).most_common(5),
        "cu_limit_sell": Counter(r["cu_limit_est"] for r in sells).most_common(5),
        "micro_lamports_per_cu_buy": Counter(r.get("micro_lamports_per_cu") for r in buys).most_common(5),
        "micro_lamports_per_cu_sell": Counter(r.get("micro_lamports_per_cu") for r in sells).most_common(5),
        "tip_lamports_buy": Counter(t["lamports"] for r in buys for t in r["tips"]).most_common(5),
        "tip_lamports_sell": Counter(t["lamports"] for r in sells for t in r["tips"]).most_common(5),
        "n_tips_per_tx": Counter(len(r["tips"]) for r in recs).most_common(),
        "buy_slippage_cap_median": med([r.get("slippage_cap_vs_fill") for r in ok_buys]),
        "buy_slippage_cap_p10": pct([r.get("slippage_cap_vs_fill") for r in ok_buys], 0.1),
        "buy_slippage_cap_p90": pct([r.get("slippage_cap_vs_fill") for r in ok_buys], 0.9),
        "buy_tokens_req_vs_fill_median": med([r.get("tokens_req_vs_fill") for r in ok_buys]),
        "buy_wsol_wrapped_vs_maxcost_median": med(
            [r["wsol_wrapped_lamports"] / r["max_sol_cost"] for r in buys if r.get("max_sol_cost")]
        ),
        "fail_required_over_cap_median": med([r.get("fail_required_over_cap") for r in buys]),
        "sell_min_out_vs_fill_median": med([r.get("min_out_vs_fill") for r in ok_sells]),
        "sell_min_out_vs_fill_p10": pct([r.get("min_out_vs_fill") for r in ok_sells], 0.1),
        "sell_min_out_vs_fill_p90": pct([r.get("min_out_vs_fill") for r in ok_sells], 0.9),
        "sell_n_close": Counter(r["n_close"] for r in ok_sells).most_common(),
        "cu_consumed_buy_median": med([r["cu_consumed"] for r in ok_buys]),
        "cu_consumed_sell_median": med([r["cu_consumed"] for r in ok_sells]),
        "fee_buy": Counter(r["fee"] for r in buys).most_common(5),
        "fee_sell": Counter(r["fee"] for r in sells).most_common(5),
    }
    return s


def main() -> None:
    wallet = os.environ.get("WALLET", "omegoMAe1AMY5MFKQQr3JwXVy8F4eCvmBAfcpo8XAfq")
    label = os.environ.get("LABEL", "omego")
    n = int(os.environ.get("N", "300"))
    sigs = get_signatures(wallet, limit=min(n, 1000))
    print(f"[{label}] fetching {len(sigs)} txs (batched)", flush=True)
    txs = get_transactions_batch([s["signature"] for s in sigs])
    recs = []
    for s in sigs:
        tx = txs.get(s["signature"])
        if not tx:
            continue
        try:
            recs.append(fingerprint_tx(s["signature"], tx, wallet))
        except Exception as e:  # noqa: BLE001
            print("  skip", s["signature"][:12], e, flush=True)
    summary = summarize(recs)
    out = {"wallet": wallet, "label": label, "summary": summary, "records": recs}
    (REPORTS / f"{label}_execution_fingerprint.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
