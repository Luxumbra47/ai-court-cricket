import { describe, expect, it } from 'vitest';
import { CASES, getCase } from '../server/cases';
import { createGame, getActionOptions, prepareAction, finalizeAction, readableSpeech, replayGame } from '../server/game';
import * as previous from '../server/legacy-turn-game';
import { config, command } from './helpers';
import { buildPrompt } from '../server/llm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceStatus, EventCard } from '../src/pages/CourtPage';
import type { EvidenceView } from '../shared/types';
const configs = { defense: config(), prosecution: config() };

describe('case consistency and player-facing evidence', () => {
  it('keeps all 21 facts, authorized starting evidence and relations inside their own case', () => {
    expect(getCase('diamond-002').background).toContain('并非实体珠宝');
    for (const t of CASES) {
      const s = createGame(t, configs), ids = t.evidence.map(e => e.id), prefix = ids[0][0];
      expect(ids).toHaveLength(7); expect(new Set(ids).size).toBe(7);
      for (const e of t.evidence) {
        expect(e.id[0]).toBe(prefix); expect(e.explanation).toBeTruthy(); expect(e.details).toBeTruthy();
        expect(e.title).not.toMatch(/^[PDR]\d{2}/);
        expect(e.linkedIds.every(id => ids.includes(id))).toBe(true);
      }
      for (const r of t.timelineRules!) expect(r.evidenceIds.every(id => ids.includes(id))).toBe(true);
      expect(s.publicEvidenceIds.every(id => ids.includes(id))).toBe(true);
      expect(s.players.defense.knownEvidenceIds).not.toContain(prefix + '05');
    }
  });
  it('allows first presentation of a known public fact, then rejects it for both sides without mutating state', () => {
    const t = getCase('diamond-002'), s = createGame(t, configs);
    expect(s.publicEvidenceIds).toContain('D01'); expect(s.presented).not.toContain('D01');
    const c = command(s, 'defense:present', ['D01']);
    const p = prepareAction(t, s, 'defense', c, { turnId: c.turnId, actorId: 'a' });
    const next = finalizeAction(p, p.action);
    expect(next.presented).toContain('D01'); expect(next.publicEvidenceIds).toContain('D01');
    expect(getActionOptions(t, next, 'prosecution').find(o => o.id === 'prosecution:present')!.evidenceIds).not.toContain('D01');
    const duplicate = command(next, 'prosecution:present', ['D01']), frozen = structuredClone(next);
    expect(() => prepareAction(t, next, 'prosecution', duplicate, { turnId: duplicate.turnId, actorId: 'b' })).toThrow();
    expect(next).toEqual(frozen);
  });
  it('keeps investigation disclosure separate from presentation and describes real effects', () => {
    const t = getCase('diamond-002'), s = createGame(t, configs);
    const c = command(s, 'item:magnifier', ['D04']);
    const p = prepareAction(t, s, 'defense', c, { turnId: c.turnId, actorId: 'a' });
    expect(p.next.publicEvidenceIds).toContain('D04'); expect(p.next.presented).not.toContain('D04');
    expect(p.event.reason).toContain('自动操作计划');
    expect(p.action.speech).not.toMatch(/D04|程序规则|我方选择/);
    const prompt = JSON.stringify(buildPrompt(t, s, 'defense', config(), c, p.action, p.event.reason!));
    expect(prompt).not.toContain('演练许可单'); expect(prompt).not.toContain('接收账户权限记录');
    expect(prompt).not.toContain('verifiedResolution'); expect(prompt).not.toContain('reliability');
  });
  it('renders independent public/submitted/review flags and uses names in citations', () => {
    const t = getCase('diamond-002'), s = createGame(t, configs), c = command(s, 'defense:present', ['D04']);
    const p = prepareAction(t, s, 'defense', c, { turnId: c.turnId, actorId: 'a' });
    const e: EvidenceView = { id: 'D04', title: '自动操作计划', description: '', technical: true, state: { disclosure: 'public', submitted: false, challenged: true, reviewed: false, targetable: true } };
    const status = renderToStaticMarkup(createElement(EvidenceStatus, { evidence: e }));
    expect(status).toContain('双方可见'); expect(status).toContain('未出示'); expect(status).toContain('曾被质疑'); expect(status).not.toContain('已复核');
    const text = renderToStaticMarkup(createElement(EventCard, { event: p.event, selected: false, onEvidence: () => {}, evidence: [e] }));
    expect(text).toContain('自动操作计划'); expect(text).not.toMatch(/D04|记录 #|预置缺陷|程序规则/);
  });
  it('replays old turn snapshots under their unchanged rules', () => {
    const t = { ...getCase('diamond-002'), version: 2, experienceVersion: undefined }, s = previous.createGame(t, configs);
    const c = command(s, 'defense:present', ['D04']), p = previous.prepareAction(t, s, 'defense', c, { turnId: c.turnId, actorId: 'old' });
    const end = previous.finalizeAction(p, p.action);
    expect(replayGame(t, configs, end.events)).toEqual(end);
  });
  it('converts authorized IDs in speech and rejects private or foreign known references', () => {
    const t = getCase('diamond-002'), s = createGame(t, configs);
    expect(readableSpeech('请看 D01，这能证明转移发生。', t, s, [])).toBe('请看 钻石转移记录，这能证明转移发生。');
    for (const text of ['P01 说明有人路过', 'D06 已有许可', '演练许可单已经证明', '老板的送餐许可已经证明', '根据系统规则，我方执行行动']) expect(readableSpeech(text, t, s, [])).toBeNull();
  });
});
