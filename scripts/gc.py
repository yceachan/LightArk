"""Run only with Folio stopped and no backup running. Dry-run is the default.
python3 scripts/gc.py DATA_DIR [--apply]
Replaced and deleted immutable blobs are retained until this explicit operation.
"""
import sqlite3, sys
from pathlib import Path
root=Path(sys.argv[1]); apply='--apply' in sys.argv[2:]
with sqlite3.connect(f'file:{root / "folio.sqlite"}?mode=ro',uri=True) as db:
 refs={row[0] for row in db.execute('SELECT blob FROM entries WHERE blob IS NOT NULL')}
 candidates=[p for p in (root/'blobs').iterdir() if p.is_file() and p.name not in refs]
 for p in candidates:
  print(('delete ' if apply else 'would delete ')+p.name)
  if apply:p.unlink()
 print(f'{len(candidates)} unreferenced blobs')
