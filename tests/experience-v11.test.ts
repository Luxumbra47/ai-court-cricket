import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CASES, getCase, publicCase, validateCases } from '../server/cases';
import { createGame, finalizeAction, getActionOptions, prepareAction, replayGame } from '../server/game';
import { buildPrompt } from '../server/llm';
import { playerText, presentEvent } from '../shared/presentation';
import type { CaseTemplate, Evidence, EvidenceView, GameEvent, RoomView } from '../shared/types';
import { courtState, eligibleEvidenceIds } from '../src/courtState';
import CourtPage from '../src/pages/CourtPage';
import { command, config, manualChoice } from './helpers';

const template = getCase('diamond-002');
const viewEvidence = (e: Evidence): EvidenceView => ({ id: e.id, title: e.title, description: e.description, supports: e.supports, limitations: e.limitations, technical: e.technical, state: { disclosure: e.visibility === 'public' ? 'public' : 'private', submitted: false, reviewed: false, challenged: false, targetable: true } });
function room(): RoomView {
  const state = createGame(template, { defense: config(), prosecution: config() });
  return { code: 'ABC234', status: 'playing', you: 'a', hostId: 'a', case: publicCase(template), thinking: null, persistence: 'memory', notice: null, ownAiSettings: null, ownAction: null,
    players: (['defense', 'prosecution'] as const).map((side, i) => ({ id: i ? 'b' : 'a', side, nickname: side, connected: true, configured: true, ready: true, config: config(), loadout: config(), state: state.players[side], usage: { calls: 0, retries: 0, failures: 0, fallback: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 } })),
    publicEvidence: template.evidence.filter(e => e.visibility === 'public').map(viewEvidence), privateEvidence: template.evidence.filter(e => e.id === 'D04').map(viewEvidence), events: [],
    actionOptions: getActionOptions(template, state, 'defense'), game: { ...state, turnId: 'match:0', execution: 'awaiting_action' } };
}

describe('V1.1 authoritative cases and replay compatibility', () => {
  it('provides safe dispute/support/limits for all 21 materials without exposing rule weights', () => {
    expect(() => validateCases(CASES)).not.toThrow();
    for (const t of CASES) {
      expect(publicCase(t)).toMatchObject({ version: 4, dispute: t.dispute });
      expect(t.evidence.every(e => e.supports && e.limitations)).toBe(true);
      expect(JSON.stringify(publicCase(t))).not.toContain(t.truth);
    }
    const json = JSON.stringify(room()); expect(json).not.toMatch(/reliability|linkedIds|"flaw"|"strength"/);
    expect(json).not.toContain('演练许可单');
  });
  it.each([
    (t: CaseTemplate[]) => { t[1].id = t[0].id; },
    (t: CaseTemplate[]) => { t[0].evidence[0].linkedIds.push('D01'); },
    (t: CaseTemplate[]) => { t[0].threshold = 101; },
    (t: CaseTemplate[]) => { t[0].dispute = ''; },
    (t: CaseTemplate[]) => { t[0].evidence[0].visibility = 'other' as never; },
    (t: CaseTemplate[]) => { t[0].timelineRules![0].evidenceIds = ['P01', 'D01']; },
  ])('rejects an inconsistent template at startup', mutate => {
    const cases = structuredClone(CASES); mutate(cases); expect(() => validateCases(cases)).toThrow('案件模板校验失败');
  });
  it('rejects a mismatched case version without changing the game', () => {
    const s = createGame(template, { defense: config(), prosecution: config() }), frozen = structuredClone(s), c = command(s, 'defense:present', ['D04']);
    expect(() => prepareAction({ ...template, version: template.version + 1 }, s, 'defense', c, { turnId: c.turnId, actorId: 'a' })).toThrow('案件版本');
    expect(s).toEqual(frozen);
  });
  it('replays raw and presentation-enriched old-version records identically without rewriting reasons', () => {
    const old = { ...template, version: 3 }; let state = createGame(old, { defense: config(), prosecution: config() });
    for (let i = 0; i < 8; i++) { const c = manualChoice(old, state); const p = prepareAction(old, state, state.turn, c, { turnId: c.turnId, actorId: state.turn }); state = finalizeAction(p, p.action); }
    const recorded = structuredClone(state.events), visible = state.events.map(presentEvent);
    expect(replayGame(old, { defense: config(), prosecution: config() }, visible).verdict).toEqual(state.verdict);
    expect(state.events).toEqual(recorded);
    expect(playerText('逻辑稳定度降低，稳定度不足')).toBe('AI 冷静值降低，冷静值不足');
  });
  it('keeps model focus bound to the selected case, target and authorized evidence', () => {
    const s = createGame(template, { defense: config(), prosecution: config() }), c = command(s, 'defense:present', ['D04']);
    const p = prepareAction(template, s, 'defense', c, { turnId: c.turnId, actorId: 'a' });
    const prompt = buildPrompt(template, s, 'defense', config(), c, p.action, p.event.reason!);
    expect(presentEvent(p.event).presentation?.explanation).toContain('预设程序');
    const context = JSON.parse(prompt[1].content);
    expect(context.case).toMatchObject({ id: template.id, version: 4, dispute: template.dispute });
    expect(context.focus.selectedEvidenceIds).toEqual(['D04']);
    expect(context.evidence.find((e: { id: string }) => e.id === 'D04').limitations).toBeTruthy();
    expect(prompt[1].content).not.toMatch(/D05|D06|D07|P01|R01|"truth"|"flaw"/);
    expect(prompt[1].content.length).toBeLessThan(14000);
  });
});

describe('V1.1 consistent court state and available targets', () => {
  it.each(['finished', 'cancelled'] as const)('gives %s priority over disconnected players and cleared keys', status => {
    const r = room(); r.status = status; r.players.forEach(p => { p.connected = false; p.configured = false; }); r.notice = status === 'cancelled' ? '一位玩家主动退出，本局中止。' : null;
    r.game!.execution = status === 'finished' ? 'finished' : 'aborted'; if (status === 'finished') r.game!.phase = 'finished';
    expect(courtState(r, false)).toMatchObject({ kind: status === 'finished' ? 'finished' : 'aborted', canAct: false, terminal: true });
    const html = renderToStaticMarkup(createElement(CourtPage, { room: r, connected: false, catalog: null, onReport() {}, onReconnect() {}, onConfigure() {}, onLeave() {}, request: async <T,>() => ({} as T) }));
    expect(html).not.toMatch(/等待重连|等待双方重新连接|确认出招<\/button/);
    expect(html).toContain('返回大厅');
  });
  it('separates local disconnect, accepted generation, opponent offline and missing keys', () => {
    const r = room(); expect(courtState(r, true).kind).toBe('your_turn');
    r.players[1].connected = false; r.players[1].configured = false;
    expect(courtState(r, true).kind).toBe('opponent_offline');
    r.game!.execution = 'generating'; expect(courtState(r, true).kind).toBe('generating'); expect(courtState(r, false).kind).toBe('disconnected');
    r.game!.execution = 'resolving'; expect(courtState(r, true).kind).toBe('resolving');
    r.game!.execution = 'awaiting_action'; r.players[1].connected = true; expect(courtState(r, true).kind).toBe('model_missing');
    r.players[1].configured = true; r.game!.turn = 'prosecution'; expect(courtState(r, true).kind).toBe('opponent_turn');
  });
  it('shows only authorized evidence from the selected target and does not change state', () => {
    const r = room(), c = { ...r.actionOptions[0], enabled: true, targetRequired: true, actionType: 'counter_argument' as const, evidenceIds: ['D01', 'D02', 'P01'] };
    r.events = [{ id: 'target', kind: 'action', sequence: 1, round: 1, scoreAfter: 50, text: '公开发言', action: { speech: '公开发言', action_type: 'present_evidence', cited_evidence_ids: ['D02'], target_argument_id: null, item_id: null, tone: 'calm' } }];
    const before = structuredClone(r); expect(eligibleEvidenceIds(r, c, 'target')).toEqual(['D02']); expect(r).toEqual(before);
    expect(eligibleEvidenceIds(r, { ...c, enabled: false }, 'target')).toEqual([]);
  });
  it('explains a failed risk from its actual event while preserving raw text', () => {
    const e: GameEvent = { id: 'action', kind: 'action', sequence: 1, side: 'defense', round: 1, text: '律师发言', scoreAfter: 48, scoreDelta: 0, reason: '冒险论证未获得支持，稳定度降低 15 点。', random: { roll: 90, threshold: 60, qualified: true, succeeded: false } };
    const projected = presentEvent(e); expect(projected.presentation?.title).toContain('冒险'); expect(projected.presentation?.detailLines.join('')).toContain('90');
    expect(projected.presentation?.explanation).toContain('冷静值'); expect(e).not.toHaveProperty('presentation'); expect(e.reason).toContain('稳定度');
  });
});
