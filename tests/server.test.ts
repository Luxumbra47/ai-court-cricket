import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createCourtServer, type ServerOptions } from '../server/app.js';
import { Store } from '../server/store.js';
import { DailyBudget, LlmService, type ActionRequest, type ActionReply } from '../server/llm.js';
import { createScriptedSpeech, replayGame } from '../server/game.js';
import { CASES, getCase } from '../server/cases.js';
import type { Ack, ActionCommand, ActionPreview, ActionReceipt, AiConfig, RoomView, Session, Verdict, MatchMode } from '../shared/types.js';
import { config, manualChoice } from './helpers.js';
type Court = Awaited<ReturnType<typeof createCourtServer>>;
type Entry = { session: Session; room: RoomView };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; };
const fixtures: { server: Court; sockets: Socket[]; releases: (() => void)[] }[] = [];
async function waitFor<T>(read: () => T | null | undefined | false, timeout = 3000): Promise<T> {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = read(); if (value) return value; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('等待状态超时');
}
class RecordingStore extends Store {
  writes: unknown[] = []; terminal: (Verdict | null)[] = [];
  override async startMatch(...a: Parameters<Store['startMatch']>) { this.writes.push(structuredClone(a)); }
  override async append(...a: Parameters<Store['append']>) { this.writes.push(structuredClone(a)); }
  override async endRoom(_r: string, _m: string | null, v: Verdict | null) { this.terminal.push(v ? structuredClone(v) : null); }
}
class FakeModels extends LlmService {
  seen: ActionRequest[] = []; tested: AiConfig[] = [];
  constructor(readonly gate?: ReturnType<typeof deferred>, readonly echo = false) { super({ budget: new DailyBudget({ limit: 10, maxRequests: 100 }) }); }
  override async testConnection(c: AiConfig) { this.tested.push(structuredClone(c)); return { ok: true, message: 'mock connection', code: 'success' }; }
  override async completeAction(input: ActionRequest): Promise<ActionReply> {
    this.seen.push(structuredClone({ ...input, signal: undefined }));
    await this.gate?.promise;
    const action = createScriptedSpeech(input.action, input.config, input.state.players[input.side].stability);
    if (this.echo) { action.speech += input.config.apiKey; action.tone = input.config.apiKey || 'calm'; }
    return { action, fallback: false, records: [{ id: randomUUID(), side: input.side, provider: input.config.provider, model: input.config.model, attempt: 1, status: 'ok', inputTokens: 50, outputTokens: 20, durationMs: 1, estimatedCost: null }] };
  }
}
async function fixture(options: ServerOptions = {}) {
  const server = await createCourtServer({ rulesVersion: 2, store: new Store('memory'), trustProxy: false, ...options });
  await new Promise<void>(r => server.http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.http.address() as { port: number }).port}`;
  const row = { server, sockets: [] as Socket[], releases: [] as (() => void)[] }; fixtures.push(row);
  const connect = async (secure = false) => {
    const socket = io(url, { forceNew: true, reconnection: false, transports: ['websocket'], ...(secure ? { extraHeaders: { 'x-forwarded-proto': 'https' } } : {}) });
    row.sockets.push(socket); await new Promise<void>((r, reject) => { socket.once('connect', r); socket.once('connect_error', reject); }); return socket;
  };
  return { ...row, connect, url };
}
const ack = <T = undefined>(socket: Socket, event: string, data: unknown = {}): Promise<Ack<T>> => new Promise((r, reject) => socket.timeout(2500).emit(event, data, (err: Error | null, value: Ack<T>) => err ? reject(err) : r(value)));
async function ok<T = undefined>(socket: Socket, event: string, data: unknown = {}): Promise<T> { const r = await ack<T>(socket, event, data); expect(r.ok, r.error).toBe(true); return r.data as T; }
async function pair(f: Awaited<ReturnType<typeof fixture>>, caseId = 'pizza-001', secure = false, mode: MatchMode = 'standard') {
  const a = await f.connect(secure), b = await f.connect(secure), aViews: RoomView[] = [], bViews: RoomView[] = [];
  a.on('room:update', v => aViews.push(v)); b.on('room:update', v => bViews.push(v));
  const first = await ok<Entry>(a, 'room:create', { nickname: '辩方', caseId, mode });
  const second = await ok<Entry>(b, 'room:join', { nickname: '控方', code: first.room.code });
  return { a, b, first, second, aViews, bViews, code: first.room.code };
}
type Pair = Awaited<ReturnType<typeof pair>>; type Fixture = Awaited<ReturnType<typeof fixture>>;
async function ready(p: Pair, a = config(), b = config()) {
  await ok(p.a, 'player:loadout', { identity: a.identity, items: a.items }); await ok(p.b, 'player:loadout', { identity: b.identity, items: b.items });
  await ok(p.a, 'ai:configure', a); await ok(p.b, 'ai:configure', b);
  await ok(p.a, 'room:ready', { ready: true }); await ok(p.b, 'room:ready', { ready: true });
}
function choice(f: Fixture, p: Pair, patch: Partial<ActionCommand> = {}) {
  const room = f.server.rooms.get(p.code)!;
  return { ...manualChoice(getCase(room.caseId), room.game!), turnId: `${room.matchId}:${room.game!.completedActions}`, ...patch };
}
async function step(f: Fixture, p: Pair, patch: Partial<ActionCommand> = {}) {
  const room = f.server.rooms.get(p.code)!, previous = room.game!.completedActions, socket = room.game!.turn === 'defense' ? p.a : p.b;
  const c = choice(f, p, patch); await ok<ActionReceipt>(socket, 'game:submit_action', c);
  await waitFor(() => room.game!.completedActions === previous + 1); return c;
}
afterEach(async () => { for (const f of fixtures.splice(0)) { f.releases.forEach(r => r()); f.sockets.forEach(s => s.disconnect()); await f.server.close(); } });

describe('Socket.IO player-command integration (no paid endpoints)', () => {
  it.each(['caseId', 'caseVersion'])('locks one case snapshot through AI input and stops a corrupted %s binding', async mismatch => {
    const llm = new FakeModels(), f = await fixture({ llm }), p = await pair(f, 'diamond-002');
    await ready(p); await ok(p.a, 'game:start');
    const room = f.server.rooms.get(p.code)!;
    expect(Object.isFrozen(room.lockedCase)).toBe(true); expect(room.game!.caseVersion).toBe(room.lockedCase!.version);
    await step(f, p);
    expect(llm.seen[0].template.id).toBe('diamond-002'); expect(llm.seen[0].template.version).toBe(4);
    const c = choice(f, p), before = room.game!.completedActions;
    if (mismatch === 'caseId') room.caseId = 'pizza-001'; else room.game!.caseVersion = 999;
    expect((await ack(p.b, 'game:submit_action', c)).ok).toBe(false);
    await waitFor(() => p.bViews.at(-1)?.status === 'cancelled');
    expect(room.game!.verdict).toBeNull(); expect(room.game!.completedActions).toBe(before); expect(llm.seen).toHaveLength(1);
    expect(p.bViews.at(-1)!.case.id).toBe('diamond-002'); expect(p.bViews.at(-1)!.publicEvidence.every(e => e.id.startsWith('D'))).toBe(true);
  });
  it('reconnects while an accepted result is being saved without repeating its call or resource cost', async () => {
    const gate = deferred(), entered = deferred();
    class SavingStore extends RecordingStore { override async append(...a: Parameters<Store['append']>) { entered.resolve(); await gate.promise; await super.append(...a); } }
    const llm = new FakeModels(), f = await fixture({ llm, store: new SavingStore(), trustProxy: true }), p = await pair(f, 'pizza-001', true); f.releases.push(gate.resolve);
    const profile = await ok<{ token: string }>(p.a, 'preferences:resume', {});
    await ready(p, config({ provider: 'deepseek', apiKey: 'FAKE-SAVING-KEY' })); await ok(p.a, 'game:start');
    const c = choice(f, p); await ok(p.a, 'game:submit_action', c); await entered.promise;
    const room = f.server.rooms.get(p.code)!; expect(room.execution).toBe('resolving');
    p.a.disconnect(); await waitFor(() => !room.players[0].socketId);
    expect(room.status).toBe('playing');
    const replacement = await f.connect(true); await ok(replacement, 'preferences:resume', profile);
    const restored = await ok<Entry>(replacement, 'room:resume', p.first.session);
    expect(restored.room.game!.execution).toBe('resolving'); expect(restored.room.players[0].configured).toBe(true);
    expect((await ok<ActionReceipt>(replacement, 'game:submit_action', c)).status).toBe('resolving');
    gate.resolve(); await waitFor(() => room.game!.completedActions === 1);
    expect(llm.seen).toHaveLength(1); expect(room.game!.players.defense.actionPoints).toBe(3);
    expect(room.game!.events.filter(e => e.kind === 'action')).toHaveLength(1);
  });
  it('automatically restores a private saved configuration when creating and joining subsequent rooms', async () => {
    const llm = new FakeModels(), store = new RecordingStore('memory');
    const f = await fixture({ llm, store, trustProxy: true }), a = await f.connect(true), b = await f.connect(true);
    const profile = await ok<{ token: string }>(a, 'preferences:resume', {});
    expect(profile.token).toMatch(/^[a-f0-9]{64}$/);
    const first = await ok<Entry>(a, 'room:create', { nickname: '记住配置', caseId: 'pizza-001' });
    const selected = config({ provider: 'deepseek', apiKey: 'FAKE-REMEMBER-ONLY', model: 'my-deepseek-model', personality: 'chaotic', strategy: 'free', identity: 'scientist', items: ['archive', 'coffee'] });
    await ok(a, 'player:loadout', { identity: selected.identity, items: selected.items });
    await ok(a, 'ai:configure', selected);
    await ok(a, 'room:leave');
    expect(f.server.rooms.has(first.room.code)).toBe(false);
    const next = await ok<Entry>(a, 'room:create', { nickname: '另建房间', caseId: 'diamond-002' });
    expect(next.room.ownAiSettings).toMatchObject({ provider: 'deepseek', model: selected.model, personality: 'chaotic', strategy: 'free' });
    expect(next.room.players[0]).toMatchObject({ configured: true, ready: false, loadout: { identity: 'scientist', items: ['archive', 'coffee'] } });
    expect(llm.seen).toHaveLength(0); expect(llm.tested).toHaveLength(0);
    await ok(a, 'room:ready', { ready: true });
    await ok(a, 'ai:test', { ...selected, apiKey: '' });
    expect(llm.tested[0].apiKey).toBe(selected.apiKey);
    await ok(a, 'room:leave');
    await ok(b, 'preferences:resume', {});
    const other = await ok<Entry>(b, 'room:create', { nickname: '独立访客', caseId: 'robot-003' });
    expect(other.room.ownAiSettings).toBeNull(); expect(other.room.players[0].configured).toBe(false);
    const joined = await ok<Entry>(a, 'room:join', { nickname: '复用自己的配置', code: other.room.code });
    expect(joined.room.players.find(p => p.id === joined.session.playerId)).toMatchObject({ configured: true, side: 'prosecution', ready: false });
    const outsiderView = await ok<Entry>(b, 'room:resume', other.session);
    expect(outsiderView.room.ownAiSettings).toBeNull();
    expect(JSON.stringify([profile, next, joined, outsiderView, store.writes])).not.toContain(selected.apiKey);
  });
  it('restores the saved key after reconnect without a model call, and allows explicitly forgetting it', async () => {
    const llm = new FakeModels(), f = await fixture({ llm, trustProxy: true }), a = await f.connect(true);
    const profile = await ok<{ token: string }>(a, 'preferences:resume', {});
    const first = await ok<Entry>(a, 'room:create', { nickname: '刷新恢复', caseId: 'pizza-001' });
    await ok(a, 'ai:configure', config({ provider: 'deepseek', apiKey: 'FAKE-REFRESH-ONLY' }));
    a.disconnect();
    await waitFor(() => !f.server.rooms.get(first.room.code)!.players[0].socketId);
    expect(f.server.rooms.get(first.room.code)!.players[0].config!.apiKey).toBe('');
    const resumed = await f.connect(true);
    expect(await ok(resumed, 'preferences:resume', { token: profile.token })).toEqual(profile);
    const restored = await ok<Entry>(resumed, 'room:resume', first.session);
    expect(restored.room.players[0].configured).toBe(true);
    expect(f.server.rooms.get(first.room.code)!.players[0].config!.apiKey).toBe('FAKE-REFRESH-ONLY');
    expect(llm.seen).toHaveLength(0); expect(llm.tested).toHaveLength(0);
    await ok(resumed, 'preferences:forget');
    await ok(resumed, 'room:leave');
    const forgotten = await ok<Entry>(resumed, 'room:create', { nickname: '不再沿用', caseId: 'pizza-001' });
    expect(forgotten.room.ownAiSettings).toBeNull(); expect(forgotten.room.players[0].configured).toBe(false);
  });
  it('does not restore a saved real key over HTTP or for an unknown configuration credential', async () => {
    const f = await fixture({ trustProxy: true }), a = await f.connect(true);
    const profile = await ok<{ token: string }>(a, 'preferences:resume', {});
    await ok(a, 'room:create', { nickname: 'HTTPS配置', caseId: 'pizza-001' });
    await ok(a, 'ai:configure', config({ provider: 'deepseek', apiKey: 'FAKE-SECURE-ONLY' }));
    const insecure = await f.connect(), unknown = await f.connect(true);
    const isolated = await ok<{ token: string }>(insecure, 'preferences:resume', profile);
    expect(isolated.token).not.toBe(profile.token);
    await ok(unknown, 'preferences:resume', { token: '0'.repeat(64) });
    for (const socket of [insecure, unknown]) {
      const entry = await ok<Entry>(socket, 'room:create', { nickname: '无权沿用', caseId: 'pizza-001' });
      expect(entry.room.ownAiSettings).toBeNull(); expect(entry.room.players[0].configured).toBe(false);
    }
    await ok(a, 'room:leave');
    const legitimate = await ok<Entry>(a, 'room:create', { nickname: '仍可恢复', caseId: 'pizza-001' });
    expect(legitimate.room.players[0].configured).toBe(true);
    const downgrade = await f.connect();
    const insecureResume = await ok<Entry>(downgrade, 'room:resume', legitimate.session);
    expect(insecureResume.room.players[0].configured).toBe(false);
    expect(f.server.rooms.get(legitimate.room.code)!.players[0].config!.apiKey).toBe('');
  });
  it.each(['cancelled', 'finished'])('keeps the private configuration for a new room after a %s match', async ending => {
    const llm = new FakeModels(), f = await fixture({ llm, trustProxy: true }), p = await pair(f, 'pizza-001', true);
    await ok(p.a, 'preferences:resume', {});
    await ready(p, config({ provider: 'deepseek', apiKey: 'FAKE-AFTER-MATCH', model: 'saved-model' }));
    if (ending === 'finished') { await ok(p.a, 'game:start'); for (let i = 0; i < 8; i++) await step(f, p); }
    else await ok(p.b, 'room:leave');
    expect(f.server.rooms.get(p.code)!.status).toBe(ending);
    expect(f.server.rooms.get(p.code)!.players[0].config!.apiKey).toBe('');
    await ok(p.a, 'room:resume', p.first.session);
    expect(f.server.rooms.get(p.code)!.players[0].config!.apiKey).toBe('');
    await ok(p.a, 'room:leave');
    const rebuilt = await ok<Entry>(p.a, 'room:create', { nickname: '结束后继续玩', caseId: 'diamond-002' });
    expect(rebuilt.room.players[0]).toMatchObject({ configured: true, ready: false });
    expect(rebuilt.room.ownAiSettings?.model).toBe('saved-model');
    expect(llm.seen).toHaveLength(ending === 'finished' ? 8 : 0);
    expect(JSON.stringify(rebuilt)).not.toContain('FAKE-AFTER-MATCH');
  });
  it('expires idle remembered credentials and can remember a new save afterward', async () => {
    const f = await fixture({ trustProxy: true, preferenceTtlMs: 500 }), a = await f.connect(true);
    await ok(a, 'preferences:resume', {});
    await ok(a, 'room:create', { nickname: '过期检查', caseId: 'pizza-001' });
    await ok(a, 'ai:configure', config({ provider: 'deepseek', apiKey: 'FAKE-EXPIRED-ONLY' }));
    await ok(a, 'room:leave');
    await new Promise(r => setTimeout(r, 550));
    const expired = await ok<Entry>(a, 'room:create', { nickname: '过期后新建', caseId: 'pizza-001' });
    expect(expired.room.ownAiSettings).toBeNull();
    await ok(a, 'ai:configure', config({ provider: 'deepseek', apiKey: 'FAKE-NEW-SAVE' }));
    await ok(a, 'room:leave');
    const renewed = await ok<Entry>(a, 'room:create', { nickname: '新配置可恢复', caseId: 'pizza-001' });
    expect(renewed.room.players[0].configured).toBe(true);
  });
  it('switches the entire case before start and projects disclosure/submission independently without hidden weights', async () => {
    const f = await fixture(), p = await pair(f);
    for (const caseId of ['robot-003', 'diamond-002']) {
      await ok(p.a, 'room:case', { caseId });
      const v = await waitFor(() => p.aViews.at(-1)?.case.id === caseId && p.aViews.at(-1));
      const prefix = caseId === 'robot-003' ? 'R' : 'D';
      expect(v.publicEvidence.every(e => e.id.startsWith(prefix))).toBe(true);
      expect(v.privateEvidence).toEqual([]);
    }
    await ready(p); await ok(p.a, 'game:start');
    let v = await waitFor(() => p.aViews.at(-1)?.game && p.aViews.at(-1));
    expect(v.publicEvidence[0].state).toMatchObject({ disclosure: 'public', submitted: false });
    expect(v.privateEvidence.map(e => e.id)).toEqual(['D04']);
    expect(v.publicEvidence[0]).not.toHaveProperty('reliability'); expect(v.publicEvidence[0]).not.toHaveProperty('flaw');
    await step(f, p, { optionId: 'item:magnifier', evidenceIds: ['D04'], itemId: 'magnifier' });
    v = await waitFor(() => p.bViews.at(-1)?.publicEvidence.some(e => e.id === 'D04') && p.bViews.at(-1));
    expect(v.publicEvidence.find(e => e.id === 'D04')!.state).toMatchObject({ disclosure: 'public', submitted: false, reviewed: true });
    expect(v.privateEvidence.map(e => e.id)).toEqual(['D05']);
    expect(JSON.stringify(v)).not.toContain('D06');
    await step(f, p, { optionId: 'prosecution:present', evidenceIds: ['D01'] });
    v = await waitFor(() => p.aViews.at(-1)?.publicEvidence.find(e => e.id === 'D01')?.state.submitted && p.aViews.at(-1));
    expect(v.publicEvidence.find(e => e.id === 'D01')!.state).toMatchObject({ disclosure: 'public', submitted: true });
    expect(v.actionOptions.find(o => o.id === 'defense:present')!.evidenceIds).not.toContain('D01');
    expect(JSON.stringify(v.events)).not.toMatch(/D06|预置缺陷|程序规则/);
  });
  it.each(['invalid_json', 'timeout', 'budget'] as const)('technical %s fallback preserves the chosen rule effect and stability', async mode => {
    const llm = new LlmService({ adapter: { complete: async () => mode === 'timeout' ? new Promise(() => {}) : { content: 'invalid-json', inputTokens: null, outputTokens: null } },
      timeoutMs: 50, budget: new DailyBudget({ limit: mode === 'budget' ? 0 : 10, maxRequests: 10, unknownReserve: .1 }) });
    const f = await fixture({ llm, trustProxy: true }), p = await pair(f, 'pizza-001', true);
    await ready(p, config({ provider: 'deepseek', apiKey: 'FAKE-A', model: 'a' })); await ok(p.a, 'game:start'); await step(f, p);
    const room = f.server.rooms.get(p.code)!; expect(room.game!.score).toBe(27); expect(room.game!.players.defense.stability).toBe(100); expect(room.players[0].usage.fallback).toBe(1);
    expect(room.game!.events.at(-1)?.command?.optionId).toBe('defense:present'); expect(room.game!.completedActions).toBe(1);
  });
  it('serves safe health/catalog and blocks a third player and outsiders', async () => {
    const f = await fixture(), p = await pair(f), c = await f.connect();
    expect(await (await fetch(f.url + '/api/health')).json()).toMatchObject({ ok: true, activeRooms: 1 });
    const catalog = await (await fetch(f.url + '/api/catalog')).json(); expect(catalog.cases).toHaveLength(3); expect(catalog.identities).toHaveLength(3); expect(catalog.items).toHaveLength(6); expect(JSON.stringify(catalog)).not.toContain('truth');
    expect((await ack(c, 'room:join', { nickname: '第三人', code: p.code })).error).toContain('已满');
    expect((await ack(c, 'ai:configure', config())).ok).toBe(false); expect((await ack(c, 'game:submit_action', {})).ok).toBe(false);
    expect((await ack(p.b, 'room:case', { caseId: 'robot-003' })).ok).toBe(false);
  });
  it('keeps independent equipment, readiness and remembered model/key reuse boundaries', async () => {
    const f = await fixture({ trustProxy: true }), p = await pair(f, 'pizza-001', true);
    await ok(p.a, 'player:loadout', { identity: 'scientist', items: ['archive'] });
    expect((await ack(p.a, 'room:ready', { ready: true })).ok).toBe(false);
    const original = config({ provider: 'deepseek', baseUrl: '', apiKey: 'FAKE-PRIVATE-A', model: 'alpha' });
    await ready(p, original); await ok(p.a, 'ai:configure', { ...original, apiKey: '', model: 'beta' });
    expect(f.server.rooms.get(p.code)!.players[0].config).toMatchObject({ apiKey: 'FAKE-PRIVATE-A', model: 'beta' });
    await ok(p.a, 'player:loadout', { identity: 'tycoon', items: ['coffee'] });
    expect(f.server.rooms.get(p.code)!.players[0].ready).toBe(false); expect(f.server.rooms.get(p.code)!.players[1].ready).toBe(true);
    expect(f.server.rooms.get(p.code)!.players[0].config).toMatchObject({ apiKey: 'FAKE-PRIVATE-A', model: 'beta', identity: 'tycoon', items: ['coffee'] });
  });
  it('HTTP can play presets but cannot submit a real key even with spoofed forwarding when trust is disabled', async () => {
    const f = await fixture(), p = await pair(f, 'pizza-001', true);
    expect((await ack(p.a, 'ai:configure', config({ provider: 'deepseek', apiKey: 'FAKE-KEY', model: 'test' }))).error).toContain('HTTPS');
    await ready(p); await ok(p.a, 'game:start'); expect(f.server.rooms.get(p.code)!.game!.completedActions).toBe(0);
  });
  it('start, waiting, reconnect and saving a key never invoke a model', async () => {
    const llm = new FakeModels(), f = await fixture({ llm }), p = await pair(f);
    await ready(p); expect((await ack(p.b, 'game:start')).ok).toBe(false);
    await ok(p.a, 'game:start'); await new Promise(r => setTimeout(r, 30));
    expect(llm.seen).toHaveLength(0); expect(f.server.rooms.get(p.code)!.game).toMatchObject({ completedActions: 0, turn: 'defense' });
    p.b.disconnect(); await waitFor(() => !f.server.rooms.get(p.code)!.players[1].socketId);
    const replacement = await f.connect(); p.b = replacement; await ok(replacement, 'room:resume', p.second.session);
    await ok(replacement, 'ai:configure', config()); await new Promise(r => setTimeout(r, 25)); expect(llm.seen).toHaveLength(0);
    await step(f, p); await new Promise(r => setTimeout(r, 25)); expect(llm.seen).toHaveLength(1);
  });
  it.each(CASES)('completes $title only after eight explicit submissions and reproduces judgment', async template => {
    const llm = new FakeModels(), f = await fixture({ llm }), p = await pair(f, template.id); await ready(p); await ok(p.a, 'game:start');
    const room = f.server.rooms.get(p.code)!;
    for (let i = 0; i < 8; i++) { expect(llm.seen).toHaveLength(i); await step(f, p); }
    expect(room.status).toBe('finished'); expect(llm.seen).toHaveLength(8);
    expect(llm.seen.map(r => r.side)).toEqual(['defense', 'prosecution', 'defense', 'prosecution', 'defense', 'prosecution', 'defense', 'prosecution']);
    expect(replayGame(room.lockedCase!, { defense: config(), prosecution: config() }, room.game!.events).verdict).toEqual(room.game!.verdict);
    expect(room.players.every(p => !p.config?.apiKey)).toBe(true); expect((await ack(p.a, 'game:submit_action', choice(f, p))).ok).toBe(false);
  });
  it('rejects wrong player, stale turn, wrong options/evidence and score injection without calls or penalties', async () => {
    const llm = new FakeModels(), f = await fixture({ llm }), p = await pair(f); await ready(p); await ok(p.a, 'game:start');
    const c = choice(f, p), room = f.server.rooms.get(p.code)!;
    for (const [socket, body] of [[p.b, c], [p.a, { ...c, turnId: 'stale' }], [p.a, { ...c, evidenceIds: ['P05'] }], [p.a, { ...c, score: 100 }], [p.a, { ...c, optionId: 'prosecution:present' }]] as const) expect((await ack(socket, 'game:submit_action', body)).ok).toBe(false);
    expect(llm.seen).toHaveLength(0); expect(room.game!.score).toBe(42); expect(room.game!.players.defense.stability).toBe(100); expect(room.game!.completedActions).toBe(0);
  });
  it('deduplicates concurrent requests and returns the original settled receipt after lost acknowledgments', async () => {
    const gate = deferred(), llm = new FakeModels(gate), f = await fixture({ llm }), p = await pair(f); f.releases.push(gate.resolve);
    await ready(p); await ok(p.a, 'game:start');
    const c = choice(f, p, { tactic: 'risky' }), room = f.server.rooms.get(p.code)!;
    const receipts = await Promise.all([ok<ActionReceipt>(p.a, 'game:submit_action', c), ok<ActionReceipt>(p.a, 'game:submit_action', c)]);
    expect(receipts.every(r => r.actionId === c.actionId)).toBe(true); expect(llm.seen).toHaveLength(1);
    expect((await ack(p.a, 'game:submit_action', { ...c, actionId: randomUUID() })).ok).toBe(false);
    expect((await ack(p.a, 'game:submit_action', { ...c, tactic: 'steady' })).ok).toBe(false);
    expect(room.game!.completedActions).toBe(0); gate.resolve(); await waitFor(() => room.game!.completedActions === 1);
    const receipt = await ok<ActionReceipt>(p.a, 'game:submit_action', c); expect(receipt.status).toBe('settled'); expect(llm.seen).toHaveLength(1);
    expect(room.game!.events.filter(e => e.kind === 'action')).toHaveLength(1); expect(room.game!.events.at(-1)?.random?.roll).toBeGreaterThan(0);
  });
  it('does not disclose selected private evidence or locked random results before settlement', async () => {
    const gate = deferred(), llm = new FakeModels(gate), f = await fixture({ llm }), p = await pair(f); f.releases.push(gate.resolve);
    await ready(p); await ok(p.a, 'game:start'); await ok(p.a, 'game:submit_action', choice(f, p, { tactic: 'risky' }));
    await waitFor(() => p.bViews.at(-1)?.game?.execution === 'generating');
    expect(JSON.stringify(p.bViews.at(-1))).not.toContain('P04'); expect(p.bViews.at(-1)!.ownAction).toBeNull();
    gate.resolve(); await waitFor(() => p.bViews.at(-1)?.publicEvidence.some(e => e.id === 'P04'));
    expect(JSON.stringify(p.bViews.at(-1))).not.toContain('P06'); expect(p.bViews.at(-1)!.events.at(-1)?.random).toBeDefined();
  });
  it.each(['same-model', 'different-model'] as const)('uses each private config in %s play and never broadcasts or persists keys', async mode => {
    const llm = new FakeModels(undefined, true), store = new RecordingStore(), f = await fixture({ llm, store, trustProxy: true }), p = await pair(f, 'diamond-002', true);
    const a = config({ provider: 'deepseek', apiKey: 'FAKE-SECRET-A', model: 'model-a' }), b = config({ provider: 'qwen', apiKey: 'FAKE-SECRET-B', model: mode === 'same-model' ? 'model-a' : 'model-b' });
    await ready(p, a, b); await ok(p.a, 'game:start'); for (let i = 0; i < 8; i++) await step(f, p);
    expect(llm.seen.filter(r => r.side === 'defense').every(r => r.config.apiKey === a.apiKey)).toBe(true);
    expect(llm.seen.filter(r => r.side === 'prosecution').every(r => r.config.apiKey === b.apiKey)).toBe(true);
    const serialized = JSON.stringify([p.aViews, p.bViews, store.writes]); expect(serialized).not.toContain(a.apiKey); expect(serialized).not.toContain(b.apiKey);
    expect(p.aViews.at(-1)!.players[1].config!.model).toBe(b.model);
  });
  it('settles an accepted in-flight action once across disconnect/resume, without automatically starting another', async () => {
    const gate = deferred(), llm = new FakeModels(gate), f = await fixture({ llm, trustProxy: true }), p = await pair(f, 'pizza-001', true); f.releases.push(gate.resolve);
    const real = config({ provider: 'deepseek', apiKey: 'FAKE-PRIVATE-A', model: 'a' }); await ready(p, real); await ok(p.a, 'game:start'); await ok(p.a, 'game:submit_action', choice(f, p));
    p.a.disconnect(); const room = f.server.rooms.get(p.code)!; await waitFor(() => !room.players[0].socketId); expect(room.players[0].config?.apiKey).toBe('');
    const replacement = await f.connect(true); p.a = replacement; const resumed = await ok<Entry>(replacement, 'room:resume', p.first.session); expect(resumed.room.ownAction?.status).toBe('generating');
    await ok(replacement, 'ai:configure', real); gate.resolve(); await waitFor(() => room.game!.completedActions === 1); await new Promise(r => setTimeout(r, 20)); expect(llm.seen).toHaveLength(1);
  });
  it('cancels an in-flight action and ignores its late output', async () => {
    const gate = deferred(), llm = new FakeModels(gate), store = new RecordingStore(), f = await fixture({ llm, store }), p = await pair(f); f.releases.push(gate.resolve);
    await ready(p); await ok(p.a, 'game:start'); await ok(p.a, 'game:submit_action', choice(f, p)); await ok(p.b, 'room:leave'); gate.resolve();
    const room = f.server.rooms.get(p.code)!; await waitFor(() => room.status === 'cancelled'); await new Promise(r => setTimeout(r, 20));
    expect(room.game!.completedActions).toBe(0); expect(room.game!.verdict).toBeNull(); expect(store.terminal.at(-1)).toBeNull();
  });
  it('never publishes a verdict when cancellation races final database append', async () => {
    const gate = deferred(), entered = deferred();
    class SlowStore extends RecordingStore { block = false; override async append(...a: Parameters<Store['append']>) { if (this.block) { entered.resolve(); await gate.promise; } await super.append(...a); } }
    const store = new SlowStore(), f = await fixture({ store }), p = await pair(f); f.releases.push(gate.resolve);
    await ready(p); await ok(p.a, 'game:start'); for (let i = 0; i < 7; i++) await step(f, p);
    store.block = true; await ok(p.b, 'game:submit_action', choice(f, p)); await entered.promise;
    const leaving = ok(p.a, 'room:leave'); await waitFor(() => f.server.rooms.get(p.code)!.status === 'cancelled'); gate.resolve(); await leaving;
    expect(store.terminal.at(-1)).toBeNull(); expect(p.bViews.some(v => v.status === 'finished')).toBe(false); expect(f.server.rooms.get(p.code)!.game!.verdict).toBeNull();
  });
  it('clears stale socket bindings after TTL so leaving and creating another room works', async () => {
    const f = await fixture({ roomTtlMs: 100 }), p = await pair(f);
    await waitFor(() => !f.server.rooms.has(p.code)); await ok(p.a, 'room:leave'); const next = await ok<Entry>(p.a, 'room:create', { nickname: '新房主', caseId: 'pizza-001' }); expect(next.room.code).not.toBe(p.code);
  });
  it('does not let an occupied socket hijack another guest or room', async () => {
    const f = await fixture(), p = await pair(f), stranger = await f.connect();
    expect((await ack(stranger, 'room:resume', { ...p.first.session, token: '0'.repeat(64) })).ok).toBe(false);
    expect((await ack(p.b, 'room:resume', p.first.session)).ok).toBe(false); expect(f.server.rooms.get(p.code)!.players[1].socketId).toBe(p.b.id);
  });
});

describe('V1.2 private preview and mode protocol', () => {
  it.each(['casual', 'standard', 'hardcore'] as const)('completes eight confirmed actions with correct %s payloads and actual results', async mode => {
    const llm = new FakeModels(), f = await fixture({ llm }), p = await pair(f, 'diamond-002', false, mode);
    await ready(p); await ok(p.a, 'game:start');
    const room = f.server.rooms.get(p.code)!;
    expect(room.lockedCase?.matchMode).toBe(mode); expect(p.bViews.at(-1)?.mode).toBe(mode);
    for (let n = 0; n < 8; n++) {
      const socket = room.game!.turn === 'defense' ? p.a : p.b, c = choice(f, p), before = structuredClone(room.game), ledger = structuredClone(room.ledger);
      const { actionId: _id, ...draft } = c;
      const preview = await ok<ActionPreview>(socket, 'game:preview_action', draft);
      expect(llm.seen).toHaveLength(n); expect(room.game).toEqual(before); expect(room.ledger).toEqual(ledger);
      if (mode === 'hardcore') expect(preview).not.toHaveProperty('forecast');
      else if (mode === 'standard') { expect(preview.forecast).not.toHaveProperty('score'); expect(JSON.stringify(preview.forecast)).not.toMatch(/\d/); }
      else expect(preview.forecast?.score).toBeDefined();
      const confirmed = { ...c, previewId: preview.previewId };
      const [a, b] = await Promise.all([ok<ActionReceipt>(socket, 'game:submit_action', confirmed), ok<ActionReceipt>(socket, 'game:submit_action', confirmed)]);
      expect(a.actionId).toBe(b.actionId);
      await waitFor(() => room.game!.completedActions === n + 1);
      expect(llm.seen).toHaveLength(n + 1);
      const event = room.game!.events.find(e => e.id === c.actionId)!;
      await waitFor(() => p.aViews.at(-1)?.events.some(e => e.id === c.actionId) && p.bViews.at(-1)?.events.some(e => e.id === c.actionId));
      expect(event.settlement?.costs).toContain('使用 1 次行动机会'); expect(event.settlement?.comparison).toBeTruthy();
      expect(p.aViews.at(-1)?.events.find(e => e.id === c.actionId)?.settlement).toBeDefined();
      expect(p.bViews.at(-1)?.events.find(e => e.id === c.actionId)?.settlement).toBeDefined();
      if (preview.forecast?.certainty === 'certain' && preview.forecast.score) expect(event.scoreDelta).toBe(preview.forecast.score[0]);
    }
    expect(room.status).toBe('finished'); expect(room.game!.events.filter(e => e.kind === 'action')).toHaveLength(8);
    expect(replayGame(room.lockedCase!, { defense: config(), prosecution: config() }, room.game!.events).verdict).toEqual(room.game!.verdict);
  });
  it('permits only host setup changes, resets readiness, locks mode, and rejects changed or stale confirmations', async () => {
    const llm = new FakeModels(), f = await fixture({ llm }), p = await pair(f); await ready(p);
    expect((await ack(p.b, 'room:mode', { mode: 'casual' })).ok).toBe(false);
    await ok(p.a, 'room:mode', { mode: 'casual' }); const room = f.server.rooms.get(p.code)!;
    expect(room.players.every(p => !p.ready)).toBe(true);
    await ok(p.a, 'room:ready', { ready: true }); await ok(p.b, 'room:ready', { ready: true }); await ok(p.a, 'game:start');
    expect((await ack(p.a, 'room:mode', { mode: 'hardcore' })).ok).toBe(false);
    const c = choice(f, p), { actionId: _id, ...draft } = c;
    const preview = await ok<ActionPreview>(p.a, 'game:preview_action', draft);
    expect((await ack(p.a, 'game:submit_action', { ...c, tactic: 'risky', previewId: preview.previewId })).ok).toBe(false);
    expect((await ack(p.b, 'game:preview_action', draft)).ok).toBe(false);
    expect((await ack(p.a, 'game:preview_action', { ...draft, evidenceIds: ['D05'] })).ok).toBe(false);
    expect((await ack(p.a, 'game:preview_action', { ...draft, evidenceIds: ['P05'] })).ok).toBe(false);
    expect(llm.seen).toHaveLength(0); expect(room.game!.completedActions).toBe(0);
    await ok(p.a, 'game:submit_action', { ...c, previewId: preview.previewId }); await waitFor(() => room.game!.completedActions === 1);
    expect((await ack(p.a, 'game:preview_action', draft)).ok).toBe(false);
    expect((await ack(p.a, 'game:submit_action', { ...c, actionId: randomUUID(), previewId: preview.previewId })).ok).toBe(false);
    expect(llm.seen).toHaveLength(1);
  });
  it('accepts no preview or action during generation and does not broadcast private forecasts', async () => {
    const gate = deferred(), llm = new FakeModels(gate), f = await fixture({ llm }), p = await pair(f, 'pizza-001', false, 'casual'); f.releases.push(gate.resolve);
    await ready(p); await ok(p.a, 'game:start');
    const room = f.server.rooms.get(p.code)!, c = choice(f, p), { actionId: _id, ...draft } = c;
    await waitFor(() => p.bViews.at(-1)?.game?.execution === 'awaiting_action');
    const views = p.bViews.length, ledger = structuredClone(room.ledger);
    const preview = await ok<ActionPreview>(p.a, 'game:preview_action', draft);
    expect(room.ledger).toEqual(ledger); expect(p.bViews.length).toBe(views); expect(JSON.stringify(p.bViews)).not.toContain(preview.previewId);
    await ok(p.a, 'game:submit_action', { ...c, previewId: preview.previewId });
    expect((await ack(p.a, 'game:preview_action', draft)).ok).toBe(false);
    expect((await ack(p.a, 'game:submit_action', { ...c, actionId: randomUUID() })).ok).toBe(false);
    gate.resolve(); await waitFor(() => room.game!.completedActions === 1); expect(llm.seen).toHaveLength(1);
  });
});
