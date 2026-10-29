import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createCourtServer } from './app.js';

try {
  const server = await createCourtServer();
  const directory = resolve('dist');
  if (existsSync(directory)) {
    server.app.use(express.static(directory));
    server.app.get('/{*path}', (req, res) => {
      if (req.path.startsWith('/api/')) { res.status(404).json({ error: '接口不存在' }); return; }
      res.sendFile(resolve(directory, 'index.html'));
    });
  }
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '127.0.0.1';
  server.http.listen(port, host, () => console.log(`AI court server: http://${host}:${port} (${server.store.mode})`));
  const shutdown = async () => { await server.close(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
} catch {
  console.error('Server startup failed. In mysql mode, check DATABASE_URL and run npm run db:migrate. No match was started.');
  process.exitCode = 1;
}
