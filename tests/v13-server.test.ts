import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { createCourtServer } from '../server/app';
import { Store } from '../server/store';
import { DailyBudget, LlmService, type ActionRequest, type ActionReply } from '../server/llm';
import { CASES_V3 } from '../server/cases-v3';
import { getActionOptions, replayGame, turnIdFor } from '../server/game';
import { config } from './helpers';
import { clashChoice } from './v13-helpers';
import type { Ack, ActionCommand, ActionPreview, CaseTemplate, MatchMode, RoomView, Session } from '../shared/types';
type Court = Awaited<ReturnType<typeof createCourtServer>>;
type Entry = { session: Session; room: RoomView };
const all: { court: Court; sockets: Socket[]; release: (() => void)[] }[] = [];
const ack = <T = undefined>(s: Socket, event: string, data: unknown = {}): Promise<Ack<T>> => new Promise((resolve, reject) => s.timeout(5000).emit(event, data, (e: Error | null, result: Ack<T>) => e ? reject(e) : resolve(result)));
async function ok<T = undefined>(s: Socket, event: string, data: unknown = {}): Promise<T> { const a = await ack<T>(s, event, data); expect(a.ok, a.error).toBe(true); return a.data as T; }
async function until(check: () => boolean) { for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error('同步超时'); }
class Models extends LlmService {
  seen: ActionRequest[] = []; gate?: Promise<void>;
  constructor() { super({ budget: new DailyBudget({ maxRequests: 100, limit: 10 }) }); }
  override async completeAction(input: ActionRequest): Promise<ActionReply> { this.seen.push(input); await this.gate; return super.completeAction(input); }
}
async function setup(id = 'pizza-001', mode: MatchMode = 'casual', auto = false, history: string[] = []) {
  const models = new Models(), court = await createCourtServer({ store: new Store('memory'), llm: models }), sockets: Socket[] = [], release: (() => void)[] = [];
  all.push({ court, sockets, release }); await new Promise<void>(r => court.http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(court.http.address() as { port: number }).port}`;
  const connect = async () => { const s = io(url, { forceNew: true, reconnection: false, transports: ['websocket'] }); sockets.push(s); await new Promise<void>((r, reject) => { s.on('connect', r); s.on('connect_error', reject); }); return s; };
  const a = await connect(), b = await connect(), viewsA: RoomView[] = [], viewsB: RoomView[] = [];
  a.on('room:update', v => viewsA.push(v)); b.on('room:update', v => viewsB.push(v));
  await ok(a, 'preferences:resume'); await ok(b, 'preferences:resume');
  const first = await ok<Entry>(a, 'room:create', { nickname: '辩方测试', mode, ...(auto ? { difficulty: 'beginner', selection: 'auto', recentCaseIds: history } : { caseId: id }) });
  const second = await ok<Entry>(b, 'room:join', { nickname: '控方测试', code: first.room.code, recentCaseIds: history });
  const room = court.rooms.get(first.room.code)!;
  const ready = async () => { for (const s of [a, b]) { await ok(s, 'ai:configure', config()); await ok(s, 'room:ready', { ready: true }); } };
  const start = async () => { await ready(); await ok(a, 'game:start'); await until(() => viewsA.at(-1)?.game?.execution === 'awaiting_action' && viewsB.at(-1)?.game?.execution === 'awaiting_action'); };
  const current = () => ({ ...clashChoice(room.lockedCase!, room.game!), turnId: turnIdFor(room.matchId!, room.game!) });
  const step = async (patch: Partial<ActionCommand> = {}) => {
    const c = { ...current(), ...patch }, side = room.game!.turn, socket = side === 'defense' ? a : b, before = room.game!.completedActions;
    const { actionId: _id, ...draft } = c; const preview = await ok<ActionPreview>(socket, 'game:preview_action', draft);
    await ok(socket, 'game:submit_action', { ...c, previewId: preview.previewId });
    await until(() => room.game!.completedActions === before + 1 && !!viewsA.at(-1)?.events.some(e => e.id === c.actionId) && !!viewsB.at(-1)?.events.some(e => e.id === c.actionId));
    return { preview, c };
  };
  return { models, court, a, b, room, viewsA, viewsB, first, second, connect, start, ready, current, step, release };
}
afterEach(async () => { for (const f of all.splice(0)) { f.release.forEach(r => r()); f.sockets.forEach(s => s.disconnect()); await f.court.close(); } });

describe('V1.3 real Socket.IO integration, no paid endpoints', () => {
  it.each(CASES_V3)('runs twelve explicit previews and submissions to a replayable verdict in $id', async base => {
    const f = await setup(base.id); await f.start(); expect(f.models.seen).toHaveLength(0);
    expect(f.room.lockedCase?.engineVersion).toBe(3); expect(f.room.game?.players.defense.stability).toBe(90);
    while (f.room.game!.phase !== 'finished') {
      const count = f.room.game!.completedActions; await f.step(); expect(f.models.seen).toHaveLength(count + 1);
    }
    expect(f.room.status).toBe('finished'); expect(f.room.game!.completedActions).toBe(12); expect(f.room.ledger.primary).toEqual({ defense: 6, prosecution: 6 });
    expect(f.room.players.every(p => p.usage.fallback === 0)).toBe(true); expect(f.room.game!.opportunities).toBe(12);
    expect(replayGame(f.room.lockedCase!, { defense: config(), prosecution: config() }, f.room.game!.events).verdict).toEqual(f.room.game!.verdict);
    expect(f.viewsA.at(-1)?.game?.totalOpportunities).toBe(12);
    expect(f.viewsB.at(-1)?.events.filter(e => e.kind === 'action').every(e => !!e.settlement?.ruleIds)).toBe(true);
  });
  it.each(['casual', 'standard', 'hardcore'] as const)('preserves mode restrictions through all twelve %s results', async mode => {
    const f = await setup('document-011', mode); await f.start();
    while (f.room.game!.phase !== 'finished') {
      const before = structuredClone(f.room.game!), c = f.current(), { actionId: _id, ...draft } = c, socket = f.room.game!.turn === 'defense' ? f.a : f.b;
      const count = f.models.seen.length, preview = await ok<ActionPreview>(socket, 'game:preview_action', draft);
      expect(f.room.game).toEqual(before); expect(f.models.seen).toHaveLength(count);
      if (mode === 'hardcore') expect(preview).not.toHaveProperty('forecast');
      if (mode === 'standard') { expect(preview.forecast).not.toHaveProperty('score'); expect(JSON.stringify(preview.forecast)).not.toMatch(/\d/); }
      if (mode === 'casual') expect(preview.forecast?.score).toBeDefined();
      await f.step();
    }
    expect(f.viewsA.at(-1)?.events.filter(e => e.kind === 'action').every(e => e.settlement?.explanation && e.settlement.calmChanges)).toBe(true);
  });
  it('locks difficulty, hint mode, case, seed and variant; reconnecting and key restoration never issue a model call', async () => {
    const f = await setup(); await f.ready();
    expect((await ack(f.b, 'room:difficulty', { difficulty: 'complex' })).ok).toBe(false);
    await ok(f.a, 'room:difficulty', { difficulty: 'complex', selection: 'auto' }); expect(f.room.players.every(p => !p.ready)).toBe(true);
    await f.start(); const snapshot = JSON.stringify(f.room.lockedCase); const oldTurn = f.viewsA.at(-1)!.game!.turnId;
    for (const [event, body] of [['room:case', { caseId: 'pizza-001' }], ['room:mode', { mode: 'hardcore' }], ['room:difficulty', { difficulty: 'beginner' }]] as const) expect((await ack(f.a, event, body)).ok).toBe(false);
    f.a.disconnect(); const replacement = await f.connect(); await ok(replacement, 'room:resume', f.first.session); await ok(replacement, 'ai:configure', config());
    expect(f.models.seen).toHaveLength(0); expect(JSON.stringify(f.room.lockedCase)).toBe(snapshot); expect(turnIdFor(f.room.matchId!, f.room.game!)).toBe(oldTurn);
  });
  it('isolates private lead findings, guide facts and public-only history from the other connection', async () => {
    const f = await setup('pudding-004'); await f.start();
    const privateOther = f.room.lockedCase!.evidence.filter(e => e.visibility === 'prosecution' && !f.room.game!.publicEvidenceIds.includes(e.id));
    const json = JSON.stringify(f.viewsA.at(-1)); for (const e of privateOther) expect(json).not.toContain(e.title);
    expect(json).not.toMatch(/apiKey|reliability|linkedIds|"flaw"|"strength"|"truth"/);
    const s = f.room.game!, o = getActionOptions(f.room.lockedCase!, s, 'defense').find(o => o.actionType === 'investigate_lead')!;
    const privateData = (v: RoomView) => v.privateEvidence.map(({ state: _state, ...material }) => material);
    const beforeB = JSON.stringify(privateData(f.viewsB.at(-1)!));
    const c = { ...f.current(), optionId: o.id, evidenceIds: [], leadIds: [o.leads![0].id], targetArgumentId: null, tactic: 'steady' as const };
    const { actionId: _id, ...draft } = c;
    const preview = await ok<ActionPreview>(f.a, 'game:preview_action', draft);
    expect((await ack(f.b, 'game:preview_action', draft)).ok).toBe(false);
    expect((await ack(f.a, 'game:preview_action', { ...draft, leadIds: ['lead:prosecution:1'] })).ok).toBe(false);
    await ok(f.a, 'game:submit_action', { ...c, previewId: preview.previewId }); await until(() => f.room.game!.completedActions === 1 && !!f.viewsB.at(-1)?.events.some(e => e.id === c.actionId));
    expect(JSON.stringify(privateData(f.viewsB.at(-1)!))).toBe(beforeB); expect(f.viewsA.at(-1)!.recentCaseIds).toEqual(['pudding-004']);
    const discovered = f.room.lockedCase!.evidence.filter(e => f.room.game!.players.defense.knownEvidenceIds.includes(e.id) && !s.players.defense.knownEvidenceIds.includes(e.id));
    for (const e of discovered) expect(JSON.stringify(f.viewsB.at(-1))).not.toContain(e.title);
  });
  it('holds one action lock during generation; concurrent duplicates reuse dice and settle once after a disconnect', async () => {
    const f = await setup(); await f.start(); let release!: () => void; f.models.gate = new Promise<void>(r => release = r); f.release.push(release);
    f.room.game!.players.defense.stability = 0; const c = { ...f.current(), tactic: 'risky' as const }, { actionId: _id, ...draft } = c;
    const preview = await ok<ActionPreview>(f.a, 'game:preview_action', draft), confirmed = { ...c, previewId: preview.previewId };
    const [a, b] = await Promise.all([ok(f.a, 'game:submit_action', confirmed), ok(f.a, 'game:submit_action', confirmed)]); expect(a).toEqual(b);
    expect((await ack(f.a, 'game:submit_action', { ...confirmed, actionId: randomUUID() })).ok).toBe(false);
    expect((await ack(f.a, 'game:preview_action', draft)).ok).toBe(false);
    const locked = structuredClone(f.room.pending!.prepared.event); f.a.disconnect(); release(); await until(() => f.room.game!.completedActions === 1);
    expect(f.room.game!.events.find(e => e.id === c.actionId)?.random).toEqual(locked.random); expect(f.room.game!.events.find(e => e.id === c.actionId)?.meltdown).toEqual(locked.meltdown);
    const replacement = await f.connect(); await ok(replacement, 'room:resume', f.first.session); await ok(replacement, 'game:submit_action', confirmed);
    expect(f.models.seen).toHaveLength(1); expect(f.room.game!.completedActions).toBe(1); expect(f.room.game!.players.defense.actionPoints).toBe(5);
  });
  it('auto-selects outside recent cases and alternates the last route of a deliberately repeated case', async () => {
    const history = CASES_V3.filter(t => t.difficulty === 'beginner').slice(0, 3).map(t => t.id);
    const f = await setup('pizza-001', 'casual', true, history); expect(history).not.toContain(f.room.caseId); await f.start();
    const caseId = f.room.caseId, route = f.room.lockedCase!.variant!.id;
    await ok(f.a, 'room:leave'); await ok(f.b, 'room:leave');
    const entry = await ok<Entry>(f.a, 'room:create', { nickname: '再次测试', caseId });
    await ok(f.b, 'room:join', { nickname: '再次对手', code: entry.room.code });
    const next = f.court.rooms.get(entry.room.code)!; for (const s of [f.a, f.b]) await ok(s, 'room:ready', { ready: true }); await ok(f.a, 'game:start');
    expect(next.lockedCase!.variant!.id).not.toBe(route);
  });
});
