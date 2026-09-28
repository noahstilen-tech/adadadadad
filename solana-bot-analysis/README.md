# Solana trading bot on-chain analysis

Analyse af omego- og sssss-bots på pump.fun bonding curves.

Se **[reports/ANALYSE.md](reports/ANALYSE.md)** for resultater.

```bash
pip install solders base58
ONLY=omego MAX_PAGES=50 python3 scripts/continue_sigs.py
ONLY=omego HOURS=6 MAX_TXS=350 python3 scripts/analyze_pnl.py
MAX_BLOCKS=12 python3 scripts/find_siblings_deep.py
HOURS=24 POINTS=24 python3 scripts/balance_trajectory.py
```
