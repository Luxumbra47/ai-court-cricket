import { PrismaClient, Prisma } from '@prisma/client';
import type { CaseTemplate, CallRecord, GameEvent, PublicConfig, Side, Verdict } from '../shared/types.js';

type MatchPlayerInput = { id: string; nickname: string; side: Side; config: PublicConfig };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Database boundaries accept public projections only. Never pass AiConfig here. */
export class Store {
  readonly mode: 'memory' | 'mysql';
  private db: PrismaClient | null;
  constructor(mode: 'memory' | 'mysql' = 'memory') {
    this.mode = mode;
    this.db = mode === 'mysql' ? new PrismaClient({ log: [] }) : null;
  }
  async initialize(cases: CaseTemplate[]) {
    if (!this.db) return;
    await this.db.$connect();
    await this.db.$transaction([
      this.db.match.updateMany({ where: { status: 'playing' }, data: { status: 'aborted', endedAt: new Date(), result: Prisma.DbNull } }),
      this.db.room.updateMany({ where: { status: { in: ['waiting', 'playing'] } }, data: { status: 'cancelled' } })
    ]);
    await this.db.matchEvent.deleteMany({ where: { match: { status: 'aborted' }, data: { path: '$.kind', equals: 'verdict' } } });
    for (const template of cases) {
      await this.db.caseTemplate.upsert({ where: { id: template.id },
        create: { id: template.id, version: template.version, title: template.title, data: json(template) },
        update: { version: template.version, title: template.title, data: json(template) } });
    }
  }
  async createRoom(id: string, code: string) {
    await this.db?.room.create({ data: { id, code, status: 'waiting' } });
  }
  async startMatch(id: string, roomId: string, template: CaseTemplate, players: MatchPlayerInput[]) {
    if (!this.db) return;
    // Pick every field explicitly: an extra runtime property can never persist a key.
    await this.db.$transaction(async db => {
      await db.room.update({ where: { id: roomId }, data: { status: 'playing' } });
      for (const p of players) await db.user.upsert({ where: { id: p.id }, create: { id: p.id, nickname: p.nickname }, update: { nickname: p.nickname } });
      await db.match.create({ data: { id, roomId, caseId: template.id, caseVersion: template.version, caseSnapshot: json(template), status: 'playing' } });
      for (const p of players) await db.matchPlayer.create({ data: {
        matchId: id, userId: p.id, side: p.side, identity: p.config.identity,
        provider: p.config.provider, model: p.config.model,
        publicConfig: json({ provider: p.config.provider, model: p.config.model, personality: p.config.personality,
          strategy: p.config.strategy, identity: p.config.identity, items: p.config.items })
      } });
    });
  }
  async append(matchId: string, events: GameEvent[], calls: CallRecord[]) {
    if (!this.db) return;
    await this.db.$transaction(async db => {
      if (events.length) await db.matchEvent.createMany({ data: events.map(e => ({ matchId, sequence: e.sequence, data: json(e) })) });
      if (calls.length) await db.llmCall.createMany({ data: calls.map(c => ({
        id: c.id, matchId, side: c.side, provider: c.provider, model: c.model, attempt: c.attempt,
        status: c.status, inputTokens: c.inputTokens, outputTokens: c.outputTokens,
        durationMs: c.durationMs, estimatedCost: c.estimatedCost
      })) });
    });
  }
  async endRoom(roomId: string, matchId: string | null, verdict: Verdict | null) {
    if (!this.db) return;
    await this.db.$transaction(async db => {
      await db.room.update({ where: { id: roomId }, data: { status: verdict ? 'finished' : 'cancelled' } });
      if (matchId) await db.match.update({ where: { id: matchId }, data: {
        status: verdict ? 'finished' : 'aborted', endedAt: new Date(), result: verdict ? json(verdict) : Prisma.DbNull
      } });
      if (matchId && !verdict) await db.matchEvent.deleteMany({ where: { matchId, data: { path: '$.kind', equals: 'verdict' } } });
    });
  }
  async close() { await this.db?.$disconnect(); }
}
