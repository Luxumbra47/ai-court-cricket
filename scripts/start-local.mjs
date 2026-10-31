import 'dotenv/config';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(new URL('../dist-server/server/index.js', import.meta.url))) {
  console.error('Please run npm ci and npm run build first.');
  process.exit(1);
}
const first = Number(process.env.PORT || 3001);
if (!Number.isInteger(first) || first < 1 || first > 65535) throw new Error('PORT must be 1..65535');
const available = port => new Promise(resolve => {
  const probe = createServer(); probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});
let selected;
for (const port of [...new Set([first, ...Array.from({ length: 10 }, (_, i) => 3011 + i)])]) {
  if (await available(port)) { selected = port; break; }
}
if (!selected) { console.error('No local port available (3001 / 3011..3020).'); process.exit(1); }
const origins = [process.env.ALLOWED_ORIGINS, `http://localhost:${selected}`, `http://127.0.0.1:${selected}`].filter(Boolean).join(',');
console.log(`\nWhisper Agents - open http://localhost:${selected}/\nKeep this window open. Local strategy play is free; real API keys require HTTPS.\n`);
const child = spawn(process.execPath, ['dist-server/server/index.js'], { cwd: root, stdio: 'inherit',
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(selected), ALLOWED_ORIGINS: origins } });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
