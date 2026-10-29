import { manualChoice } from './helpers.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Store } from '../server/store.js';
import { CASES } from '../server/cases.js';
import { prepareAction, finalizeAction, createGame, replayGame } from '../server/game.js';
import type { CallRecord, CaseTemplate, GameEvent, PublicConfig, Side } from '../shared/types.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('isolated MySQL 8 persistence (TEST_DATABASE_URL only)', () => {
  let store: Store; let db: PrismaClient;
  const config: PublicConfig = { provider: 'mock', model: 'scripted-v1', personality: 'rigorous', strategy: 'evidence', identity: 'civilian', items: ['magnifier', 'coffee'] };
  const configs = { defense: config, prosecution: config };
  beforeAll(async () => {
    if (!url || new URL(url).pathname !== '/court_test') throw new Error('Use a dedicated database named court_test.');
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    store = new Store('mysql'); await store.initialize(CASES);
  });
  afterAll(async () => { await store?.close(); await db?.$disconnect(); });
  const setup = async (template = CASES[0]) => {
    const roomId = randomUUID(); const matchId = randomUUID();
    await store.createRoom(roomId, randomUUID().replace(/-/g, '').slice(0, 6));
    const players = (['defense', 'prosecution'] as Side[]).map(side => ({ id: randomUUID(), nickname: `DB-${side}`, side,
      // Deliberately pass an extra property; the storage boundary must pick public fields.
      config: { ...config, apiKey: 'SENTINEL-NEVER-PERSIST-KEY' } }));
    await store.startMatch(matchId, roomId, template, players);
    return { roomId, matchId, players };
  };
  it.each(CASES)('saves $title, all events/calls, and replays the frozen rules', async template => {
    const { roomId, matchId } = await setup(template);
    const game = createGame(template, configs);
    let last = 0;
    while (game.phase !== 'finished') {
      const side = game.turn;
      const command = manualChoice(template, game); const next = finalizeAction(prepareAction(template, game, side, command, { turnId: command.turnId, actorId: side }), prepareAction(template, game, side, command, { turnId: command.turnId, actorId: side }).action); Object.assign(game, next);
      const call: CallRecord = { id: randomUUID(), side, provider: 'mock', model: config.model, attempt: 0, status: 'mock', inputTokens: 0, outputTokens: 0, durationMs: 0, estimatedCost: 0 };
      await store.append(matchId, game.events.slice(last), [call]); last = game.events.length;
    }
    await store.endRoom(roomId, matchId, game.verdict);
    const persisted = await db.match.findUniqueOrThrow({ where: { id: matchId }, include: { players: true, events: { orderBy: { sequence: 'asc' } }, calls: true } });
    expect(persisted.status).toBe('finished'); expect(persisted.calls).toHaveLength(8);
    expect(persisted.players).toHaveLength(2);
    expect(JSON.stringify(persisted)).not.toContain('SENTINEL-NEVER-PERSIST-KEY');
    expect(JSON.stringify(persisted)).not.toContain('apiKey');
    const replay = replayGame(persisted.caseSnapshot as unknown as CaseTemplate, configs, persisted.events.map(e => e.data as unknown as GameEvent));
    expect(replay.verdict).toEqual(game.verdict); expect(persisted.result).toEqual(game.verdict);
  });
  it('keeps per-match case snapshots immutable after template updates', async () => {
    const { matchId } = await setup();
    await db.caseTemplate.update({ where: { id: CASES[0].id }, data: { title: 'A future template revision', version: 99 } });
    const row = await db.match.findUniqueOrThrow({ where: { id: matchId } });
    expect((row.caseSnapshot as unknown as CaseTemplate).version).toBe(CASES[0].version);
    expect((row.caseSnapshot as unknown as CaseTemplate).title).toBe(CASES[0].title);
    await store.initialize(CASES);
  });
  it('marks interrupted matches aborted and removes an uncommitted verdict on restart', async () => {
    const { roomId, matchId } = await setup();
    const game = createGame(CASES[0], configs);
    while (game.phase !== 'finished') { const c = manualChoice(CASES[0], game); const p = prepareAction(CASES[0], game, game.turn, c, { turnId: c.turnId, actorId: game.turn }); Object.assign(game, finalizeAction(p, p.action)); }
    await store.append(matchId, game.events, []);
    await store.initialize(CASES);
    const match = await db.match.findUniqueOrThrow({ where: { id: matchId }, include: { events: true } });
    expect(match.status).toBe('aborted'); expect(match.result).toBeNull();
    expect(match.events.some(e => (e.data as unknown as GameEvent).kind === 'verdict')).toBe(false);
    expect((await db.room.findUniqueOrThrow({ where: { id: roomId } })).status).toBe('cancelled');
  });
  it('cancellation clears even a previously queued verdict in data and events', async () => {
    const { roomId, matchId } = await setup();
    const game = createGame(CASES[0], configs);
    while (game.phase !== 'finished') { const c = manualChoice(CASES[0], game); const p = prepareAction(CASES[0], game, game.turn, c, { turnId: c.turnId, actorId: game.turn }); Object.assign(game, finalizeAction(p, p.action)); }
    await store.append(matchId, game.events, []);
    await store.endRoom(roomId, matchId, game.verdict); await store.endRoom(roomId, matchId, null);
    const match = await db.match.findUniqueOrThrow({ where: { id: matchId }, include: { events: true } });
    expect(match.result).toBeNull(); expect(match.status).toBe('aborted');
    expect(match.events.some(e => (e.data as unknown as GameEvent).kind === 'verdict')).toBe(false);
  });
});
