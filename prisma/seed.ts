import 'dotenv/config';
import { Store } from '../server/store.js';
import { CASES_V3 as CASES } from '../server/cases-v3.js';
const store = new Store('mysql');
try { await store.initialize(CASES); console.log('Twelve authored case templates seeded. Interrupted matches marked aborted.'); }
catch { console.error('Database seed failed. Check DATABASE_URL and run migrations.'); process.exitCode = 1; }
finally { await store.close(); }
