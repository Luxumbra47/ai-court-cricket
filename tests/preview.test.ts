import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PreviewView from '../src/components/ActionPreview';
import { CASES } from '../server/cases';
import { createGame, prepareAction, replayGame, getActionOptions } from '../server/game';
import { buildPreview, projectOptions, previewSignature } from '../server/preview';
import { comparisonText } from '../server/preview';
import { situation } from '../shared/situation';
import type { ActionCommand, CaseTemplate, EngineState, ItemId, MatchMode, Side } from '../shared/types';
import { config, command, manualChoice } from './helpers';
const modes: MatchMode[] = ['casual', 'standard', 'hardcore'];
const snapshots = CASES.map(t => ({ ...t, experienceVersion: 2 as const }));
const configs = { defense: config(), prosecution: config() };
function prepare(t: CaseTemplate, s: EngineState, c: ActionCommand, roll = 1) { return prepareAction(t, s, s.turn, c, { turnId: c.turnId, actorId: s.turn, roll, now: '2026-10-29T12:00:00Z' }); }
function check(t: CaseTemplate, s: EngineState, c: ActionCommand) {
  const before = structuredClone(s), preview = buildPreview(t, s, s.turn, c, 'casual');
  for (const roll of [1, 100]) {
    const p = prepare(t, s, c, roll), f = preview.forecast!;
    for (const [value, bounds] of [[p.event.scoreDelta!, f.score!], [p.next.players[s.turn].stability - s.players[s.turn].stability, f.selfCalm!], [p.next.players[s.turn === 'defense' ? 'prosecution' : 'defense'].stability - s.players[s.turn === 'defense' ? 'prosecution' : 'defense'].stability, f.opponentCalm!]] as const) {
      expect(value, `${c.optionId}/${c.tactic}`).toBeGreaterThanOrEqual(bounds[0]); expect(value).toBeLessThanOrEqual(bounds[1]);
      if (f.certainty === 'certain') expect(bounds[0]).toBe(bounds[1]);
    }
    expect(p.event.settlement?.calmChanges[s.turn]).toBe(p.event.stabilityDelta);
    expect(comparisonText(preview, p)).toBeTruthy();
  }
  expect(s).toEqual(before);
  const standard = buildPreview(t, s, s.turn, c, 'standard');
  expect(standard.forecast).not.toHaveProperty('score'); expect(standard.forecast).not.toHaveProperty('selfCalm');
  expect(standard.forecast).not.toHaveProperty('opponentCalm'); expect(standard.forecast).not.toHaveProperty('probability');
  expect(JSON.stringify(standard.forecast)).not.toMatch(/\d/);
  const hard = buildPreview(t, s, s.turn, c, 'hardcore'); expect(hard).not.toHaveProperty('forecast');
  expect(hard.costs.length).toBeGreaterThan(0); expect(hard.purpose).toBeTruthy();
  return preview;
}

describe('authoritative V1.2 previews and mode projection', () => {
  it.each(snapshots)('previews every legal action/style and replays eight choices in $id', template => {
    let state = createGame(template, configs); const covered = new Set<string>();
    for (let n = 0; n < 8; n++) {
      for (const option of getActionOptions(template, state, state.turn).filter(o => o.enabled)) {
        const target = option.targetRequired ? option.targetIds[0] : null;
        const evidence = target ? state.events.find(e => e.id === target)!.action!.cited_evidence_ids.filter(id => option.evidenceIds.includes(id)).slice(0, option.minEvidence) : option.evidenceIds.slice(0, option.minEvidence);
        for (const tactic of option.styles.filter(s => s.enabled)) {
          const c = command(state, option.id, evidence, { targetArgumentId: target, tactic: tactic.id });
          check(template, state, c); covered.add(option.actionType);
        }
      }
      const c = manualChoice(template, state); state = prepare(template, state, c).next;
    }
    expect([...covered]).toEqual(expect.arrayContaining(['present_evidence', 'challenge_evidence', 'counter_argument', 'cross_examination', 'timeline_analysis', 'review_evidence', 'use_item', 'closing_statement']));
    expect(replayGame(template, configs, state.events).verdict).toEqual(state.verdict);
    const corrupted = structuredClone(state.events); corrupted.find(e => e.settlement)!.settlement!.calmChanges.defense += 1;
    expect(() => replayGame(template, configs, corrupted)).toThrow('记录');
  });
  it.each(['magnifier', 'coffee', 'archive', 'interrogate', 'firewall', 'extension'] as ItemId[])('previews and settles %s using the same engine', item => {
    const t = snapshots[1], players = { defense: config({ identity: 'scientist', items: [item] }), prosecution: config() };
    const s = createGame(t, players); s.players.defense.stability = 72;
    const c = command(s, `item:${item}`, item === 'magnifier' ? ['D01'] : []);
    const preview = check(t, s, c), p = prepare(t, s, c);
    expect(preview.costs.join('')).toContain('本局不能再次使用'); expect(p.next.players.defense.usedItems).toContain(item);
    if (item === 'magnifier') { expect(preview.costs.join('')).toContain('免费'); expect(p.next.players.defense.investigation).toBe(s.players.defense.investigation); }
    if (item === 'coffee') { expect(preview.forecast?.selfCalm).toEqual([25, 25]); expect(p.event.stabilityDelta).toBe(25); }
    if (item === 'archive') expect(p.next.players.defense.knownEvidenceIds).toContain('D06');
    if (item === 'firewall') expect(p.next.players.defense.firewall).toBe(true);
    if (item === 'extension') expect(p.next.players.defense.preparation).toBe(1);
    if (item === 'interrogate') expect(p.next.players.defense.extraQuestion).toBe(true);
  });
  it.each(['civilian', 'tycoon', 'scientist'] as const)('accounts for %s investigation resources', identity => {
    const t = snapshots[0], s = createGame(t, { defense: config({ identity }), prosecution: config() }), c = command(s, 'defense:review', ['P01']);
    const p = check(t, s, c); expect(p.costs.join('')).toContain(identity === 'scientist' ? '免费' : '消耗 1 次调查');
    expect(s.players.defense.investigation).toBe(identity === 'tycoon' ? 3 : identity === 'civilian' ? 2 : 1);
  });
  it('updates targets, tactical ranges, cap and firewall effects from public state', () => {
    const t = snapshots[1], s = createGame(t, configs);
    const a = check(t, s, command(s, 'defense:present', ['D01'])), b = check(t, s, command(s, 'defense:present', ['D04'], { tactic: 'risky' }));
    expect(a.targets).not.toEqual(b.targets); expect(b.disclosure).toContain('自动操作计划'); expect(b.forecast?.probability).toBe(60);
    expect(a.forecast?.selfCalm).not.toEqual(b.forecast?.selfCalm);
    s.players.defense.stability = 65; s.players.defense.firewall = true; s.score = 99;
    const capped = check(t, s, command(s, 'defense:present', ['D04'], { tactic: 'risky' }));
    expect(capped.forecast?.probability).toBe(40); expect(capped.forecast?.score?.[1]).toBe(1);
    expect(capped.forecast?.selfCalm?.[0]).toBeGreaterThanOrEqual(-12);
  });
  it('does not reveal hidden scoring, links, unselected private records or the true branch', () => {
    const t = snapshots[1], s = createGame(t, configs), c = command(s, 'defense:present', ['D04']);
    const changed = structuredClone(t); changed.truth = 'SECRET-TRUTH'; changed.evidence.forEach(e => { e.strength *= -2; e.reliability = .99; e.flaw = 'SECRET-FLAW'; e.linkedIds = []; });
    for (const mode of modes) expect(buildPreview(t, s, 'defense', c, mode)).toEqual(buildPreview(changed, s, 'defense', c, mode));
    const json = JSON.stringify(buildPreview(t, s, 'defense', c, 'casual'));
    expect(json).not.toMatch(/SECRET|D05|D06|D07|reliability|linkedIds|"flaw"|"strength"/);
    expect(() => buildPreview(t, s, 'defense', command(s, 'defense:present', ['D05']), 'casual')).toThrow();
  });
  it('filters menus on the server and binds confirmations to player, mode, turn and normalized selection', () => {
    const t = snapshots[0], s = createGame(t, configs), c = command(s, 'defense:present', ['P04']);
    const token = previewSignature('server-only', 'A', 'casual', c);
    expect(previewSignature('server-only', 'A', 'casual', { ...c, actionId: 'other-id' })).toBe(token);
    for (const patch of [{ tactic: 'risky' as const }, { evidenceIds: ['P01'] }, { turnId: 'old' }]) expect(previewSignature('server-only', 'A', 'casual', { ...c, ...patch })).not.toBe(token);
    expect(previewSignature('server-only', 'B', 'casual', c)).not.toBe(token); expect(previewSignature('server-only', 'A', 'standard', c)).not.toBe(token);
    const json = JSON.stringify(projectOptions(getActionOptions(t, s, 'defense'), 'hardcore'));
    expect(json).not.toMatch(/probability|机会多争取|%|收益|降低 \d/);
  });
  it('keeps hidden timeline relations out of previews, even after selecting two public records', () => {
    const t = snapshots[1], s = createGame(t, configs); s.turn = 'prosecution'; s.publicEvidenceIds.push('D04', 'D05');
    const c = command(s, 'prosecution:link', ['D01', 'D05']);
    const altered = { ...t, timelineRules: [{ evidenceIds: ['D01', 'D05'] as [string, string], delta: -80 }] };
    for (const mode of modes) expect(buildPreview(t, s, 'prosecution', c, mode)).toEqual(buildPreview(altered, s, 'prosecution', c, mode));
    expect(prepare(t, s, c).event.scoreDelta).not.toBe(prepare(altered, s, c).event.scoreDelta);
  });
  it.each(modes)('renders the permitted %s information from the server response', mode => {
    const t = snapshots[1], s = createGame(t, configs), c = command(s, 'defense:present', ['D04'], { tactic: 'risky' });
    const preview = buildPreview(t, s, 'defense', c, mode), html = renderToStaticMarkup(createElement(PreviewView, { preview }));
    expect(html).toContain('使用后结束本回合'); expect(html).toContain('自动操作计划');
    if (mode === 'casual') { expect(html).toContain('60'); expect(html).toContain('preview-numbers'); }
    else { expect(html).not.toContain('preview-numbers'); expect(html).not.toContain('60%'); }
    if (mode === 'hardcore') { expect(html).not.toContain('可能支持'); expect(html).not.toContain('冒险可能失败'); expect(html).toContain('行动说明'); }
  });
  it.each(snapshots)('produces identical actual settlements in all modes for $id', template => {
    const final = modes.map(mode => {
      const t = { ...template, matchMode: mode }; let s = createGame(t, configs);
      for (let i = 0; i < 8; i++) { const c = { ...manualChoice(t, s), actionId: `00000000-0000-4000-8000-00000000000${i}` }; buildPreview(t, s, s.turn, c, mode); s = prepare(t, s, c).next; }
      return s;
    });
    expect(final[0]).toEqual(final[1]); expect(final[1]).toEqual(final[2]);
  });
  it('explains the objective public situation for both sides without forecasting an action', () => {
    expect(situation(40, 60, 'defense', 'defense')).toMatchObject({ score: 40, gap: 20, text: expect.stringContaining('还差 20') });
    expect(situation(65, 60, 'prosecution', 'prosecution').text).toContain('超过阈值 5');
  });
});
