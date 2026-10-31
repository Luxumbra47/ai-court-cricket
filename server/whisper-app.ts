import express from 'express';
import { createServer } from 'node:http';
import { TLSSocket } from 'node:tls';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { Ack, AgentConfig, Channel, Entry, Phase, RoomView, Side } from '../shared/whisper.js';
import { AGENT_NAMES, countCharacters, other } from '../shared/whisper.js';
import { PROVIDER_PRESETS } from '../shared/providers.js';
import { AgentService } from './agents.js';
import { addEvent, applyMove, createGame, finishGame, receiveWhisper, type GameState } from './engine.js';
import { resolveConfig } from './provider.js';
import { publicScenario, objectiveView, rollScenario, SCENARIOS, type ScenarioDefinition } from './scenarios.js';
import { WindowsSpeechService, type TtsService } from './tts.js';

interface Player {
  side: Side; token: string; nickname: string; socketId: string | null; bot: boolean; ready: boolean;
  config: AgentConfig; usage: RoomView['usage'];
}
export interface Room {
  code: string; host: Side; practice: boolean; scenario: ScenarioDefinition; status: RoomView['status'];
  players: Player[]; game: GameState | null; phase: Phase; deadline: number | null; timer?: ReturnType<typeof setTimeout>;
  submitted: Record<Side, Record<Channel, boolean>>; thinking: Side | null; running: boolean; abort: AbortController;
  notice: string | null; touched: number;
  playback: { id: number; act: number; lastActionId: string | null; waiting: boolean; expiresAt: number | null; completed: Set<Side>; release?: () => void } | null;
}
export interface ServerOptions { agents?: AgentService; whisperMs?: number; publicMs?: number; moveDelayMs?: number; roomTtlMs?: number; playbackWaitMs?: number; tts?: TtsService }
const defaultConfig = (): AgentConfig => ({ provider: 'mock', baseUrl: '', apiKey: '', model: 'local-strategy-v1', personality: 'composed' });
const freshSubmissions = () => ({ a: { private: false, public: false }, b: { private: false, public: false } });
const nickname = z.string().trim().min(1, '请输入昵称').max(24, '昵称最多 24 字').regex(/^[^\x00-\x1f\x7f<>]+$/, '昵称包含无效字符');
const sessionSchema = z.object({ code: z.string().regex(/^[A-Z2-9]{6}$/), side: z.enum(['a', 'b']), token: z.string().length(48) }).strict();
const idleUsage = () => ({ calls: 0, fallbacks: 0, inputTokens: 0, outputTokens: 0 });
const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function createCourtServer(options: ServerOptions = {}) {
  const agents = options.agents ?? new AgentService();
  const tts = options.tts ?? new WindowsSpeechService();
  const app = express(); app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Cache-Control', 'no-store'); next(); });
  const http = createServer(app);
  const allowed = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));
  const io = new Server(http, {
    maxHttpBufferSize: 16000,
    allowRequest(req, done) {
      const origin = req.headers.origin;
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
      if (!origin) { done(null, local); return; }
      try { const parsed = new URL(origin); done(null, allowed.has(origin) || parsed.host === req.headers.host || local && ['localhost', '127.0.0.1'].includes(parsed.hostname)); }
      catch { done(null, false); }
    },
  });
  const rooms = new Map<string, Room>();
  const whisperMs = options.whisperMs ?? 30000, publicMs = options.publicMs ?? 15000, moveDelayMs = options.moveDelayMs ?? 850;
  let closing = false;
  const tasks = new Set<Promise<void>>();
  const project = (room: Room, player: Player): RoomView => {
    const game = room.game, own = game?.agents[player.side];
    const { apiKey: _key, ...config } = player.config;
    return {
      code: room.code, host: room.host, you: player.side, practice: room.practice, status: room.status,
      scenario: publicScenario(room.scenario), act: game?.act ?? 0, phase: room.phase, deadline: room.deadline,
      agents: room.players.map(p => ({ side: p.side, name: AGENT_NAMES[p.side], nickname: p.nickname, ready: p.ready, online: p.bot || !!p.socketId, bot: p.bot, configured: true, personality: p.side === player.side || room.status === 'finished' ? p.config.personality : null })),
      own: { side: player.side, trust: own?.trust ?? 75, changes: own?.changes ?? [], reports: own?.reports ?? [], whispers: own?.whispers ?? [], secret: game ? room.scenario.secrets[player.side] : '', goal: player.side === 'a' ? '争取更高成交价，同时确保交易能够完成。' : '争取更低成交价，同时确保取得所需物资。', verificationLeft: own?.verificationLeft ?? 1, config, objective: objectiveView(room.scenario.objectives[player.side]) },
      submitted: { ...room.submitted[player.side] }, peerSubmitted: { ...room.submitted[other(player.side)] },
      events: game?.events ?? [], promises: game?.promises ?? [], thinking: room.thinking,
      offer: game?.offer ?? null, agreement: game?.agreement ?? null, outcome: game?.outcome ?? null, notice: room.notice, usage: { ...player.usage },
      playback: room.playback ? { id: room.playback.id, act: room.playback.act, lastActionId: room.playback.lastActionId, waiting: room.playback.waiting, expiresAt: room.playback.expiresAt, completed: room.playback.completed.has(player.side), peerCompleted: room.playback.completed.has(other(player.side)) } : null,
    };
  };
  const broadcast = (room: Room) => { for (const player of room.players) if (player.socketId) io.to(player.socketId).emit('room:update', project(room, player)); };
  const clearTimer = (room: Room) => { if (room.timer) clearTimeout(room.timer); room.timer = undefined; room.deadline = null; };
  const clearKeys = (room: Room) => { for (const player of room.players) player.config.apiKey = ''; };
  const conclude = (room: Room, strike?: Side) => {
    clearTimer(room); room.thinking = null; room.phase = 'finished'; room.status = 'finished';
    finishGame(room.game!, room.scenario, strike); addEvent(room.game!, { kind: 'system', text: '对局落幕，双方情报与耳语现已揭晓。' });
    clearKeys(room); broadcast(room);
  };
  const track = (promise: Promise<void>) => {
    tasks.add(promise); void promise.finally(() => tasks.delete(promise)).catch(() => {});
  };
  /**
   * Step gate. A round starts and every following action waits for both seats
   * to confirm; clients confirm automatically while the stage is not paused.
   * Bots and disconnected seats are already complete. The server still never
   * advances on its own. `options.playbackWaitMs` is only an explicit test timer.
   */
  const stepGate = async (room: Room, segment: NonNullable<Room['playback']>) => {
    segment.completed = new Set(room.players.filter(p => p.bot || !p.socketId).map(p => p.side));
    segment.waiting = true;
    const wait = options.playbackWaitMs;
    segment.expiresAt = wait === undefined ? null : Date.now() + Math.max(0, wait);
    await new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (timer) clearTimeout(timer);
        room.abort.signal.removeEventListener('abort', done);
        segment.waiting = false; segment.expiresAt = null; segment.release = undefined;
        resolve();
      };
      segment.release = done;
      if (segment.expiresAt !== null) timer = setTimeout(done, Math.max(0, wait!));
      room.abort.signal.addEventListener('abort', done, { once: true });
      broadcast(room);
      if (room.players.every(p => segment.completed.has(p.side)) || room.abort.signal.aborted) done();
    });
  };
  const drive = async (room: Room, responding: boolean) => {
    if (room.running || room.status !== 'playing' || closing) return;
    room.running = true; clearTimer(room); room.phase = responding ? 'response' : 'exchange';
    const game = room.game!, first: Side = game.act % 2 ? 'a' : 'b';
    const segment: NonNullable<Room['playback']> = room.playback = { id: (room.playback?.id ?? 0) + 1, act: game.act, lastActionId: null, waiting: false, expiresAt: null, completed: new Set(room.players.filter(p => p.bot).map(p => p.side)) };
    try {
      // A round never starts until both seats confirm the start gate.
      await stepGate(room, segment);
      if (closing || room.abort.signal.aborted || room.status !== 'playing') return;
      // Three exchanges and one response per act: twelve judged actions in total.
      for (let index = 0; index < (responding ? 1 : 3); index++) {
        if (room.abort.signal.aborted || closing || room.status !== 'playing') return;
        const side = index % 2 === 0 ? first : other(first), player = room.players.find(p => p.side === side)!;
        if (game.agents[side].trust === 0) { conclude(room, side); return; }
        room.thinking = side; broadcast(room);
        if (moveDelayMs) await new Promise<void>(resolve => {
          const done = () => { room.abort.signal.removeEventListener('abort', cancel); resolve(); };
          const timer = setTimeout(done, moveDelayMs);
          const cancel = () => { clearTimeout(timer); done(); };
          room.abort.signal.addEventListener('abort', cancel, { once: true });
        });
        if (room.abort.signal.aborted) return;
        const reply = await agents.decide({ game, scenario: room.scenario, side, config: player.config, responding, signal: room.abort.signal });
        if (room.abort.signal.aborted || room.status !== 'playing') return;
        if (reply.called) player.usage.calls++;
        if (reply.fallback) player.usage.fallbacks++;
        player.usage.inputTokens += reply.inputTokens; player.usage.outputTokens += reply.outputTokens;
        if (reply.notice) room.notice = reply.notice;
        const applied = applyMove(game, room.scenario, side, reply.move, segment.id);
        segment.lastActionId = applied.event.id;
        // Warm the local voice cache while the line is still being played from the queue.
        if (tts.available) void tts.synthesize(applied.event.performance?.speech ?? '', side).catch(() => {});
        room.thinking = null; room.touched = Date.now();
        // Every action waits for both seats before the next AI decision.
        await stepGate(room, segment);
        if (closing || room.abort.signal.aborted || room.status !== 'playing') return;
        const struck = (['a', 'b'] as const).find(s => game.agents[s].trust === 0);
        if (struck) { conclude(room, struck); return; }
      }
      if (closing || room.abort.signal.aborted || room.status !== 'playing') return;
      if (responding) {
        if (game.act >= 3) conclude(room);
        else {
          game.act++; room.submitted = freshSubmissions();
          addEvent(game, { kind: 'system', text: `第${['一', '二', '三'][game.act - 1]}幕开始。` });
          openInput(room, 'whisper');
        }
      } else openInput(room, 'public');
    } catch {
      if (room.status === 'playing' && !room.abort.signal.aborted) {
        room.status = 'cancelled'; room.phase = 'cancelled'; room.notice = '本局执行中断，未生成胜负结果。请返回入口重新开始。';
        clearKeys(room); broadcast(room);
      }
    } finally { room.running = false; }
  };
  const advance = (room: Room, phase: 'whisper' | 'public') => {
    if (room.phase !== phase || room.status !== 'playing' || room.running) return;
    clearTimer(room); track(drive(room, phase === 'public'));
  };
  function openInput(room: Room, phase: 'whisper' | 'public') {
    clearTimer(room); room.phase = phase; room.thinking = null;
    const channel = phase === 'whisper' ? 'private' : 'public';
    for (const player of room.players.filter(p => p.bot)) room.submitted[player.side][channel] = true;
    room.deadline = Date.now() + (phase === 'whisper' ? whisperMs : publicMs);
    room.timer = setTimeout(() => advance(room, phase), phase === 'whisper' ? whisperMs : publicMs); room.timer.unref();
    broadcast(room);
  }
  const start = (room: Room) => {
    if (room.status !== 'waiting' || room.players.length !== 2 || !room.players.every(p => p.ready && (p.bot || p.socketId))) throw new Error('双方在线并准备后才能开始。');
    const seed = Date.now();
    room.scenario = rollScenario(room.scenario, seed);
    room.game = createGame(room.scenario, { a: room.players[0].config.personality, b: room.players[1].config.personality }, seed);
    room.status = 'playing'; room.submitted = freshSubmissions();
    addEvent(room.game, { kind: 'system', text: '第一幕开始。你可以递出一句耳语，也可以让代理人自行判断。' }); openInput(room, 'whisper');
  };
  app.get('/api/health', (_req, res) => res.json({ ok: true, game: 'whisper-agents', version: '1.0.0', storage: 'memory' }));
  app.get('/api/catalog', (_req, res) => res.json({ scenarios: SCENARIOS.map(publicScenario), providers: PROVIDER_PRESETS }));
  const speechRoom = (req: express.Request) => {
    const code = typeof req.query.code === 'string' ? req.query.code.toUpperCase() : '';
    return code ? rooms.get(code) : undefined;
  };
  app.get('/api/tts/status', async (req, res) => {
    if (!speechRoom(req)) { res.status(403).json({ available: false, voice: null, reason: '语音请求未关联当前对局。' }); return; }
    try { res.json(await tts.status()); }
    catch { res.status(503).json({ available: false, voice: null, reason: '语音合成不可用。' }); }
  });
  app.get('/api/tts', async (req, res) => {
    const text = typeof req.query.text === 'string' ? req.query.text.trim() : '';
    const side = req.query.side === 'b' ? 'b' : 'a';
    if (!speechRoom(req)) { res.status(403).json({ error: '语音请求未关联当前对局。' }); return; }
    if (!text || text.length > 500) { res.status(400).json({ error: '语音文本无效。' }); return; }
    const state = await tts.status().catch(() => ({ available: false, voice: null, reason: '语音合成不可用。' }));
    if (!state.available) { res.status(503).json({ error: state.reason, available: false }); return; }
    try {
      const audio = await tts.synthesize(text, side);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', String(audio.length));
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(audio);
    } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : '语音合成失败。' }); }
  });
  io.on('connection', socket => {
    let auth: { code: string; side: Side } | null = null;
    let windowStart = Date.now(), calls = 0, creations = 0;
    const binding = () => {
      const room = auth && rooms.get(auth.code), player = room?.players.find(p => p.side === auth?.side);
      if (!room || !player || player.socketId !== socket.id) throw new Error('会话已失效，请重新加入房间。');
      room.touched = Date.now(); return { room, player };
    };
    const on = (event: string, handler: (input: unknown) => unknown | Promise<unknown>) => socket.on(event, async (input: unknown, ack?: (value: Ack) => void) => {
      if (typeof ack !== 'function') return;
      if (Date.now() - windowStart > 60000) { windowStart = Date.now(); calls = 0; creations = 0; }
      if (++calls > 100) { ack({ ok: false, error: '操作过于频繁，请稍后再试。' }); return; }
      try { ack({ ok: true, data: await handler(input ?? {}) }); }
      catch (error) { ack({ ok: false, error: error instanceof z.ZodError ? error.issues[0]?.message || '输入无效。' : error instanceof Error ? error.message : '操作未完成，请重试。' }); }
    });
    const enter = (room: Room, player: Player): Entry => {
      const previous = player.socketId;
      player.socketId = socket.id; auth = { code: room.code, side: player.side };
      if (previous && previous !== socket.id) io.sockets.sockets.get(previous)?.disconnect(true);
      broadcast(room); return { session: { code: room.code, side: player.side, token: player.token }, room: project(room, player) };
    };
    on('room:create', input => {
      if (++creations > 5 || rooms.size >= 200) throw new Error('创建房间过于频繁，请稍后再试。');
      const parsed = z.object({ nickname, scenarioId: z.string().max(40).default('last-battery'), practice: z.boolean().default(false) }).strict().parse(input);
      if (auth) throw new Error('请先离开当前房间。');
      const scenario = SCENARIOS.find(s => s.id === parsed.scenarioId); if (!scenario) throw new Error('这个议题暂不可用。');
      let code: string; do { code = Array.from(randomBytes(6), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''); } while (rooms.has(code));
      const player: Player = { side: 'a', token: randomBytes(24).toString('hex'), nickname: parsed.nickname, socketId: socket.id, bot: false, ready: false, config: defaultConfig(), usage: idleUsage() };
      const room: Room = { code, host: 'a', practice: parsed.practice, scenario, status: 'waiting', players: [player], game: null, phase: 'whisper', deadline: null, submitted: freshSubmissions(), thinking: null, running: false, abort: new AbortController(), notice: null, touched: Date.now(), playback: null };
      if (parsed.practice) { room.players.push({ side: 'b', token: '', nickname: '本地陪练', socketId: null, bot: true, ready: true, config: { ...defaultConfig(), personality: 'enigmatic' }, usage: idleUsage() }); player.ready = true; }
      rooms.set(code, room); const entry = enter(room, player);
      if (parsed.practice) { start(room); entry.room = project(room, player); }
      return entry;
    });
    on('room:join', input => {
      const parsed = z.object({ nickname, code: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/, '请输入六位房间码。') }).strict().parse(input);
      if (auth) throw new Error('请先离开当前房间。');
      const room = rooms.get(parsed.code); if (!room || room.status !== 'waiting' || room.practice) throw new Error('房间不存在或已开始。');
      if (room.players.length >= 2) throw new Error('双方席位已满。');
      const player: Player = { side: 'b', token: randomBytes(24).toString('hex'), nickname: parsed.nickname, socketId: null, bot: false, ready: false, config: defaultConfig(), usage: idleUsage() };
      room.players.push(player); return enter(room, player);
    });
    on('session:resume', input => {
      const session = sessionSchema.parse(input), room = rooms.get(session.code), player = room?.players.find(p => p.side === session.side);
      if (!room || !player || !safeEqual(player.token, session.token)) throw new Error('房间会话已过期，请重新进入。');
      return enter(room, player);
    });
    on('ai:configure', input => {
      const { room, player } = binding(); if (room.status !== 'waiting') throw new Error('对局开始后配置已锁定。');
      const candidate = input as Record<string, unknown>;
      const trustedProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.request.socket.remoteAddress || '');
      const secure = socket.request.socket instanceof TLSSocket || (process.env.TRUST_PROXY === 'true' && trustedProxy && socket.request.headers['x-forwarded-proto'] === 'https');
      if (candidate?.provider !== 'mock' && !secure) throw new Error('真实模型密钥仅能通过 HTTPS 提交。请使用 HTTPS 启动方式，或先使用免费代理。');
      player.config = resolveConfig(input, player.config); player.ready = false; broadcast(room); return project(room, player).own.config;
    });
    on('room:ready', input => {
      const { room, player } = binding(); if (room.status !== 'waiting') throw new Error('对局已经开始。');
      player.ready = z.object({ ready: z.boolean() }).strict().parse(input).ready; broadcast(room);
    });
    on('room:scenario', input => {
      const { room, player } = binding(); if (room.status !== 'waiting' || player.side !== room.host) throw new Error('只有房主能在开始前更换议题。');
      const { id } = z.object({ id: z.string() }).strict().parse(input), scenario = SCENARIOS.find(s => s.id === id);
      if (!scenario) throw new Error('议题不存在。'); room.scenario = scenario;
      room.players.forEach(p => { p.ready = p.bot; }); broadcast(room);
    });
    on('game:start', () => { const { room, player } = binding(); if (room.host !== player.side) throw new Error('等待房主开始对局。'); start(room); });
    on('game:playback-complete', input => {
      const { room, player } = binding();
      const parsed = z.object({ segmentId: z.number().int().positive(), lastActionId: z.string().max(80).nullable() }).strict().parse(input);
      const segment = room.playback;
      if (!segment?.waiting || segment.id !== parsed.segmentId || segment.lastActionId !== parsed.lastActionId) return { accepted: false };
      segment.completed.add(player.side);
      if (room.players.every(p => segment.completed.has(p.side))) segment.release?.();
      broadcast(room); return { accepted: true };
    });
    on('game:whisper', input => {
      const { room, player } = binding();
      const parsed = z.object({
        act: z.number().int().min(1).max(3), channel: z.enum(['private', 'public']), text: z.string().trim().max(120),
        stance: z.enum(['hold', 'probe', 'press', 'close']).optional(), publicCard: z.enum(['promise', 'pressure', 'statement']).optional(),
      }).strict().parse(input);
      if (room.status !== 'playing' || !room.game || room.game.act !== parsed.act) throw new Error('回合已经变化，请查看最新进展。');
      if (room.phase !== (parsed.channel === 'private' ? 'whisper' : 'public')) throw new Error('当前不是这个耳语的开放阶段。');
      if (parsed.channel === 'private' ? !!parsed.publicCard : !!parsed.stance) throw new Error('耳语卡与当前可见范围不匹配。');
      if (countCharacters(parsed.text) > (parsed.channel === 'private' ? 15 : 10) || /[\x00-\x1f\x7f<>]/.test(parsed.text)) throw new Error('耳语超出字数限制或包含无效字符。');
      if (room.submitted[player.side][parsed.channel]) return { delivered: true, act: parsed.act };
      if (parsed.text || parsed.stance || parsed.publicCard) receiveWhisper(room.game, player.side, parsed.text, parsed.channel, { stance: parsed.stance, publicCard: parsed.publicCard });
      room.submitted[player.side][parsed.channel] = true; broadcast(room);
      if (room.game.agents[player.side].trust === 0) conclude(room, player.side);
      else if ((['a', 'b'] as const).every(s => room.submitted[s][parsed.channel])) advance(room, room.phase as 'whisper' | 'public');
      return { delivered: true, act: parsed.act };
    });
    on('room:leave', () => {
      const { room, player } = binding(); clearTimer(room); room.abort.abort();
      if (room.status === 'playing' || room.status === 'waiting') { room.status = 'cancelled'; room.phase = 'cancelled'; room.notice = '一方已离开，本局中止，不产生胜负结果。'; }
      player.socketId = null; clearKeys(room); broadcast(room); auth = null;
    });
    socket.on('disconnect', () => {
      if (!auth) return;
      const room = rooms.get(auth.code), player = room?.players.find(p => p.side === auth?.side);
      if (!room || player?.socketId !== socket.id) return;
      player.socketId = null;
      // A lost seat must not hold the other player at the playback gate for a full spoken segment.
      const segment = room.playback;
      if (segment?.waiting && !segment.completed.has(player.side)) {
        segment.completed.add(player.side);
        if (room.players.every(p => p.bot || segment.completed.has(p.side))) segment.release?.();
      }
      broadcast(room);
    });
  });
  const cleanup = setInterval(() => {
    for (const [code, room] of rooms) if (Date.now() - room.touched > (options.roomTtlMs ?? 4 * 60 * 60 * 1000)) { clearTimer(room); room.abort.abort(); clearKeys(room); rooms.delete(code); }
  }, 60000); cleanup.unref();
  return { app, http, io, rooms, project, tts, async close() {
    closing = true; clearInterval(cleanup);
    for (const room of rooms.values()) { clearTimer(room); room.abort.abort(); clearKeys(room); }
    await Promise.allSettled([...tasks]); await new Promise<void>(resolve => io.close(() => resolve()));
  } };
}
