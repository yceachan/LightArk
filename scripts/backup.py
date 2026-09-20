"""Online consistent backup: python3 scripts/backup.py DATA_DIR NEW_BACKUP_DIR.
Immutable blobs allow a SQLite snapshot to be copied while the app keeps running.
Do not run garbage collection concurrently with this operation.
"""
import sqlite3, shutil, sys
from pathlib import Path
source, dest = map(Path, sys.argv[1:])
if dest.exists():
 raise SystemExit('Destination must not already exist')
if not (source / 'folio.sqlite').is_file():
 raise SystemExit('Source database does not exist')
(dest / 'blobs').mkdir(parents=True)
with sqlite3.connect(f'file:{source / "folio.sqlite"}?mode=ro', uri=True) as live:
 with sqlite3.connect(dest / 'folio.sqlite') as snapshot:
  live.backup(snapshot)
  snapshot.execute('DELETE FROM sessions')
  snapshot.commit()
  assert snapshot.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
  for (blob,) in snapshot.execute('SELECT DISTINCT blob FROM entries WHERE blob IS NOT NULL'):
   shutil.copy2(source / 'blobs' / blob, dest / 'blobs' / blob)
print(f'Backup complete: {dest}')
