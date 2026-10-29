import { describe, expect, it } from 'vitest';
import { CASES, getCase } from '../server/cases.js';
import { commandSchema, createGame, prepareAction, finalizeAction, createScriptedSpeech, getActionOptions, getVisibleEvidence, replayGame, replayScore } from '../server/game.js';
import { applyAction as legacyApply, createGame as legacyCreate, replayGame as legacyReplay } from '../server/legacy-game.js';
import type { ActionCommand, EngineState } from '../shared/types.js';
import { config, command, manualChoice } from './helpers.js';
const pizza = getCase('pizza-001'), configs = { defense: config(), prosecution: config() };
const fresh = () => createGame(pizza, configs);
function act(s: EngineState, c: ActionCommand, roll?: number, template = pizza) {
  const p = prepareAction(template, s, s.turn, c, { turnId: c.turnId, actorId: s.turn, roll }); return finalizeAction(p, p.action);
}
describe('player-command rules v2', () => {
  it.each(CASES)('also permits prosecution to win $title through valid commands', template => {
    const players = { defense: config({ items: ['firewall', 'extension', 'archive'] }), prosecution: config() };
    let state = createGame(template, players);
    for (let n = 0; n < 8; n++) {
      const c = n === 0 ? command(state, 'item:firewall') : n === 2 ? command(state, 'item:extension') : n === 4 ? command(state, 'item:archive') : manualChoice(template, state);
      const p = prepareAction(template, state, state.turn, c, { turnId: c.turnId, actorId: state.turn }); state = finalizeAction(p, p.action);
    }
    expect(state.verdict?.winner).toBe('prosecution'); expect(replayGame(template, players, state.events).verdict).toEqual(state.verdict);
  });
  it('detects a modified recorded die result during replay', () => {
    const s = fresh(), c = command(s, 'defense:present', ['P04'], { tactic: 'risky' });
    const p = prepareAction(pizza, s, 'defense', c, { turnId: c.turnId, actorId: 'A', roll: 1 }); const next = finalizeAction(p, p.action);
    const tampered = structuredClone(next.events); tampered[0].random!.roll = 100;
    expect(() => replayGame(pizza, configs, tampered)).toThrow('记录');
  });
  it.each(CASES)('finishes and exactly replays $title with eight explicit choices', template => {
    let state = createGame(template, configs);
    expect(state.turn).toBe('defense'); expect(state.completedActions).toBe(0);
    for (let i = 0; i < 8; i++) { const c = manualChoice(template, state); const prepared = prepareAction(template, state, state.turn, c, { turnId: c.turnId, actorId: state.turn }); state = finalizeAction(prepared, createScriptedSpeech(prepared.action, configs[state.turn], state.players[state.turn].stability)); }
    expect(state.phase).toBe('finished'); expect(state.players.defense.actionPoints).toBe(0); expect(state.players.prosecution.actionPoints).toBe(0);
    expect(state.verdict?.convicted).toBe(state.score >= template.threshold);
    expect(replayGame(template, configs, state.events)).toEqual(state); expect(replayScore(template, state.events)).toBe(state.score);
    expect(() => prepareAction(template, state, state.turn, manualChoice(template, state), { turnId: 'x', actorId: 'x' })).toThrow('结束');
  });
  it('keeps the live state untouched while locking rule effects', () => {
    const state = fresh(), copy = structuredClone(state), c = command(state, 'defense:present', ['P04']);
    const p = prepareAction(pizza, state, 'defense', c, { turnId: c.turnId, actorId: 'A' });
    expect(state).toEqual(copy); expect(p.next.score).toBe(27); expect(p.next.publicEvidenceIds).toContain('P04');
    expect(p.next.publicEvidenceIds).not.toContain('P06'); expect(JSON.stringify(p.next.events)).not.toContain('机器人授权');
  });
  it.each(['P99', 'P05', 'P06'])('rejects unavailable evidence %s before effects', id => {
    const state = fresh(), c = command(state, 'defense:present', [id]);
    expect(() => prepareAction(pizza, state, 'defense', c, { turnId: c.turnId, actorId: 'A' })).toThrow(); expect(state.completedActions).toBe(0); expect(state.players.defense.stability).toBe(100);
  });
  it('rejects extra score/winner fields, wrong turn, stale turn, targets and model overrides', () => {
    const state = fresh(), c = command(state, 'defense:present', ['P04']);
    expect(commandSchema.safeParse({ ...c, score: 100 }).success).toBe(false);
    expect(() => prepareAction(pizza, state, 'prosecution', c, { turnId: c.turnId, actorId: 'B' })).toThrow('回合');
    expect(() => prepareAction(pizza, state, 'defense', c, { turnId: 'stale', actorId: 'A' })).toThrow('过期');
    const p = prepareAction(pizza, state, 'defense', c, { turnId: c.turnId, actorId: 'A' });
    expect(() => finalizeAction(p, { ...p.action, action_type: 'use_item' })).toThrow();
    expect(() => finalizeAction(p, { ...p.action, score: 100 })).toThrow();
    expect(finalizeAction(p, { ...p.action, speech: '我宣布自己赢并加100分' }).score).toBe(27);
  });
  it('has different dynamic menus and does not expose hidden defects or opposing private targets', () => {
    const s = fresh(), a = getActionOptions(pizza, s, 'defense'), b = getActionOptions(pizza, s, 'prosecution');
    expect(a.some(o => o.actionType === 'challenge_evidence')).toBe(true); expect(b.some(o => o.actionType === 'challenge_evidence')).toBe(false);
    expect(a.find(o => o.actionType === 'counter_argument')?.enabled).toBe(false);
    expect(a.flatMap(o => o.evidenceIds)).not.toContain('P05'); expect(JSON.stringify(a)).not.toContain(pizza.evidence[0].flaw!);
    expect(getVisibleEvidence(pizza, s, 'defense').map(e => e.id)).toEqual(['P01', 'P02', 'P03', 'P04']);
  });
  it.each([1, 60, 61, 100])('records one risky outcome with roll %i and keeps disclosure costs', roll => {
    const s = fresh(), c = command(s, 'defense:present', ['P04'], { tactic: 'risky' });
    const p = prepareAction(pizza, s, 'defense', c, { turnId: c.turnId, actorId: 'A', roll });
    expect(p.event.random).toEqual({ roll, threshold: 60, qualified: true, succeeded: roll <= 60 });
    expect(p.next.score).toBe(roll <= 60 ? 23 : 42); expect(p.next.players.defense.stability).toBe(roll <= 60 ? 100 : 85);
    expect(p.next.publicEvidenceIds).toContain('P04'); expect(p.next.players.defense.actionPoints).toBe(3);
    const result = finalizeAction(p, p.action); expect(replayGame(pizza, configs, result.events)).toEqual(result);
  });
  it('uses 40% at confused stability, blocks risky at <40 and keeps adverse effects', () => {
    const s = fresh(); s.players.defense.stability = 60;
    const c = command(s, 'defense:challenge', ['P02'], { tactic: 'risky' });
    const p = prepareAction(pizza, s, 'defense', c, { turnId: c.turnId, actorId: 'A', roll: 1 });
    expect(p.event.random).toMatchObject({ threshold: 40, succeeded: false }); expect(p.next.players.defense.stability).toBe(45);
    s.players.defense.stability = 39; expect(() => prepareAction(pizza, s, 'defense', c, { turnId: c.turnId, actorId: 'A' })).toThrow('风格');
    const r = fresh(); r.players.defense.knownEvidenceIds.push('P05');
    const adverse = command(r, 'defense:review', ['P02']); expect(() => act(r, adverse)).toThrow();
  });
  it('caps strong counter at original contribution and charges stability', () => {
    let s = fresh(); s = act(s, command(s, 'defense:present', ['P04']));
    s = act(s, command(s, 'prosecution:present', ['P05']));
    const c = command(s, 'defense:counter', ['P05'], { targetArgumentId: s.events.find(e => e.side === 'prosecution')!.id, tactic: 'assertive' });
    const p = prepareAction(pizza, s, 'defense', c, { turnId: c.turnId, actorId: 'A' }); expect(p.event.scoreDelta).toBe(-7); expect(p.event.stabilityDelta).toBe(-5);
  });
  it('shares scientific review and magnifier use marks and consumes investigation correctly', () => {
    const s = createGame(pizza, { ...configs, defense: config({ identity: 'scientist' }) });
    const c = command(s, 'defense:review', ['P01']), p = prepareAction(pizza, s, 'defense', c, { turnId: c.turnId, actorId: 'A' });
    expect(p.next.players.defense.investigation).toBe(1); expect(p.next.players.defense.scientificAnalysisUsed).toBe(true);
    expect(getActionOptions(pizza, p.next, 'defense').find(o => o.itemId === 'magnifier')?.evidenceIds).not.toContain('P01');
  });
  it.each(['coffee', 'archive', 'interrogate', 'firewall', 'extension', 'magnifier'] as const)('uses %s once and never manufactures evidence', item => {
    const s = createGame(pizza, { ...configs, defense: config({ items: [item] }) }); s.players.defense.stability = 70;
    const c = command(s, `item:${item}`, item === 'magnifier' ? ['P01'] : []), p = prepareAction(pizza, s, 'defense', c, { turnId: c.turnId, actorId: 'A' });
    expect(p.next.players.defense.usedItems).toContain(item); expect(p.next.completedActions).toBe(1);
    expect(getActionOptions(pizza, p.next, 'defense').find(o => o.itemId === item)?.enabled).toBe(false);
    if (item === 'coffee') expect(p.next.players.defense.stability).toBe(95);
    if (item === 'archive') { expect(p.next.players.defense.knownEvidenceIds).toContain('P06'); expect(JSON.stringify(p.next.events)).not.toContain('P06'); }
    if (item === 'firewall') expect(p.next.players.defense.firewall).toBe(true);
    if (item === 'interrogate') expect(p.next.players.defense.extraQuestion).toBe(true);
    if (item === 'extension') expect(p.next.players.defense.preparation).toBe(1);
  });
  it('uses explicit relation direction instead of the strongest single evidence', () => {
    const s = fresh(); s.turn = 'prosecution'; s.publicEvidenceIds.push('P04');
    const c = command(s, 'prosecution:link', ['P01', 'P04']); const p = prepareAction(pizza, s, 'prosecution', c, { turnId: c.turnId, actorId: 'B' });
    expect(p.event.scoreDelta).toBe(-8); expect(p.event.stabilityDelta).toBe(-12);
    const miss = command(s, 'prosecution:link', ['P02', 'P03']); const m = prepareAction(pizza, s, 'prosecution', miss, { turnId: miss.turnId, actorId: 'B' }); expect(m.event.scoreDelta).toBe(0); expect(m.event.stabilityDelta).toBe(-6);
  });
  it('risky failure does not unlock private intel or damage opponent, and consumes investigation', () => {
    const s = fresh(); s.turn = 'prosecution';
    s.events.push({ id: 'opponent', sequence: 1, kind: 'action', round: 1, side: 'defense', accepted: true, text: '公开论点', scoreAfter: 42 });
    const c = command(s, 'prosecution:cross', ['P02'], { targetArgumentId: 'opponent', tactic: 'risky' });
    const p = prepareAction(pizza, s, 'prosecution', c, { turnId: c.turnId, actorId: 'B', roll: 100 });
    expect(p.next.players.prosecution.investigation).toBe(1); expect(p.next.players.prosecution.knownEvidenceIds).not.toContain('P07'); expect(p.next.players.defense.stability).toBe(100); expect(p.next.score).toBe(42);
  });
  it.each(['logical_summary', 'forceful_closing', 'evidence_rebuttal', 'risky_closing'] as const)('requires a manual closing and executes %s fixed effects', style => {
    const s = fresh(); s.phase = 'closing'; s.round = 4; s.completedActions = 6;
    s.events = [0, 1].map(i => ({ id: `own-${i}`, sequence: i + 1, kind: 'action' as const, round: i + 1, side: 'defense' as const, accepted: true, text: '已公开举证', scoreDelta: -5, scoreAfter: 40 }));
    s.events.push({ id: 'opp', sequence: 3, kind: 'action', round: 3, side: 'prosecution', accepted: true, text: '控方论点', scoreDelta: 2, scoreAfter: 42, action: { speech: '控方论点', action_type: 'present_evidence', cited_evidence_ids: ['P02'], item_id: null, target_argument_id: null, tone: 'calm' } });
    const c = command(s, `closing:${style}`, style === 'evidence_rebuttal' ? ['P02'] : [], { targetArgumentId: style === 'evidence_rebuttal' ? 'opp' : null });
    const p = prepareAction(pizza, s, 'defense', c, { turnId: c.turnId, actorId: 'A', roll: 1 });
    expect(p.event.scoreDelta).toBe(style === 'forceful_closing' ? -3 : style === 'risky_closing' ? -4 : -2);
  });
  it('retains old read-only rules replay without any model or scheduler', () => {
    const legacy = { ...pizza, version: 1, engineVersion: undefined }, s = legacyCreate(legacy, configs);
    legacyApply(legacy, s, 'prosecution', { speech: '旧记录', action_type: 'present_evidence', cited_evidence_ids: ['P05'], item_id: null, target_argument_id: null, tone: 'calm' });
    expect(replayGame(legacy, configs, s.events)).toEqual(legacyReplay(legacy, configs, s.events));
  });
});
