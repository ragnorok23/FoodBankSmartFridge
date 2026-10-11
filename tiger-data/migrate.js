import {readFile} from 'node:fs/promises';
import {makePool} from './db.js';
const pool=makePool();
try { await pool.query(await readFile(new URL('./migrations/001_fridge.sql',import.meta.url),'utf8')); console.log('Fridge schema and TimescaleDB sensor hypertable ready.'); }
catch { console.error('Migration failed. Check service readiness and admin connection; credentials were not printed.'); process.exitCode=1; }
finally { await pool.end(); }
