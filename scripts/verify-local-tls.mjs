// Run only against your local `npm run dev:https` instance. No LLM call is sent.
import { readFileSync } from 'node:fs';
import { get } from 'node:https';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
const ca = readFileSync('.cert/localhost.pem');
const endpoint = new URL(process.env.TLS_TEST_URL || 'https://localhost:5173');
if (endpoint.protocol !== 'https:' || !['localhost', '127.0.0.1'].includes(endpoint.hostname)) throw new Error('TLS_TEST_URL must be a local HTTPS origin');
const catalog = await new Promise((resolve, reject) => {
  get(new URL('/api/catalog', endpoint), { ca }, res => {
    let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve(JSON.parse(data)));
  }).on('error', reject);
});
for (const path of ['/server/cases.ts', '/tests/helpers.ts', '/.cert/localhost-key.pem', '/@fs/' + process.cwd().replaceAll('\\', '/') + '/server/cases.ts']) {
  const status = await new Promise((resolve, reject) => get(new URL(path, endpoint), { ca }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject));
  assert.ok(status === 403 || status === 404, 'Backend sources and private files must not be served to browsers');
}
const socket = io(endpoint.origin, { ca, transports: ['websocket'], reconnection: false,
  extraHeaders: { Origin: endpoint.origin } });
let latestRoom;
socket.on('room:update', room => { latestRoom = room; });
const ack = (event, payload = {}) => new Promise((resolve, reject) => socket.timeout(5000).emit(event, payload, (error, result) => {
  if (error) reject(error); else if (!result.ok) reject(new Error(result.error)); else resolve(result.data);
}));
try {
  await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); });
  await ack('preferences:resume');
  const joined = await ack('room:create', { nickname: 'TLS 本机测试', caseId: catalog.cases[0].id });
  assert.ok(joined.session.playerId);
  const settings = { provider: 'deepseek', model: 'transport-test-model', baseUrl: '',
    apiKey: '', personality: 'rigorous', strategy: 'evidence', identity: 'civilian', items: [] };
  const saved = await ack('ai:configure', { ...settings,
    apiKey: 'local-transport-test-key', personality: 'rigorous', strategy: 'evidence', identity: 'civilian', items: [] });
  assert.equal(saved.model, settings.model);
  assert.ok(!JSON.stringify(saved).includes('local-transport-test-key'));
  const equipment = await ack('player:loadout', { identity: 'scientist', items: ['archive', 'firewall'] });
  assert.equal(equipment.identity, 'scientist');
  assert.equal(latestRoom.players.find(p => p.id === joined.session.playerId).configured, true);
  assert.equal(latestRoom.ownAiSettings.model, settings.model);
  assert.ok(!JSON.stringify(latestRoom).includes('local-transport-test-key'));
  const changed = await ack('ai:configure', { ...settings, model: 'another-transport-test-model' });
  assert.equal(changed.model, 'another-transport-test-model');
  assert.equal(latestRoom.players.find(p => p.id === joined.session.playerId).loadout.identity, 'scientist');
  await ack('room:leave');
  const restored = await ack('room:create', { nickname: 'TLS 自动沿用检查', caseId: catalog.cases[1].id });
  assert.equal(restored.room.ownAiSettings.model, changed.model);
  assert.equal(restored.room.players[0].configured, true);
  assert.equal(restored.room.players[0].ready, false);
  assert.equal(restored.room.players[0].loadout.identity, 'scientist');
  assert.ok(!JSON.stringify(restored).includes('local-transport-test-key'));
  await ack('preferences:forget');
  await ack('room:leave');
  const forgotten = await ack('room:create', { nickname: 'TLS 清除检查', caseId: catalog.cases[0].id });
  assert.equal(forgotten.room.ownAiSettings, null);
  await ack('room:leave');
  console.log('PASS: verified certificate, HTTPS/WSS, protected backend/private files, private key submission, automatic configuration/loadout reuse in a new room, and explicit forgetting. No provider request sent.');
} finally {
  if (socket.connected) { try { await ack('preferences:forget'); await ack('room:leave'); } catch { /* Server may have restarted. */ } }
  socket.disconnect();
}
