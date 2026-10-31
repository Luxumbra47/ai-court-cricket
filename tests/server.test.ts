import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createCourtServer } from '../server/whisper-app';
import { AgentService } from '../server/agents';
import { DailyBudget } from '../server/provider';
import type { TtsService } from '../server/tts';
import type { Ack, Entry, PlaybackSegment, RoomView } from '../shared/whisper';

type Court = Awaited<ReturnType<typeof createCourtServer>>;
const active: { court: Court; sockets: Socket[] }[] = [];
const ack = <T = void>(socket: Socket, event: string, data: unknown = {}): Promise<Ack<T>> => new Promise((resolve, reject) => socket.timeout(2500).emit(event, data, (err: Error | null, result: Ack<T>) => err ? reject(err) : resolve(result)));
async function ok<T = void>(socket: Socket, event: string, data: unknown = {}): Promise<T> { const result = await ack<T>(socket, event, data); expect(result.ok, result.error).toBe(true); return result.data as T; }
async function until(check: () => boolean) { for (let i = 0; i < 600; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error('状态等待超时'); }
async function setup(options: Parameters<typeof createCourtServer>[0] = {}) {
  const court = await createCourtServer({ moveDelayMs: 0, whisperMs: 10000, publicMs: 10000, playbackWaitMs: 0, ...options }), sockets: Socket[] = [];
  active.push({ court, sockets }); await new Promise<void>(resolve => court.http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(court.http.address() as { port: number }).port}`;
  const connect = async () => { const socket = io(url, { forceNew: true, reconnection: false, transports: ['websocket'] }); sockets.push(socket); await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket; };
  return { court, connect, url };
}
afterEach(async () => { for (const fixture of active.splice(0)) { fixture.sockets.forEach(s => s.disconnect()); await fixture.court.close(); } });

describe('real multiplayer sessions', () => {
  it('plays a full three-act duel, isolates secrets and reveals them only after the outcome', async () => {
    const fixture = await setup(), a = await fixture.connect(), b = await fixture.connect(), third = await fixture.connect();
    let viewA: RoomView, viewB: RoomView;
    a.on('room:update', view => { viewA = view; }); b.on('room:update', view => { viewB = view; });
    const first = await ok<Entry>(a, 'room:create', { nickname: '甲玩家' });
    await ok<Entry>(b, 'room:join', { nickname: '乙玩家', code: first.session.code });
    expect((await ack(third, 'room:join', { nickname: '第三人', code: first.session.code })).ok).toBe(false);
    await ok(a, 'room:ready', { ready: true }); await ok(b, 'room:ready', { ready: true });
    expect((await ack(b, 'game:start')).ok).toBe(false);
    await ok(a, 'game:start'); await until(() => viewA?.status === 'playing' && viewB?.status === 'playing');
    const room = fixture.court.rooms.get(first.session.code)!;
    expect(JSON.stringify(viewA!)).not.toContain(room.scenario.secrets.b);
    expect(JSON.stringify(viewB!)).not.toContain(room.scenario.secrets.a);
    expect(viewA!.agents.find(p => p.side === 'b')?.personality).toBeNull();
    expect((await ack(a, 'game:whisper', { act: 1, channel: 'private', text: '很'.repeat(16) })).ok).toBe(false);
    expect((await ack(a, 'game:whisper', { act: 1, channel: 'public', text: '公开' })).ok).toBe(false);
    await ok(a, 'game:whisper', { act: 1, channel: 'private', text: '再拖三轮' });
    await ok(a, 'game:whisper', { act: 1, channel: 'private', text: '再拖三轮' });
    await until(() => viewA!.own.trust === 65);
    expect(viewA!.own.changes).toHaveLength(1);
    expect(JSON.stringify(viewB!)).not.toContain('再拖三轮');
    await ok(b, 'game:whisper', { act: 1, channel: 'private', text: '保留底线' });
    await until(() => viewA!.phase === 'public');
    expect(viewA!.events.filter(e => e.kind === 'speech')).toHaveLength(3);
    await ok(a, 'game:whisper', { act: 1, channel: 'public', text: '请拿出凭证' });
    await ok(b, 'game:whisper', { act: 1, channel: 'public', text: '' });
    await until(() => viewA!.act === 2 && viewA!.phase === 'whisper');
    for (const act of [2, 3]) {
      await ok(a, 'game:whisper', { act, channel: 'private', text: act === 2 ? '查验他的货源' : '' });
      await ok(b, 'game:whisper', { act, channel: 'private', text: '' });
      await until(() => viewA!.phase === 'public');
      await ok(a, 'game:whisper', { act, channel: 'public', text: '' });
      await ok(b, 'game:whisper', { act, channel: 'public', text: '' });
      await until(() => act === 3 ? viewA!.status === 'finished' : viewA!.act === 3 && viewA!.phase === 'whisper');
    }
    expect(viewA!.events.filter(e => e.kind === 'speech')).toHaveLength(12);
    expect(viewA!.outcome?.whispers.some(w => w.side === 'b' && w.text === '保留底线')).toBe(true);
    expect(viewA!.outcome?.secrets.b).toBe(room.scenario.secrets.b);
    expect(viewA!.usage.calls).toBe(0);
    expect(viewA!.own.reports.map(r => r.act)).toEqual([0, 1, 2, 3]);
  });
  it('projects only the owner’s hidden objective and reveals both after the match', async () => {
    const fixture = await setup({ whisperMs: 15, publicMs: 15 }), socket = await fixture.connect(); let view: RoomView;
    socket.on('room:update', update => { view = update; });
    const entry = await ok<Entry>(socket, 'room:create', { nickname: '副目标', practice: true });
    const room = fixture.court.rooms.get(entry.room.code)!;
    const own = fixture.court.project(room, room.players[0]), peer = fixture.court.project(room, room.players[1]);
    expect(own.own.objective.title).toBe(room.scenario.objectives.a.title);
    expect(own.own.objective).not.toHaveProperty('achieved');
    expect(own.own.objective).not.toHaveProperty('detail');
    expect(peer.own.objective.title).toBe(room.scenario.objectives.b.title);
    expect(JSON.stringify(own)).not.toContain(room.scenario.objectives.b.title);
    expect(JSON.stringify(own)).not.toContain(room.scenario.objectives.b.description);
    expect(JSON.stringify(peer)).not.toContain(room.scenario.objectives.a.title);
    expect(JSON.stringify(peer)).not.toContain(room.scenario.objectives.a.description);
    expect(own.scenario).not.toHaveProperty('objectives');
    expect(JSON.stringify(own.events)).not.toContain(room.scenario.objectives.a.title);
    expect(JSON.stringify(peer)).not.toContain(room.scenario.secrets.a);
    expect(JSON.stringify(own.own.reports)).not.toContain(room.scenario.secrets.b);
    await until(() => view?.status === 'finished');
    expect(view!.outcome!.objectives.a.title).toBe(room.scenario.objectives.a.title);
    expect(view!.outcome!.objectives.b.title).toBe(room.scenario.objectives.b.title);
    expect(view!.outcome!.objectives.a).toHaveProperty('achieved', expect.any(Boolean));
    expect(view!.outcome!.objectives.a).toHaveProperty('detail');
    expect(view!.outcome!.objectives.b.detail).toBeTruthy();
    expect(JSON.stringify(view!.own)).not.toContain(room.scenario.objectives.b.title);
  });
  it('validates stance and public cards and never leaks the private note to the peer', async () => {
    const fixture = await setup(), a = await fixture.connect(), b = await fixture.connect();
    let viewA: RoomView, viewB: RoomView;
    a.on('room:update', view => { viewA = view; }); b.on('room:update', view => { viewB = view; });
    const entry = await ok<Entry>(a, 'room:create', { nickname: '甲玩家' });
    await ok<Entry>(b, 'room:join', { nickname: '乙玩家', code: entry.room.code });
    await ok(a, 'room:ready', { ready: true }); await ok(b, 'room:ready', { ready: true }); await ok(a, 'game:start');
    await until(() => viewA?.phase === 'whisper');
    expect((await ack(a, 'game:whisper', { act: 1, channel: 'private', text: '秘密备注', stance: 'guard' })).ok).toBe(false);
    await ok(a, 'game:whisper', { act: 1, channel: 'private', text: '秘密备注', stance: 'hold' });
    expect(viewA!.own.whispers.at(-1)).toMatchObject({ stance: 'hold', text: '秘密备注' });
    expect(JSON.stringify(viewB!)).not.toContain('秘密备注');
    await ok(b, 'game:whisper', { act: 1, channel: 'private', text: '', stance: 'probe' });
    await until(() => viewA!.phase === 'public');
    expect((await ack(a, 'game:whisper', { act: 1, channel: 'public', text: '', stance: 'hold' })).ok).toBe(false);
    expect((await ack(a, 'game:whisper', { act: 1, channel: 'public', text: '', publicCard: 'threat' })).ok).toBe(false);
    await ok(a, 'game:whisper', { act: 1, channel: 'public', text: '', publicCard: 'pressure' });
    await ok(b, 'game:whisper', { act: 1, channel: 'public', text: '', publicCard: 'promise' });
    await until(() => viewA!.act === 2 || viewA!.status === 'finished');
    expect(viewA!.events.some(e => e.kind === 'whisper' && e.publicCard === 'pressure')).toBe(true);
    expect(JSON.stringify(viewB!.events)).toContain('pressure');
  });
  it('defaults to 30-second private phases and 15-second public phases', async () => {
    const fixture = await setup({ whisperMs: undefined, publicMs: undefined }), socket = await fixture.connect();
    let view: RoomView;
    socket.on('room:update', update => { view = update; });
    await ok<Entry>(socket, 'room:create', { nickname: '计时员', practice: true });
    await until(() => view?.phase === 'whisper');
    expect(view!.deadline! - Date.now()).toBeGreaterThan(28000);
    expect(view!.deadline! - Date.now()).toBeLessThanOrEqual(30000);
    await ok(socket, 'game:whisper', { act: 1, channel: 'private', text: '', stance: 'hold' });
    await until(() => view!.phase === 'public');
    expect(view!.deadline! - Date.now()).toBeGreaterThan(13500);
    expect(view!.deadline! - Date.now()).toBeLessThanOrEqual(15000);
  });
  it('runs autonomously when both players leave every stage blank', async () => {
    const fixture = await setup({ whisperMs: 15, publicMs: 15 }); const socket = await fixture.connect(); let view: RoomView;
    socket.on('room:update', update => { view = update; });
    await ok<Entry>(socket, 'room:create', { nickname: '旁观者', practice: true });
    await until(() => view?.status === 'finished');
    expect(view!.events.filter(e => e.kind === 'speech')).toHaveLength(12);
    expect(view!.outcome?.whispers).toHaveLength(0);
    expect(view!.outcome?.price).not.toBeNull();
  });
  it('resumes only the authenticated seat and cannot reuse credentials to send from an old socket', async () => {
    const fixture = await setup(), original = await fixture.connect();
    const entry = await ok<Entry>(original, 'room:create', { nickname: '玩家', practice: true });
    const attacker = await fixture.connect();
    expect((await ack(attacker, 'session:resume', { ...entry.session, token: '0'.repeat(48) })).ok).toBe(false);
    const recovered = await ok<Entry>(attacker, 'session:resume', entry.session);
    expect(recovered.room.you).toBe('a');
    await until(() => !original.connected);
    await ok(attacker, 'game:whisper', { act: 1, channel: 'private', text: '查验他的货源' });
    expect(fixture.court.rooms.get(entry.room.code)?.game?.agents.a.whispers).toHaveLength(1);
  });
  it('cancels on leave without declaring a winner', async () => {
    const fixture = await setup(), socket = await fixture.connect();
    const entry = await ok<Entry>(socket, 'room:create', { nickname: '玩家', practice: true });
    await ok(socket, 'room:leave');
    expect(fixture.court.rooms.get(entry.room.code)?.status).toBe('cancelled');
    expect(fixture.court.rooms.get(entry.room.code)?.game?.outcome).toBeNull();
  });
  it('rejects paid credentials over plain HTTP even if the client forges a forwarded header', async () => {
    const fixture = await setup(), socket = await fixture.connect();
    await ok(socket, 'room:create', { nickname: '玩家' });
    const result = await ack(socket, 'ai:configure', { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'never-send-me', personality: 'composed' });
    expect(result.ok).toBe(false); expect(result.error).toContain('HTTPS');
    const room = [...fixture.court.rooms.values()][0];
    expect(JSON.stringify(fixture.court.project(room, room.players[0]))).not.toContain('never-send-me');
  });
});

describe('local speech synthesis endpoint', () => {
  it('reports its voice and returns audio bytes without spawning system speech in tests', async () => {
    const wav = Buffer.from('RIFF0000WAVEfmt ', 'ascii');
    const fake: TtsService = { available: true, status: async () => ({ available: true, voice: '测试音色' }), synthesize: async () => wav };
    const fixture = await setup({ tts: fake }), socket = await fixture.connect();
    const entry = await ok<Entry>(socket, 'room:create', { nickname: '语音测试' });
    const code = entry.room.code;
    expect((await fetch(`${fixture.url}/api/tts/status`)).status).toBe(403);
    expect(await (await fetch(`${fixture.url}/api/tts/status?code=${code}`)).json()).toMatchObject({ available: true, voice: '测试音色' });
    const audio = await fetch(`${fixture.url}/api/tts?code=${code}&side=b&text=${encodeURIComponent('一句公开对白')}`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toContain('audio/wav');
    expect((await audio.arrayBuffer()).byteLength).toBe(wav.length);
  });
  it('returns a clear unavailable response when the system has no Chinese voice', async () => {
    const fake: TtsService = {
      available: false, synthesize: async () => { throw new Error('系统没有安装中文语音。'); },
      status: async () => ({ available: false, voice: null, reason: '系统没有安装中文语音。' }),
    };
    const fixture = await setup({ tts: fake }), socket = await fixture.connect();
    const entry = await ok<Entry>(socket, 'room:create', { nickname: '语音测试' });
    const code = entry.room.code;
    expect(await (await fetch(`${fixture.url}/api/tts/status?code=${code}`)).json()).toMatchObject({ available: false });
    const audio = await fetch(`${fixture.url}/api/tts?code=${code}&side=a&text=${encodeURIComponent('测试')}`);
    expect(audio.status).toBe(503);
    expect(await audio.json()).toMatchObject({ available: false });
  });
});

describe('provider failure handling', () => {
  it('falls back without exposing upstream messages and caps actual requests with the shared budget', async () => {
    const service = new AgentService({ adapter: { async complete() { throw new Error('secret-key-upstream-response'); } }, budget: new DailyBudget({ maxRequests: 1 }), timeoutMs: 100 });
    const fixture = await setup({ agents: service, whisperMs: 15, publicMs: 15 });
    const socket = await fixture.connect(); let view: RoomView;
    socket.on('room:update', update => { view = update; });
    const entry = await ok<Entry>(socket, 'room:create', { nickname: '玩家' });
    const room = fixture.court.rooms.get(entry.room.code)!;
    room.players[0].config = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'sensitive-key', personality: 'composed' };
    room.players.push({ ...room.players[0], side: 'b', token: '', bot: true, ready: true, socketId: null, config: { provider: 'mock', baseUrl: '', model: 'local-strategy-v1', apiKey: '', personality: 'enigmatic' } });
    await ok(socket, 'room:ready', { ready: true }); await ok(socket, 'game:start');
    await until(() => view?.status === 'finished');
    expect(view!.usage.calls).toBe(1); expect(view!.usage.fallbacks).toBe(7);
    expect(JSON.stringify(view!)).not.toContain('secret-key-upstream-response');
    expect(JSON.stringify(view!)).not.toContain('sensitive-key');
    expect(room.players[0].config.apiKey).toBe('');
  });
});

describe('segmented playback synchronization', () => {
  const waitGate = async (view: () => RoomView, match: (segment: PlaybackSegment) => boolean = () => true) => {
    await until(() => { const segment = view()?.playback; return !!segment?.waiting && match(segment); });
    return view().playback!;
  };
  const confirm = (socket: Socket, segment: PlaybackSegment) => ok<{ accepted: boolean }>(socket, 'game:playback-complete', { segmentId: segment.id, lastActionId: segment.lastActionId });

  it('waits for both seats at every manual step and rejects stale segment or action IDs', async () => {
    const fixture = await setup({ playbackWaitMs: 15000 }), a = await fixture.connect(), b = await fixture.connect();
    let view: RoomView;
    a.on('room:update', update => { view = update; });
    const entry = await ok<Entry>(a, 'room:create', { nickname: '甲' });
    await ok(b, 'room:join', { nickname: '乙', code: entry.room.code });
    await ok(a, 'room:ready', { ready: true }); await ok(b, 'room:ready', { ready: true }); await ok(a, 'game:start');
    await ok(a, 'game:whisper', { act: 1, channel: 'private', text: '' });
    await ok(b, 'game:whisper', { act: 1, channel: 'private', text: '' });
    const first = await waitGate(() => view, segment => segment.lastActionId === null);
    expect(view!.phase).toBe('exchange'); expect(view!.deadline).toBeNull();
    expect(first.expiresAt! - Date.now()).toBeLessThanOrEqual(15000);
    expect(await ok(a, 'game:playback-complete', { segmentId: first.id, lastActionId: 'wrong-action' })).toEqual({ accepted: false });
    await ok(a, 'game:playback-complete', { segmentId: first.id, lastActionId: null });
    expect(view!.phase).toBe('exchange'); expect(view!.playback?.waiting).toBe(true);
    await ok(b, 'game:playback-complete', { segmentId: first.id, lastActionId: null });
    let previous: string | null = null;
    for (let index = 0; index < 3; index++) {
      const gate = await waitGate(() => view, segment => segment.lastActionId !== previous);
      await confirm(a, gate); await confirm(b, gate);
      previous = gate.lastActionId;
    }
    await until(() => view!.phase === 'public');
    expect(view!.deadline! - Date.now()).toBeGreaterThan(9500);
    await ok(a, 'game:whisper', { act: 1, channel: 'public', text: '' }); await ok(b, 'game:whisper', { act: 1, channel: 'public', text: '' });
    const next = await waitGate(() => view, segment => segment.id !== first.id && segment.lastActionId === null);
    expect(await ok(a, 'game:playback-complete', { segmentId: first.id, lastActionId: null })).toEqual({ accepted: false });
    expect(view!.phase).toBe('response'); expect(view!.deadline).toBeNull();
    await confirm(a, next); await confirm(b, next);
    previous = null;
    for (let index = 0; index < 1; index++) {
      const gate = await waitGate(() => view, segment => segment.lastActionId !== previous);
      await confirm(a, gate); await confirm(b, gate);
      previous = gate.lastActionId;
    }
    await until(() => view!.act === 2 && view!.phase === 'whisper');
    expect(view!.deadline! - Date.now()).toBeGreaterThan(9500);
  });
  it('keeps every manual gate open until the player confirms, without a timed fallback', async () => {
    const fixture = await setup({ playbackWaitMs: undefined }), a = await fixture.connect(); let view: RoomView;
    a.on('room:update', update => { view = update; });
    await ok(a, 'room:create', { nickname: '甲', practice: true });
    await ok(a, 'game:whisper', { act: 1, channel: 'private', text: '' });
    const start = await waitGate(() => view, segment => segment.lastActionId === null);
    expect(start.expiresAt).toBeNull();
    await confirm(a, start);
    const first = await waitGate(() => view, segment => segment.lastActionId !== null);
    expect(first.expiresAt).toBeNull();
    const action = first.lastActionId;
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(view!.playback?.waiting).toBe(true);
    expect(view!.playback?.lastActionId).toBe(action);
    await confirm(a, first);
    let previous = action;
    for (let index = 1; index < 3; index++) {
      const gate = await waitGate(() => view, segment => segment.lastActionId !== previous);
      expect(gate.expiresAt).toBeNull();
      await confirm(a, gate);
      previous = gate.lastActionId;
    }
    await until(() => view!.phase === 'public');
  });
  it('uses the bounded fallback for a disconnected client and resumes without an expired gate', async () => {
    const fixture = await setup({ playbackWaitMs: 80 }), a = await fixture.connect(); let view: RoomView;
    a.on('room:update', update => { view = update; });
    const entry = await ok<Entry>(a, 'room:create', { nickname: '甲', practice: true });
    await ok(a, 'game:whisper', { act: 1, channel: 'private', text: '' });
    await until(() => !!view?.playback?.waiting);
    const room = fixture.court.rooms.get(entry.room.code)!;
    expect(room.playback?.completed.has('b')).toBe(true);
    a.disconnect();
    await until(() => room.phase === 'public');
    const reconnect = await fixture.connect();
    const recovered = await ok<Entry>(reconnect, 'session:resume', entry.session);
    expect(recovered.room.playback?.waiting).toBe(false);
    expect(recovered.room.deadline).toBeGreaterThan(Date.now());
  });
  it('lets a headless practice opponent continue as soon as the human confirms each step', async () => {
    const fixture = await setup({ playbackWaitMs: 15000 }), a = await fixture.connect(); let view: RoomView;
    a.on('room:update', update => { view = update; });
    await ok(a, 'room:create', { nickname: '甲', practice: true });
    await ok(a, 'game:whisper', { act: 1, channel: 'private', text: '' });
    const start = await waitGate(() => view, segment => segment.lastActionId === null);
    await confirm(a, start);
    let previous: string | null = null;
    for (let index = 0; index < 3; index++) {
      const gate = await waitGate(() => view, segment => segment.lastActionId !== previous);
      await confirm(a, gate);
      previous = gate.lastActionId;
    }
    await until(() => view!.phase === 'public');
  });
  it('gates all six segments, including the final result and secret reveal', async () => {
    const fixture = await setup({ playbackWaitMs: 15000 }), a = await fixture.connect(); let view: RoomView;
    a.on('room:update', update => { view = update; });
    await ok(a, 'room:create', { nickname: '甲', practice: true });
    const passGates = async (done: () => boolean) => {
      for (let index = 0; index < 8 && !done(); index++) {
        const gate = await waitGate(() => view);
        expect(view!.deadline).toBeNull(); expect(view!.outcome).toBeNull();
        await confirm(a, gate);
        await until(() => done() || !view!.playback?.waiting || view!.playback.lastActionId !== gate.lastActionId);
      }
    };
    for (const act of [1, 2, 3]) {
      await ok(a, 'game:whisper', { act, channel: 'private', text: '' });
      await passGates(() => view!.phase !== 'exchange');
      await until(() => view!.phase === 'public');
      await ok(a, 'game:whisper', { act, channel: 'public', text: '' });
      await passGates(() => act === 3 ? view!.status === 'finished' : view!.act === act + 1 && view!.phase === 'whisper');
      await until(() => act === 3 ? view!.status === 'finished' : view!.act === act + 1 && view!.phase === 'whisper');
    }
    expect(view!.playback!.id).toBe(6); expect(view!.outcome!.secrets.b).toBeTruthy();
  });
});
