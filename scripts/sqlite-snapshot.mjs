import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [, , srcArg, dstArg] = process.argv;

if (!srcArg || !dstArg) {
  console.error('Usage: node --no-warnings scripts/sqlite-snapshot.mjs <srcDbPath> <dstDbPath>');
  process.exit(1);
}

const src = path.resolve(srcArg);
const dst = path.resolve(dstArg);

if (!fs.existsSync(src)) {
  console.error(`Source database not found: ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.rmSync(dst, { force: true });

let db;
try {
  db = new DatabaseSync(src);
  db.exec('PRAGMA busy_timeout = 10000;');
  const safeDst = dst.replace(/\\/g, '/').replace(/'/g, "''");
  db.exec(`VACUUM INTO '${safeDst}';`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Failed to snapshot SQLite DB "${src}" -> "${dst}": ${message}`);
  process.exit(1);
} finally {
  if (db) {
    try {
      db.close();
    } catch {
      // Ignore close error on cleanup.
    }
  }
}
