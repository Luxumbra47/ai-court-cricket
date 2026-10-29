import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { CASES, getCase, publicCase, IDENTITY_CATALOG, ITEM_CATALOG } from './cases.js';
import { createGame, prepareAction, finalizeAction, getActionOptions, turnIdFor, commandSchema, actionSchema, createScriptedSpeech, readableSpeech, matchesInstruction, getPublicEvidence, getVisibleEvidence, type PreparedAction } from './game.js';
import { LlmService, createLedger, resolveConfig } from './llm.js';
import { Store } from './store.js';
import { playerText, presentEvent } from '../shared/presentation.js';
import { buildPreview, comparisonText, draftCommand, previewSignature, projectOptions } from './preview.js';
import { CASES_V3, deepFreeze, instantiateCase, publicCaseV3, selectCase } from './cases-v3.js';
import { skipExhausted } from './game-v3.js';
import { caseGuide } from './guide.js';
import type { AiConfig, PublicConfig, Side, RoomView, EngineState, Usage, Session, Evidence, EvidenceView, Ack, CallRecord, Loadout, ActionReceipt, CaseTemplate, MatchMode, Difficulty } from '../shared/types.js';

interface Player {
  recentCaseIds?: string[];
  id: string; token: string; nickname: string; side: Side; socketId: string | null;
  ready: boolean; config: AiConfig | null; loadout: Loadout; usage: Usage;
}
interface Room {
  difficulty: Difficulty; selection: 'auto' | 'manual'; rulesVersion: 2 | 3;
  mode: MatchMode;
  id: string; code: string; hostId: string; status: RoomView['status']; caseId: string;
  players: Player[]; game: EngineState | null; matchId: string | null;
  thinking: Side | null; notice: string | null; touched: number; execution: NonNullable<RoomView['game']>['execution'];
  receipts: Map<string, { playerId: string; fingerprint: string; receipt: ActionReceipt }>; pending: { player: Player; prepared: PreparedAction; receipt: ActionReceipt } | null;
  ledger: ReturnType<typeof createLedger>; abort: AbortController;
  persistence: Promise<void>;
  lockedCase?: CaseTemplate;
}
export interface ServerOptions {
  rulesVersion?: 2 | 3;
  store?: Store; llm?: LlmService; roomTtlMs?: number; preferenceTtlMs?: number;
  origins?: string[]; trustProxy?: boolean; maxRooms?: number;
}
const blankUsage = (): Usage => ({ calls: 0, retries: 0, failures: 0, fallback: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
const defaultLoadout = (): Loadout => ({ identity: 'civilian', items: ['magnifier', 'coffee', 'firewall'] });
const loadoutSchema = z.object({
  identity: z.enum(['civilian', 'tycoon', 'scientist']),
  items: z.array(z.enum(['magnifier', 'coffee', 'archive', 'interrogate', 'firewall', 'extension'])).max(3)
    .refine(items => new Set(items).size === items.length, '每种道具只能选择一次'),
}).strict();
const ownAiSettings = (config: AiConfig): NonNullable<RoomView['ownAiSettings']> => ({
  provider: config.provider, baseUrl: config.baseUrl, model: config.model,
  personality: config.personality, strategy: config.strategy,
  ...(config.inputPricePerMillion !== undefined ? { inputPricePerMillion: config.inputPricePerMillion } : {}),
  ...(config.outputPricePerMillion !== undefined ? { outputPricePerMillion: config.outputPricePerMillion } : {}),
});
export function publicConfig(config: AiConfig): PublicConfig {
  return { provider: config.provider, model: config.model, personality: config.personality,
    strategy: config.strategy, identity: config.identity, items: [...config.items] };
}
const safeEvidence = (e: Evidence, game: EngineState | null, targetable: boolean): EvidenceView => ({
  id: e.id, title: e.title, description: e.description, explanation: e.explanation, supports: e.supports, limitations: e.limitations, details: e.details, technical: e.technical,
  state: { disclosure: !game || game.publicEvidenceIds.includes(e.id) ? 'public' : 'private',
    submitted: game?.presented.includes(e.id) ?? false,
    challenged: game?.challenged.some(k => k.endsWith(':' + e.id)) ?? false,
    reviewed: game?.reviewed.some(k => k.endsWith(':' + e.id)) ?? false, targetable },
});
const nicknameSchema = z.string().trim().min(1, '请输入昵称').max(24, '昵称最多 24 字').regex(/^[^\x00-\x1f\x7f<>]+$/, '昵称含有不允许的字符');
const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/, '请输入六位房间码');
const modeSchema = z.enum(['casual', 'standard', 'hardcore']);
const difficultySchema = z.enum(['beginner', 'standard', 'complex']);
const historySchema = z.array(z.string().max(40)).max(3).default([]);
const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const localAddress = (value: string | undefined) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value || '');
export async function createCourtServer(options: ServerOptions = {}) {
  const rulesVersion = options.rulesVersion ?? 3, catalogCases = rulesVersion === 3 ? CASES_V3 : CASES;
  const findCase = (id: string) => { const t = catalogCases.find(t => t.id === id); if (!t) throw new Error('案件不存在'); return t; };
  const store = options.store ?? new Store(process.env.STORAGE_MODE === 'mysql' ? 'mysql' : 'memory');
  const llm = options.llm ?? new LlmService();
  await store.initialize(catalogCases);
  const app = express();
  app.disable('x-powered-by');
  const http = createServer(app);
  const trustProxy = options.trustProxy ?? (process.env.TRUST_PROXY === 'true' || process.env.LOCAL_TLS === 'true');
  const origins = options.origins ?? (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001').split(',').map(s => s.trim()).filter(Boolean);
  const io = new Server(http, {
    maxHttpBufferSize: 16_384,
    cors: { origin: origins, methods: ['GET', 'POST'], credentials: false },
    allowRequest: (req, callback) => callback(null, !req.headers.origin || origins.includes(req.headers.origin))
  });
  const rooms = new Map<string, Room>();
  const previewSecret = randomBytes(32).toString('hex');
  // Per-tab bearer credentials stay in sessionStorage; API keys stay only in this bounded memory cache.
  const preferences = new Map<string, { config: AiConfig | null; loadout: Loadout; touched: number; variants?: Record<string, 'route-a' | 'route-b'> }>();
  const preferenceTtl = options.preferenceTtlMs ?? 12 * 60 * 60 * 1000;
  const rates = new Map<string, { count: number; reset: number }>();
  const ttl = options.roomTtlMs ?? Math.max(60_000, Number(process.env.ROOM_TTL_MINUTES || 30) * 60_000);
  const limit = (key: string, max: number, windowMs = 60_000) => {
    const now = Date.now(); let row = rates.get(key);
    if (!row || row.reset < now) { row = { count: 0, reset: now + windowMs }; rates.set(key, row); }
    if (++row.count > max) throw new Error('操作过于频繁，请稍后再试');
  };
  const session = (room: Room, player: Player): Session => ({ playerId: player.id, token: player.token, roomCode: room.code });
  const templateFor = (room: Room) => room.lockedCase ?? findCase(room.caseId);
  const validBinding = (room: Room) => !room.game || !!room.lockedCase && room.caseId === room.lockedCase.id &&
    room.game.caseId === room.lockedCase.id && room.game.caseVersion === room.lockedCase.version && room.mode === room.lockedCase.matchMode &&
    (room.rulesVersion === 2 || room.difficulty === room.lockedCase.difficulty && room.game.rulesVersion === room.lockedCase.engineVersion);
  const view = (room: Room, you: Player): RoomView => {
    if (!validBinding(room) && room.status === 'playing') void cancel(room, '案件版本校验不一致，本局已中止，不产生判决。请返回大厅新建房间。');
    const template = templateFor(room);
    const publicEvidence = room.game ? getPublicEvidence(template, room.game) : template.evidence.filter(e => e.visibility === 'public');
    const publicIds = new Set(publicEvidence.map(e => e.id));
    const actionOptions = room.status === 'playing' && room.game?.turn === you.side && room.execution === 'awaiting_action' ? getActionOptions(template, room.game, you.side) : [];
    const project = (e: Evidence) => safeEvidence(e, room.game, actionOptions.some(o => o.enabled && o.evidenceIds.includes(e.id)));
    return {
      mode: room.mode, difficulty: room.difficulty, selection: room.selection, recentCaseIds: you.recentCaseIds ?? [],
      guide: room.game?.rulesVersion === 3 ? caseGuide(template, room.game, you.side, room.mode, actionOptions) : null,
      code: room.code, status: room.status, hostId: room.hostId, you: you.id,
      players: room.players.map(p => ({
        id: p.id, nickname: p.nickname, side: p.side, connected: !!p.socketId,
        ready: p.ready, configured: !!p.config && (p.config.provider === 'mock' || !!p.config.apiKey),
        config: p.config ? publicConfig(p.config) : null,
        loadout: { identity: p.loadout.identity, items: [...p.loadout.items] }, usage: { ...p.usage },
        state: room.game ? { ...room.game.players[p.side],
          knownEvidenceIds: p.id === you.id ? [...room.game.players[p.side].knownEvidenceIds] : [],
          items: [...room.game.players[p.side].items], usedItems: [...room.game.players[p.side].usedItems] } : null
      })),
      ownAiSettings: you.config ? ownAiSettings(you.config) : null,
      case: room.rulesVersion === 3 ? publicCaseV3(template) : publicCase(template), publicEvidence: publicEvidence.map(project),
      privateEvidence: room.game ? getVisibleEvidence(template, room.game, you.side).filter(e => !publicIds.has(e.id)).map(project) : [],
      events: room.game ? room.game.events.map(presentEvent) : [],
      game: room.game ? { score: room.game.score, round: room.game.round, turn: room.game.turn, phase: room.game.phase, verdict: room.game.verdict, turnId: turnIdFor(room.matchId!, room.game), execution: room.execution,
        rulesVersion: room.game.rulesVersion, stage: room.game.stage, opportunities: room.game.opportunities, totalOpportunities: room.rulesVersion === 3 ? 12 : 8, completedActions: room.game.completedActions, skippedOpportunities: room.game.skippedOpportunities, variantId: room.lockedCase?.variant?.id } : null,
      actionOptions: projectOptions(actionOptions, room.mode, room.rulesVersion),
      ownAction: [...room.receipts.values()].reverse().find(r => r.playerId === you.id)?.receipt ?? null,
      thinking: room.thinking, persistence: store.mode, notice: room.notice
    };
  };
  const broadcast = (room: Room) => {
    for (const p of room.players) if (p.socketId) io.to(p.socketId).emit('room:update', view(room, p));
  };
  const persist = (room: Room, work: () => Promise<void>) => {
    const pending = room.persistence.catch(() => {}).then(work);
    room.persistence = pending;
    return pending;
  };
  const clearKeys = (room: Room) => { for (const p of room.players) if (p.config) p.config.apiKey = ''; };
  const cancel = async (room: Room, notice: string) => {
    if (room.status === 'finished' || room.status === 'cancelled') return;
    room.status = 'cancelled'; room.execution = 'aborted'; if (room.pending) room.pending.receipt.status = 'aborted'; room.notice = notice; room.thinking = null;
    if (room.game) {
      room.game.verdict = null;
      room.game.events = room.game.events.filter(e => e.kind !== 'verdict');
    }
    room.abort.abort(); clearKeys(room);
    try { await persist(room, () => store.endRoom(room.id, room.matchId, null)); } catch { room.notice += '；数据库写入失败，本局不产生判决。'; }
    broadcast(room);
  };
  const canAct = (room: Room) => room.status === 'playing' && room.players.every(p => p.socketId && p.config && (p.config.provider === 'mock' || p.config.apiKey));
  const scrub = (room: Room, value: string) => {
    let text = value;
    for (const p of room.players) if (p.config?.apiKey) text = text.split(p.config.apiKey).join('[密钥已隐藏]');
    return text;
  };
  const addUsage = (p: Player, records: CallRecord[], fallback: boolean) => {
    const actual = records.filter(c => c.attempt > 0);
    p.usage.calls += actual.length;
    p.usage.retries += actual.filter(c => c.attempt === 2).length;
    p.usage.failures += actual.filter(c => c.status !== 'ok').length;
    p.usage.fallback += Number(fallback);
    for (const c of records) {
      p.usage.inputTokens += c.inputTokens; p.usage.outputTokens += c.outputTokens;
      if (c.estimatedCost === null) p.usage.estimatedCost = null;
      else if (p.usage.estimatedCost !== null) p.usage.estimatedCost += c.estimatedCost;
    }
  };
  const executeAction = async (room: Room) => {
    const pending = room.pending;
    if (!pending || !room.game) return;
    if (!validBinding(room)) { await cancel(room, '案件版本校验不一致，本局已中止，不产生判决。'); return; }
    const { player, prepared, receipt } = pending;
    const before = room.game, callConfig = { ...player.config! };
    const activeSecrets = room.players.map(p => p.config?.apiKey).filter((s): s is string => !!s);
    try {
      let limited = false; try { limit('model:' + player.id, 8); } catch { limited = true; }
      const result = limited ? { action: createScriptedSpeech(prepared.action, callConfig, before.players[player.side].stability), records: [] as CallRecord[], fallback: true, reason: '请求频率已达上限' } :
        await llm.completeAction({ template: templateFor(room), state: structuredClone(before), side: player.side, config: callConfig,
          ledger: room.ledger, command: structuredClone(prepared.command), action: structuredClone(prepared.action), resolution: prepared.event.reason!, signal: room.abort.signal });
      if (room.status !== 'playing' || room.pending !== pending) return;
      if (!validBinding(room)) { await cancel(room, '案件版本校验不一致，本局已中止，不产生判决。'); return; }
      const parsed = actionSchema.safeParse(result.action);
      if (!parsed.success || !matchesInstruction(parsed.data, prepared.action)) {
        result.action = createScriptedSpeech(prepared.action, callConfig, before.players[player.side].stability);
        result.fallback = true; result.reason = '模型未遵循已锁定的玩家指令';
      }
      const speech = readableSpeech(result.action.speech, templateFor(room), before, prepared.command.evidenceIds);
      if (!speech) result.fallback = true;
      result.action.speech = speech ?? createScriptedSpeech(prepared.action, callConfig, before.players[player.side].stability).speech;
      result.action.speech = scrub(room, result.action.speech);
      for (const secret of activeSecrets) {
        result.action.speech = result.action.speech.split(secret).join('[密钥已隐藏]');
        result.action.tone = result.action.tone.split(secret).join('neutral');
      }
      const next = finalizeAction(prepared, result.action);
      room.execution = 'resolving'; receipt.status = 'resolving'; broadcast(room);
      await persist(room, () => store.append(room.matchId!, next.events.slice(before.events.length), result.records));
      if (room.status !== 'playing' || room.pending !== pending) return;
      if (next.phase === 'finished') {
        await persist(room, () => store.endRoom(room.id, room.matchId, next.verdict));
        if (room.status !== 'playing' || room.pending !== pending) return;
      }
      room.game = next; addUsage(player, result.records, result.fallback);
      receipt.status = 'settled'; receipt.eventId = prepared.event.id; room.pending = null;
      room.thinking = null; room.touched = Date.now();
      room.notice = result.fallback ? '模型暂时无法回应，律师已使用备用发言，本次行动照常结算。' : null;
      if (next.phase === 'finished') { room.status = 'finished'; room.execution = 'finished'; clearKeys(room); }
      else { room.execution = 'awaiting_action'; if (!canAct(room)) room.notice = '等待双方重连并恢复模型密钥；不会自动出招。'; }
      broadcast(room);
    } catch { await cancel(room, '行动无法安全保存，本局已中止，不产生判决。请新建房间。'); }
    finally { callConfig.apiKey = ''; }
  };
  const requirePlayer = (socket: Socket): { room: Room; player: Player } => {
    const code = socket.data.roomCode as string | undefined;
    const room = code ? rooms.get(code) : undefined;
    const player = room?.players.find(p => p.socketId === socket.id);
    if (!room || !player) throw new Error('会话失效，请重新加入房间');
    return { room, player };
  };
  const attach = (socket: Socket, room: Room, p: Player) => { p.socketId = socket.id; socket.data.roomCode = room.code; room.touched = Date.now(); };
  const isSecure = (socket: Socket) => !!(socket.request as unknown as { connection: { encrypted?: boolean } }).connection?.encrypted ||
    (trustProxy && localAddress(socket.conn.remoteAddress) && ['https', 'wss'].includes(String(socket.handshake.headers['x-forwarded-proto'])));
  const forgetPreference = (token: string) => {
    const saved = preferences.get(token);
    if (saved?.config) saved.config.apiKey = '';
    preferences.delete(token);
  };
  const preferenceFor = (socket: Socket) => {
    const token = socket.data.preferenceToken as string | undefined;
    const saved = token ? preferences.get(token) : undefined;
    if (!saved) return null;
    if (Date.now() - saved.touched >= preferenceTtl) { forgetPreference(token!); return null; }
    if (saved.config?.provider !== 'mock' && saved.config?.apiKey && !isSecure(socket)) return null;
    saved.touched = Date.now();
    return saved;
  };
  const rememberPreference = (socket: Socket, player: Player) => {
    let saved = preferenceFor(socket);
    const token = socket.data.preferenceToken as string | undefined;
    if (!saved && token && preferences.size < 1000) {
      saved = { config: null, loadout: defaultLoadout(), touched: Date.now() };
      preferences.set(token, saved);
    }
    if (!saved) return;
    if (saved.config) saved.config.apiKey = '';
    saved.config = player.config ? structuredClone(player.config) : null;
    saved.loadout = structuredClone(player.loadout);
  };
  const restorePreference = (socket: Socket, player: Player) => {
    const saved = preferenceFor(socket);
    if (!saved) return;
    player.loadout = structuredClone(saved.loadout);
    player.config = saved.config ? { ...structuredClone(saved.config), ...structuredClone(saved.loadout) } : null;
  };
  const configFor = (socket: Socket, input: unknown, previous: AiConfig | null = null) => {
    const config = resolveConfig(input, previous ?? undefined);
    if (config.provider !== 'mock' && !isSecure(socket)) throw new Error('真实 API 密钥仅允许通过 HTTPS/WSS 提交。请使用 npm run dev:https 或配置 HTTPS 代理。');
    return config;
  };
  io.on('connection', socket => {
    const handle = <T>(event: string, operation: (data: unknown) => Promise<T> | T) => {
      socket.on(event, async (data: unknown, callback?: (ack: Ack<T>) => void) => {
        if (typeof callback !== 'function') return;
        try {
          limit(`socket:${socket.id}`, 100);
          const result = await operation(data);
          callback({ ok: true, data: result });
        } catch (err) {
          const error = err instanceof z.ZodError ? err.issues[0]?.message || '输入格式不正确' :
            err instanceof Error && !/prisma|sql|database|fetch|ECONN|token|apiKey/i.test(err.message) ? err.message : '操作失败，请检查配置或稍后重试';
          callback({ ok: false, error });
        }
      });
    };
    handle('preferences:resume', input => {
      limit(`preferences:${socket.handshake.address}`, 30);
      const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional() }).strict().parse(input);
      if (socket.data.preferenceToken && token !== socket.data.preferenceToken) throw new Error('配置会话已绑定，请重新连接后再试');
      if (token && !socket.data.preferenceToken) socket.data.preferenceToken = token;
      if (!preferenceFor(socket)) {
        if (preferences.size >= 1000) throw new Error('临时配置过多，请稍后重试');
        const next = randomBytes(32).toString('hex');
        preferences.set(next, { config: null, loadout: defaultLoadout(), touched: Date.now() });
        socket.data.preferenceToken = next;
      }
      return { token: socket.data.preferenceToken as string };
    });
    handle('preferences:forget', () => {
      const token = socket.data.preferenceToken as string | undefined;
      if (token) {
        forgetPreference(token);
        preferences.set(token, { config: null, loadout: defaultLoadout(), touched: Date.now() });
      }
    });
    handle('room:create', async input => {
      limit(`entry:${socket.handshake.address}`, 20);
      if (socket.data.roomCode || socket.data.entryPending) throw new Error('请先完成当前房间操作');
      const data = z.object({ nickname: nicknameSchema, caseId: z.string().max(40).optional(), mode: modeSchema.default(rulesVersion === 3 ? 'casual' : 'standard'), difficulty: difficultySchema.optional(), selection: z.enum(['auto', 'manual']).optional(), recentCaseIds: historySchema }).strict().parse(input);
      const selection = data.selection ?? (data.caseId ? 'manual' : 'auto');
      const difficulty = data.difficulty ?? (data.caseId ? findCase(data.caseId).difficulty : undefined) ?? 'beginner';
      const caseId = selection === 'auto' && rulesVersion === 3 ? selectCase(difficulty, [data.recentCaseIds], randomBytes(4).readUInt32BE()) : data.caseId ?? catalogCases[0].id;
      const selectedCase = findCase(caseId);
      if (rulesVersion === 3 && selectedCase.difficulty !== difficulty) throw new Error('所选案件不属于当前难度');
      if (rooms.size >= (options.maxRooms ?? 100)) throw new Error('当前房间过多，请稍后再试');
      let code: string;
      do { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code = Array.from(randomBytes(6), b => chars[b % chars.length]).join(''); } while (rooms.has(code));
      const p: Player = { id: randomUUID(), token: randomBytes(32).toString('hex'), nickname: data.nickname, side: 'defense', socketId: null, ready: false, config: null, loadout: defaultLoadout(), usage: blankUsage() };
      p.recentCaseIds = data.recentCaseIds;
      const room: Room = { rulesVersion, difficulty, selection, mode: data.mode, id: randomUUID(), code, hostId: p.id, caseId, status: 'waiting',
        players: [p], game: null, matchId: null, thinking: null, notice: null, touched: Date.now(), execution: 'awaiting_action', receipts: new Map(), pending: null, ledger: createLedger(), abort: new AbortController(), persistence: Promise.resolve() };
      socket.data.entryPending = true;
      try {
        await store.createRoom(room.id, code);
        if (!socket.connected) { await store.endRoom(room.id, null, null); throw new Error('连接已断开，请重新创建房间'); }
      } finally { socket.data.entryPending = false; }
      restorePreference(socket, p);
      rooms.set(code, room); attach(socket, room, p);
      return { session: session(room, p), room: view(room, p) };
    });
    handle('room:join', input => {
      limit(`entry:${socket.handshake.address}`, 20);
      if (socket.data.roomCode || socket.data.entryPending) throw new Error('请先完成当前房间操作');
      const data = z.object({ nickname: nicknameSchema, code: codeSchema, recentCaseIds: historySchema }).strict().parse(input);
      const room = rooms.get(data.code);
      if (!room) throw new Error('房间不存在或已清理；服务重启后请新建房间');
      if (room.status !== 'waiting') throw new Error('此房间已开始或结束');
      if (room.players.length >= 2) throw new Error('房间已满，无法加入第三位玩家');
      const p: Player = { id: randomUUID(), token: randomBytes(32).toString('hex'), nickname: data.nickname, side: 'prosecution', socketId: null, ready: false, config: null, loadout: defaultLoadout(), usage: blankUsage() };
      restorePreference(socket, p);
      p.recentCaseIds = data.recentCaseIds;
      room.players.push(p);
      if (room.rulesVersion === 3 && room.selection === 'auto' && p.recentCaseIds.includes(room.caseId)) {
        room.caseId = selectCase(room.difficulty, room.players.map(p => p.recentCaseIds ?? []), randomBytes(4).readUInt32BE()); room.players.forEach(p => p.ready = false); room.notice = '已按双方最近案件记录更新自动选案，请核对后准备。';
      }
      attach(socket, room, p); broadcast(room);
      return { session: session(room, p), room: view(room, p) };
    });
    handle('room:resume', input => {
      limit(`entry:${socket.handshake.address}`, 30);
      const data = z.object({ playerId: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/), roomCode: codeSchema }).strict().parse(input);
      const room = rooms.get(data.roomCode);
      const p = room?.players.find(p => p.id === data.playerId);
      if (!room || !p || !sameToken(p.token, data.token)) throw new Error('重连会话失效，房间已清理或服务已重启。请重新创建房间');
      if (socket.data.entryPending || (socket.data.roomCode &&
        (socket.data.roomCode !== room.code || room.players.some(other => other.socketId === socket.id && other.id !== p.id)))) throw new Error('请先离开当前房间');
      if (p.socketId && p.socketId !== socket.id) {
        const old = io.sockets.sockets.get(p.socketId); if (old) { old.data.roomCode = undefined; old.disconnect(true); }
      }
      if (p.config && p.config.provider !== 'mock' && !isSecure(socket)) p.config.apiKey = '';
      const saved = preferenceFor(socket)?.config;
      if (['waiting', 'playing'].includes(room.status) && p.config && !p.config.apiKey && saved?.apiKey &&
        p.config.provider === saved.provider && p.config.baseUrl === saved.baseUrl) p.config.apiKey = saved.apiKey;
      attach(socket, room, p); if (canAct(room)) room.notice = null; broadcast(room);
      return { session: session(room, p), room: view(room, p) };
    });
    handle('room:leave', async () => {
      const code = socket.data.roomCode as string | undefined;
      const room = code ? rooms.get(code) : undefined;
      const player = room?.players.find(p => p.socketId === socket.id);
      if (!room || !player) { socket.data.roomCode = undefined; return; }
      player.socketId = null; player.token = ''; if (player.config) player.config.apiKey = '';
      socket.data.roomCode = undefined;
      await cancel(room, '一位玩家离开，房间已取消。请创建新房间。');
      if (room.players.every(p => !p.socketId)) { clearKeys(room); rooms.delete(room.code); }
    });
    handle('room:case', input => {
      const { room, player } = requirePlayer(socket);
      if (room.status !== 'waiting' || room.hostId !== player.id) throw new Error('仅房主可在准备阶段选择案件');
      const { caseId } = z.object({ caseId: z.string().max(40) }).strict().parse(input);
      const t = findCase(caseId); room.caseId = caseId; room.selection = 'manual'; if (t.difficulty) room.difficulty = t.difficulty; room.players.forEach(p => p.ready = false); broadcast(room);
    });
    handle('room:difficulty', input => {
      const { room, player } = requirePlayer(socket);
      if (room.status !== 'waiting' || room.hostId !== player.id || room.rulesVersion !== 3) throw new Error('仅房主可在准备阶段更换难度');
      const data = z.object({ difficulty: difficultySchema, selection: z.enum(['auto', 'manual']).default('auto') }).strict().parse(input);
      room.difficulty = data.difficulty; room.selection = data.selection;
      room.caseId = selectCase(room.difficulty, room.players.map(p => p.recentCaseIds ?? []), randomBytes(4).readUInt32BE()); room.players.forEach(p => p.ready = false); room.touched = Date.now(); broadcast(room);
    });
    handle('room:mode', input => {
      const { room, player } = requirePlayer(socket);
      if (room.status !== 'waiting' || room.hostId !== player.id) throw new Error('仅房主可在准备阶段选择对局模式');
      const { mode } = z.object({ mode: modeSchema }).strict().parse(input);
      room.mode = mode; room.players.forEach(p => p.ready = false); room.touched = Date.now(); broadcast(room);
    });
    handle('ai:configure', input => {
      const { room, player } = requirePlayer(socket);
      if (!['waiting', 'playing'].includes(room.status)) throw new Error('本局已结束，密钥不再接收');
      const config = { ...configFor(socket, input, player.config), identity: player.loadout.identity, items: [...player.loadout.items] };
      if (room.status === 'playing' && (!player.config || JSON.stringify(ownAiSettings(config)) !== JSON.stringify(ownAiSettings(player.config)))) throw new Error('对局中仅能重新提交原配置的密钥，不能更换模型或接口');
      player.config = config; if (room.status === 'waiting') player.ready = false;
      rememberPreference(socket, player);
      room.touched = Date.now(); if (canAct(room)) room.notice = null; broadcast(room);
      return ownAiSettings(config);
    });
    handle('player:loadout', input => {
      const { room, player } = requirePlayer(socket);
      if (room.status !== 'waiting') throw new Error('开庭后身份与道具已锁定');
      const loadout = loadoutSchema.parse(input);
      player.loadout = { identity: loadout.identity, items: [...loadout.items] };
      if (player.config) player.config = { ...player.config, identity: loadout.identity, items: [...loadout.items] };
      rememberPreference(socket, player);
      player.ready = false; room.touched = Date.now(); broadcast(room);
      return { identity: player.loadout.identity, items: [...player.loadout.items] };
    });
    handle('ai:test', async input => {
      const { room, player } = requirePlayer(socket);
      if (room.status !== 'waiting' && room.status !== 'playing') throw new Error('本局已结束');
      limit(`test:${socket.handshake.address}`, 4);
      const result = await llm.testConnection(configFor(socket, input, player.config), room.abort.signal);
      if (!result.ok) throw new Error(result.message);
      return { message: result.message };
    });
    handle('room:ready', input => {
      const { room, player } = requirePlayer(socket);
      if (room.status !== 'waiting') throw new Error('当前不在准备阶段');
      const { ready } = z.object({ ready: z.boolean() }).strict().parse(input);
      if (ready && (!player.config || (player.config.provider !== 'mock' && !player.config.apiKey))) throw new Error('请先保存 AI 配置');
      player.ready = ready; room.touched = Date.now(); broadcast(room);
    });
    handle('game:start', async () => {
      const { room, player } = requirePlayer(socket);
      if (room.hostId !== player.id || room.status !== 'waiting') throw new Error('仅房主可开始尚未进行的对局');
      if (room.players.length !== 2 || room.players.some(p => !p.ready || !p.config || !p.socketId)) throw new Error('需要双方在线、已配置并准备');
      room.status = 'playing'; room.execution = 'resolving'; room.matchId = randomUUID();
      try {
        const saved = preferenceFor(socket); const previous = saved?.variants?.[room.caseId];
        const v3Case = room.rulesVersion === 3 ? instantiateCase(room.caseId, undefined, previous ? previous === 'route-a' ? 'route-b' : 'route-a' : undefined) : null;
        room.lockedCase = v3Case ? deepFreeze({ ...v3Case, ruleProfile: { ...v3Case.ruleProfile, ...llm.limitsSnapshot() }, matchMode: room.mode }) : Object.freeze({ ...findCase(room.caseId), experienceVersion: 2, matchMode: room.mode });
        room.game = createGame(templateFor(room), Object.fromEntries(room.players.map(p => [p.side, publicConfig(p.config!)])) as Record<Side, PublicConfig>);
        if (room.rulesVersion === 3) room.game = skipExhausted(templateFor(room), room.game);
        const matchPlayers = room.players.map(p => ({ id: p.id, nickname: p.nickname, side: p.side, config: publicConfig(p.config!) }));
        await persist(room, () => store.startMatch(room.matchId!, room.id, templateFor(room), matchPlayers));
        for (const p of room.players) p.recentCaseIds = [room.caseId, ...(p.recentCaseIds ?? [])].slice(0, 3);
        if (saved && room.lockedCase.variant) (saved.variants ??= {})[room.caseId] = room.lockedCase.variant.id;
        if (room.status !== 'playing') return;
        if (room.game.events.length) await persist(room, () => store.append(room.matchId!, room.game!.events, []));
      } catch { await cancel(room, '无法保存对局，已中止；请检查数据库。'); throw new Error('对局启动失败'); }
      if (room.status === 'playing') { room.execution = 'awaiting_action'; broadcast(room); }
    });
    handle('game:preview_action', input => {
      const { room, player } = requirePlayer(socket);
      limit('preview:' + player.id, 90);
      if (!validBinding(room)) throw new Error('案件或模式已失效，请返回大厅');
      if (room.status !== 'playing' || !room.game || room.execution !== 'awaiting_action' || room.pending) throw new Error('当前不能预览行动');
      const command = draftCommand(input);
      if (command.turnId !== turnIdFor(room.matchId!, room.game)) throw new Error('回合已过期，请同步最新状态');
      const signature = previewSignature(previewSecret, player.id, room.mode, command);
      const preview = buildPreview(templateFor(room), room.game, player.side, command, room.mode, signature);
      room.touched = Date.now();
      return preview;
    });
    handle('game:submit_action', input => {
      const { room, player } = requirePlayer(socket);
      if (!validBinding(room)) { void cancel(room, '案件版本校验不一致，本局已中止，不产生判决。'); throw new Error('案件已失效，请返回大厅新建房间'); }
      const command = commandSchema.parse(input), fingerprint = JSON.stringify(command);
      const existing = room.receipts.get(command.actionId);
      if (existing) {
        if (existing.playerId !== player.id || existing.fingerprint !== fingerprint) throw new Error('行动 ID 不可用于不同请求');
        return structuredClone(existing.receipt);
      }
      if (!room.game || !canAct(room)) throw new Error('对局尚未就绪，请等待双方在线并恢复模型连接');
      if (room.execution !== 'awaiting_action' || room.pending) throw new Error('本回合行动已锁定，请等待结算');
      if (command.previewId && command.previewId !== previewSignature(previewSecret, player.id, room.mode, command)) throw new Error('预览已过期或选择发生变化，请重新查看');
      const preview = buildPreview(templateFor(room), room.game, player.side, command, room.mode);
      const prepared = prepareAction(templateFor(room), room.game, player.side, command, { turnId: turnIdFor(room.matchId!, room.game), actorId: player.id });
      if (prepared.event.settlement) prepared.event.settlement.comparison = comparisonText(preview, prepared);
      const receipt: ActionReceipt = { actionId: command.actionId, turnId: command.turnId, status: 'generating', command };
      room.receipts.set(command.actionId, { playerId: player.id, fingerprint, receipt });
      room.pending = { player, prepared, receipt }; room.execution = 'generating'; room.thinking = player.side; room.notice = null; room.touched = Date.now();
      broadcast(room); void executeAction(room);
      return structuredClone(receipt);
    });
    socket.on('disconnect', () => {
      try {
        const { room, player } = requirePlayer(socket);
        player.socketId = null; if (player.config) player.config.apiKey = '';
        if (room.status === 'waiting') player.ready = false;
        room.touched = Date.now();
        if (room.status === 'playing') room.notice = '玩家连接中断，已提交行动只结算一次；等待重连后继续。已记住的模型配置会自动恢复。';
        broadcast(room);
      } catch { /* Socket may already have been replaced by a reconnect. */ }
    });
  });
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '2.0.0', experience: rulesVersion === 3 ? '1.3' : '1.2', rulesVersion, gameplay: 'player_command', storage: store.mode, activeRooms: rooms.size,
    recovery: '服务重启会中止未完成对局；正在进行的房间不可恢复，不生成判决。' }));
  app.get('/api/catalog', (_req, res) => res.json({ cases: catalogCases.map(t => rulesVersion === 3 ? publicCaseV3(t) : publicCase(t)), identities: IDENTITY_CATALOG.map(i => ({ ...i, description: rulesVersion === 3 ? i.id === 'civilian' ? '2次调查；首次有效整理额外恢复4点冷静值。' : i.id === 'tycoon' ? '3次调查；每局可花2份资源，在一次行动内连续调查2条线索。' : '1次调查；首次技术检查免调查，与放大镜共用。' : i.description })), items: ITEM_CATALOG.map(i => ({ ...i, description: playerText(i.description) })) }));
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [key, room] of rooms) {
      if (now - room.touched > ttl) void cancel(room, '房间长时间未活动，已清理。').finally(() => { clearKeys(room); rooms.delete(key); });
    }
    for (const [key, value] of rates) if (value.reset < now) rates.delete(key);
    for (const [token, saved] of preferences) if (now - saved.touched >= preferenceTtl) forgetPreference(token);
  }, Math.min(ttl, 30_000)); cleaner.unref();
  return { app, http, io, store, rooms,
    close: async () => {
      clearInterval(cleaner);
      await Promise.allSettled([...rooms.values()].map(r => cancel(r, '服务关闭，本局中止。正在进行的房间无法恢复，请重新创建。')));
      for (const r of rooms.values()) { r.abort.abort(); clearKeys(r); }
      for (const token of preferences.keys()) forgetPreference(token);
      await new Promise<void>(resolve => io.close(() => resolve())); await store.close();
    }
  };
}
