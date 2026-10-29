import { make, clashChoice } from './v13-helpers';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CASES_V3, instantiateCase, selectCase, validateV3Cases } from '../server/cases-v3';
import { commandSchema, createGame, finalizeAction, getActionOptions, prepareAction, readableSpeech, replayGame, turnIdFor } from '../server/game';
import { skipExhausted } from '../server/game-v3';
import { buildPreview } from '../server/preview';
import { caseGuide } from '../server/guide';
import { presentEvent } from '../shared/presentation';
import { calmBand, riskChance, pressureExtra } from '../shared/rules';
import type { ActionCommand, ActionOption, CaseTemplate, EngineState, Identity, ItemId, MatchMode, Side } from '../shared/types';
import { command, config } from './helpers';
import PreviewView from '../src/components/ActionPreview';
const modes: MatchMode[] = ['casual', 'standard', 'hardcore'];
const configs = { defense: config(), prosecution: config() };
const template = () => instantiateCase('diamond-002', 'fixed-seed', 'route-a');
function apply(t: CaseTemplate, s: EngineState, c: ActionCommand, roll = 1, meltdownRoll = 100) {
  return prepareAction(t, s, s.turn, c, { turnId: turnIdFor('fixture', s), actorId: s.turn, roll, meltdownRoll, now: '2026-10-29T12:00:00Z' });
}
describe('V1.3 authored cases and twelve opportunities', () => {
  it('contains twelve distinct cases, four per difficulty, 108 justified materials and two defined events per case', () => {
    expect(CASES_V3).toHaveLength(12); expect(() => validateV3Cases(CASES_V3)).not.toThrow();
    for (const difficulty of ['beginner', 'standard', 'complex']) expect(CASES_V3.filter(t => t.difficulty === difficulty)).toHaveLength(4);
    expect(CASES_V3.flatMap(t => t.evidence)).toHaveLength(108);
    expect(new Set(CASES_V3.map(t => t.truth)).size).toBe(12);
    for (const t of CASES_V3) { expect(t.caseEvents).toHaveLength(2); expect(t.evidence.every(e => e.supports && e.limitations)).toBe(true); }
  });
  it.each(CASES_V3)('locks two real investigation routes and completes both $id routes', base => {
    const a = instantiateCase(base.id, 'a', 'route-a'), b = instantiateCase(base.id, 'b', 'route-b');
    expect(a.truth).toBe(b.truth); expect(a.variant!.initialPrivateIds).not.toEqual(b.variant!.initialPrivateIds);
    expect(a.leads).not.toEqual(b.leads); expect(Object.isFrozen(a.evidence[0])).toBe(true);
    for (const t of [a, b]) {
      for (const side of ['defense', 'prosecution'] as Side[]) {
        const known = new Set([...t.evidence.filter(e => e.visibility === 'public').map(e => e.id), ...t.variant!.initialPrivateIds[side]]);
        let todo = t.leads!.filter(l => l.side === side);
        while (todo.length) { const next = todo.find(l => l.requiresIds.every(id => known.has(id))); expect(next, `${t.id}/${side}: unreachable lead`).toBeTruthy(); next!.revealsIds.forEach(id => known.add(id)); todo = todo.filter(l => l !== next); }
        expect(t.evidence.filter(e => e.visibility === side).every(e => known.has(e.id))).toBe(true);
      }
      let s = createGame(t, configs); expect(s.players.defense.stability).toBe(90); expect(s.players.defense.actionPoints).toBe(6);
      const stages: string[] = [];
      while (s.phase !== 'finished') { stages.push(s.stage!); const c = clashChoice(t, s), p = apply(t, s, c); s = finalizeAction(p, p.action); }
      expect(s.completedActions).toBe(12); expect(s.opportunities).toBe(12); expect(s.skippedOpportunities).toBe(0);
      expect(stages).toEqual([...Array(4).fill('investigation'), ...Array(6).fill('debate'), 'closing', 'closing']);
      expect(s.players.defense.actionPoints).toBe(0); expect(s.players.prosecution.actionPoints).toBe(0);
      expect(s.verdict!.convicted).toBe(s.score >= t.threshold); expect(replayGame(t, configs, s.events)).toEqual(s);
      expect(s.players.defense.stability < 85 || s.players.prosecution.stability < 85).toBe(true);
    }
  });
  it.each(CASES_V3)('has legal win witnesses for both sides and each identity in $id', base => {
    const t = instantiateCase(base.id, 'witness', 'route-a');
    for (const identity of ['civilian', 'tycoon', 'scientist'] as Identity[]) for (const winner of ['defense', 'prosecution'] as Side[]) {
      const players = { defense: config({ identity, items: ['archive', 'coffee', 'firewall'] }), prosecution: config({ identity, items: ['archive', 'coffee', 'firewall'] }) }; let s = createGame(t, players);
      while (s.phase !== 'finished') {
        const options = getActionOptions(t, s, s.turn).filter(o => o.enabled);
        const choices = options.map(o => make(s, o));
        // Existence witnesses, not a claim that this oracle represents player skill or model strength.
        const ranked = choices.map(c => ({ c, p: apply(t, s, c) })).sort((a, b) => {
          const sign = winner === 'prosecution' ? 1 : -1;
          const passive = (c: ActionCommand) => ['investigate_lead', 'regain_composure', 'use_item'].includes(options.find(o => o.id === c.optionId)!.actionType) ? 1000 : 0;
          return s.turn === winner ? (b.p.next.score - a.p.next.score) * sign : passive(b.c) - passive(a.c) || (b.p.next.score - a.p.next.score) * sign;
        });
        s = finalizeAction(ranked[0].p, ranked[0].p.action);
      }
      expect(s.verdict!.winner, `${base.id}/${identity}/${winner}`).toBe(winner);
    }
  });
  it('avoids recent three for both visitors and relaxes an exhausted pool without blocking play', () => {
    const ids = CASES_V3.filter(t => t.difficulty === 'beginner').map(t => t.id);
    expect(selectCase('beginner', [ids.slice(0, 3)], 0)).toBe(ids[3]);
    expect(ids).toContain(selectCase('beginner', [ids.slice(0, 3), ids.slice(1)], 42));
  });
  it('skips truly exhausted opportunities without calls, resource charges or fake actions', () => {
    const t = { ...template(), allowedActions: [] }, s = createGame(t, configs);
    const next = skipExhausted(t, s); expect(next.phase).toBe('finished'); expect(next.completedActions).toBe(0); expect(next.skippedOpportunities).toBe(12);
    expect(next.events.filter(e => e.kind === 'skip')).toHaveLength(12); expect(next.players.defense.investigation).toBe(2); expect(s.opportunities).toBe(0);
    expect(replayGame(t, configs, next.events).verdict).toEqual(next.verdict);
  });
  it('rejects wrong stage, side, evidence, stale turn and duplicate combinations before effects', () => {
    const t = template(), s = createGame(t, configs), before = structuredClone(s), c = make(s, getActionOptions(t, s, 'defense').find(o => o.actionType === 'present_evidence')!);
    expect(() => apply(t, s, { ...c, optionId: 'defense:link' })).toThrow(); expect(() => apply(t, s, { ...c, evidenceIds: ['D05'] })).toThrow();
    expect(() => prepareAction(t, s, 'prosecution', c, { turnId: c.turnId, actorId: 'b' })).toThrow(); expect(() => apply(t, s, { ...c, turnId: 'stale' })).toThrow();
    expect(commandSchema.safeParse({ ...c, score: 100 }).success).toBe(false); expect(s).toEqual(before);
  });
});

describe('V1.3 calm, resources and authoritative settlement', () => {
  it.each([0, 1, 25, 26, 50, 51, 75, 76, 100])('retains legal aggressive and risky tactics at calm %s', calm => {
    const t = template(), s = createGame(t, configs); s.players.defense.stability = calm;
    const present = getActionOptions(t, s, 'defense').find(o => o.actionType === 'present_evidence')!;
    expect(present.styles.find(x => x.id === 'risky')?.enabled).toBe(true); expect(riskChance(calm)).toBe(calm >= 51 ? 60 : 40);
    expect(calmBand(calm)).toBeTruthy();
  });
  it('locks zero-calm 70/30 behavior before speech, with larger adverse loss and no dropped turn', () => {
    const t = template(), s = createGame(t, configs); s.players.defense.stability = 0;
    const o = getActionOptions(t, s, 'defense').find(o => o.actionType === 'present_evidence')!, c = make(s, o, { evidenceIds: ['D04'] });
    const failure = apply(t, s, c, 1, 70), normal = apply(t, s, c, 1, 71);
    expect(failure.event.meltdown?.occurred).toBe(true); expect(normal.event.meltdown?.occurred).toBe(false);
    expect(failure.event.scoreDelta).toBeGreaterThan(Math.abs(normal.event.scoreDelta!)); expect(failure.event.settlement?.outcome).toBe('meltdown');
    expect(failure.next.opportunities).toBe(1); expect(failure.next.completedActions).toBe(1); expect(failure.next.presented).toContain('D04');
    expect(failure.event.text).toContain(t.comicSlip); expect(failure.next.players.defense.actionPoints).toBe(5); expect(s.players.defense.stability).toBe(0);
    const finalized = finalizeAction(failure, { ...failure.action, speech: '我试图隐藏荒诞台词。' }); expect(finalized.events.find(e => e.kind === 'action')!.text).toContain(t.comicSlip);
  });
  it('keeps investigation, review, recovery and items reliable at zero and exposes only owned discoveries', () => {
    const t = template(), s = createGame(t, configs); s.players.defense.stability = 0;
    for (const type of ['investigate_lead', 'review_evidence', 'regain_composure', 'use_item']) {
      const o = getActionOptions(t, s, 'defense').find(o => o.actionType === type && o.enabled)!, p = apply(t, s, make(s, o), 100, 1);
      expect(p.event.meltdown).toBeUndefined(); expect(p.event.settlement?.conditionMet).toBe(true);
      if (type === 'investigate_lead') { expect(p.next.players.defense.knownEvidenceIds).toContain('D06'); expect(p.next.publicEvidenceIds).not.toContain('D06'); expect(JSON.stringify(p.next.events)).not.toContain('演练许可单'); }
    }
    const o = getActionOptions(t, s, 'defense').find(o => o.actionType === 'regain_composure')!, p = apply(t, s, make(s, o));
    expect(p.event.stabilityDelta).toBe(10); expect(p.next.players.defense.civilianRecoveryUsed).toBe(true);
    expect(getActionOptions(t, p.next, 'defense').find(o => o.id === 'regain')?.enabled).toBe(false);
  });
  it('keeps the potential gain for meltdown even when a separate risky roll fails, and retains adverse evidence costs', () => {
    const t = template(), s = createGame(t, configs); s.players.defense.stability = 0;
    const o = getActionOptions(t, s, 'defense').find(o => o.actionType === 'present_evidence')!;
    const ordinary = apply(t, s, make(s, o, { evidenceIds: ['D04'] }), 1, 100);
    const failed = apply(t, s, make(s, o, { evidenceIds: ['D04'], tactic: 'risky' }), 100, 1);
    expect(failed.event.random?.succeeded).toBe(false);
    expect(failed.event.meltdown?.penalty).toBe(Math.abs(ordinary.event.scoreDelta!) + 2);
    expect(failed.event.scoreDelta).toBe(failed.event.meltdown!.penalty);
    const adverse = apply(t, s, make(s, o, { evidenceIds: ['D01'] }), 1, 1);
    expect(adverse.event.settlement?.ruleIds).toContain('adverse_evidence');
    expect(adverse.event.scoreDelta).toBeGreaterThan(adverse.event.meltdown!.penalty);
  });
  it('never offers an already countered argument or a counter itself as a fresh counter target', () => {
    const t = template(); let s = createGame(t, configs);
    for (let i = 0; i < 5; i++) s = apply(t, s, clashChoice(t, s)).next;
    const counter = s.events.find(e => e.action?.action_type === 'counter_argument')!;
    expect(counter).toBeTruthy();
    const options = getActionOptions(t, s, s.turn).filter(o => o.actionType === 'counter_argument');
    expect(options.flatMap(o => o.targetIds)).not.toContain(counter.id);
    expect(options.flatMap(o => o.targetIds).some(id => s.countered.includes(id))).toBe(false);
  });
  it('rejects modified rule profiles and wrong-side starting materials before starting a game', () => {
    const altered = structuredClone(template()); altered.ruleProfile!.initialCalm = 100;
    expect(() => createGame(altered, configs)).toThrow('规则快照');
    const wrong = structuredClone(template()); wrong.variant!.initialPrivateIds.defense = ['D05'];
    expect(() => createGame(wrong, configs)).toThrow('阵营');
  });
  it.each([0, 1, 25, 26, 50, 51, 75, 76, 100])('applies counter pressure and firewall at target calm %s without passive recovery', calm => {
    for (const critical of [false, true]) {
    const base = template(), t = critical ? base : { ...base, caseEvents: [] }; let s = createGame(t, configs);
    for (let i = 0; i < 4; i++) s = apply(t, s, clashChoice(t, s)).next;
    s.players.prosecution.stability = calm;
    const o = getActionOptions(t, s, 'defense').find(o => o.actionType === 'counter_argument')!;
    const c = make(s, o), p = apply(t, s, c);
    expect(p.event.settlement!.calmChanges.prosecution).toBe(0 - Math.min(calm, Math.min(12, (critical ? 10 : 6) + pressureExtra(calm))));
    if (critical) expect(p.event.settlement!.ruleIds).toContain('critical_contradiction');
    s.players.prosecution.firewall = true;
    const protectedResult = apply(t, s, c);
    expect(protectedResult.event.settlement!.calmChanges.prosecution).toBe(0);
    expect(protectedResult.next.players.prosecution.firewall).toBe(false);
    }
  });
  it('scientist and magnifier share a free inspection, and tycoon may investigate two linked steps once', () => {
    const t = template(), scientific = { defense: config({ identity: 'scientist' }), prosecution: config() }, s = createGame(t, scientific);
    const review = getActionOptions(t, s, 'defense').find(o => o.actionType === 'review_evidence')!, p = apply(t, s, make(s, review));
    expect(p.next.players.defense.investigation).toBe(1); expect(p.next.players.defense.scientificAnalysisUsed).toBe(true); expect(p.event.settlement?.costs.join('')).toContain('免费');
    expect(getActionOptions(t, p.next, 'defense').find(o => o.itemId === 'magnifier')!.evidenceIds).not.toContain(review.evidenceIds[0]);
    const richT = instantiateCase('account-009', 'rich', 'route-a'), rich = createGame(richT, { defense: config({ identity: 'tycoon' }), prosecution: config() });
    const double = getActionOptions(richT, rich, 'defense').find(o => o.id === 'skill:double')!, result = apply(richT, rich, make(rich, double));
    expect(result.next.players.defense.investigation).toBe(1); expect(result.next.players.defense.tycoonInvestigationUsed).toBe(true);
    expect(result.next.players.defense.knownEvidenceIds.length).toBe(rich.players.defense.knownEvidenceIds.length + 2);
  });
  it.each(['magnifier', 'coffee', 'archive', 'interrogate', 'firewall', 'extension'] as ItemId[])('keeps %s preview, actual cost and once-only use aligned', item => {
    const t = template(), s = createGame(t, { defense: config({ items: [item] }), prosecution: config() }); s.players.defense.stability = 60;
    const o = getActionOptions(t, s, 'defense').find(o => o.itemId === item)!, c = make(s, o), preview = buildPreview(t, s, 'defense', c, 'casual'), p = apply(t, s, c);
    expect(preview.costs.join('')).toContain('本局不能重复'); expect(p.next.players.defense.usedItems).toContain(item);
    expect(getActionOptions(t, p.next, 'defense').find(o => o.itemId === item)?.enabled).toBe(false);
    expect(p.event.scoreDelta).toBeGreaterThanOrEqual(preview.forecast!.score![0]); expect(p.event.scoreDelta).toBeLessThanOrEqual(preview.forecast!.score![1]);
  });
  it('distinguishes a successful challenge against own-supporting evidence from a favorable result', () => {
    const base = template(), t = { ...base, evidence: base.evidence.map(e => e.id === 'D01' ? { ...e, strength: -15, flaw: '缺少核验', reliability: .5 } : e) };
    const s = createGame(t, configs), o = getActionOptions(t, s, 'defense').find(o => o.actionType === 'challenge_evidence')!, p = apply(t, s, make(s, o, { evidenceIds: ['D01'] }));
    expect(p.event.settlement?.conditionMet).toBe(true); expect(p.event.scoreDelta).toBeGreaterThan(0); expect(p.event.settlement?.favorable).toBe(false);
    expect(presentEvent(p.event).presentation!.title).toContain('支持了对方'); expect(presentEvent(p.event).presentation!.explanation).toContain('不利于辩方');
  });
  it('explains capped scores and validates recorded calm, dice, resources and case events on replay', () => {
    const t = template(); let s = createGame(t, configs);
    while (s.phase !== 'finished') { const p = apply(t, s, clashChoice(t, s)); s = finalizeAction(p, p.action); }
    for (const corrupt of ['calm', 'score', 'costs']) {
      const events = structuredClone(s.events), e = events.find(e => e.kind === 'action')!;
      if (corrupt === 'calm') e.settlement!.calmChanges.defense--;
      if (corrupt === 'score') e.scoreDelta!--;
      if (corrupt === 'costs') e.settlement!.costs.push('伪造资源');
      expect(() => replayGame(t, configs, events)).toThrow('不一致');
    }
    const edge = createGame(t, configs); edge.score = 0;
    const o = getActionOptions(t, edge, 'defense').find(o => o.actionType === 'present_evidence')!, p = apply(t, edge, make(edge, o, { evidenceIds: ['D04'] }));
    expect(p.event.scoreDelta).toBe(0); expect(p.event.reason).toContain('边界');
  });
});

describe('V1.3 previews, guide and fairness', () => {
  it.each(CASES_V3)('previews all legal action families and styles across $id without mutating state', base => {
    const t = instantiateCase(base.id, 'preview', 'route-a'); let s = createGame(t, configs);
    while (s.phase !== 'finished') {
      const before = structuredClone(s);
      for (const o of getActionOptions(t, s, s.turn).filter(o => o.enabled)) for (const style of o.styles.filter(s => s.enabled)) {
        const c = make(s, o, { tactic: style.id }), forecast = buildPreview(t, s, s.turn, c, 'casual').forecast!;
        for (const roll of [1, 100]) {
          const p = apply(t, s, c, roll);
          for (const [actual, bounds] of [[p.event.scoreDelta!, forecast.score!], [p.next.players[s.turn].stability - s.players[s.turn].stability, forecast.selfCalm!], [p.next.players[s.turn === 'defense' ? 'prosecution' : 'defense'].stability - s.players[s.turn === 'defense' ? 'prosecution' : 'defense'].stability, forecast.opponentCalm!]] as const) {
            expect(actual, `${base.id}/${o.id}/${style.id}`).toBeGreaterThanOrEqual(bounds[0]); expect(actual).toBeLessThanOrEqual(bounds[1]);
            if (forecast.certainty === 'certain') expect(bounds[0]).toBe(bounds[1]);
          }
        }
      }
      expect(s).toEqual(before); const p = apply(t, s, clashChoice(t, s)); s = p.next;
    }
  });
  it('covers both dice and keeps standard/hardcore data and hidden scoring out of the response', () => {
    const t = template(), s = createGame(t, configs); s.players.defense.stability = 0;
    const o = getActionOptions(t, s, 'defense').find(o => o.actionType === 'present_evidence')!, c = make(s, o, { evidenceIds: ['D04'], tactic: 'risky' });
    const preview = buildPreview(t, s, 'defense', c, 'casual'); expect(preview.forecast?.meltdownProbability).toBe(70);
    for (const roll of [1, 100]) for (const melt of [1, 100]) { const p = apply(t, s, c, roll, melt); expect(p.event.scoreDelta).toBeGreaterThanOrEqual(preview.forecast!.score![0]); expect(p.event.scoreDelta).toBeLessThanOrEqual(preview.forecast!.score![1]); }
    const changed = structuredClone(t); changed.evidence.forEach(e => { e.strength *= -1; e.reliability = .9; e.flaw = '隐藏'; e.linkedIds = []; }); changed.timelineRules = []; changed.caseEvents = [];
    expect(buildPreview(t, s, 'defense', c, 'casual')).toEqual(buildPreview(changed, s, 'defense', c, 'casual'));
    const standard = buildPreview(t, s, 'defense', c, 'standard'); expect(JSON.stringify(standard.forecast)).not.toMatch(/\d/); expect(standard.forecast).not.toHaveProperty('score');
    const hard = buildPreview(t, s, 'defense', c, 'hardcore'); expect(hard).not.toHaveProperty('forecast');
    const html = renderToStaticMarkup(createElement(PreviewView, { preview: hard })); expect(html).not.toContain('70%'); expect(html).not.toContain('数值是');
  });
  it('guides by actual authorized facts, suppresses hardcore suggestions, and rotates contextual advice', () => {
    const t = instantiateCase('pudding-004', 'guide', 'route-a'); let s = createGame(t, configs);
    const a = caseGuide(t, s, 'defense', 'casual', getActionOptions(t, s, 'defense'));
    expect(a.objective).toBe(t.defenseGoal); expect(a.suggestion).toBeTruthy(); expect(JSON.stringify(a)).not.toContain('便签背面的酸奶印');
    expect(caseGuide(t, s, 'defense', 'hardcore', getActionOptions(t, s, 'defense')).suggestion).toBeNull();
    for (let i = 0; i < 2; i++) s = apply(t, s, clashChoice(t, s)).next;
    const b = caseGuide(t, s, 'defense', 'casual', getActionOptions(t, s, 'defense')); expect(b.suggestion?.text).not.toBe(a.suggestion?.text);
    expect(readableSpeech('引用D99证明一切。', t, s, [])).toBeNull();
  });
});
