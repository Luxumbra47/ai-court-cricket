import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NegotiationStage from '../src/components/NegotiationStage';
import { TableArchive } from '../src/components/TableArchive';
import { applyMove, createGame, receiveWhisper } from '../server/engine';
import { SCENARIOS } from '../server/scenarios';
import { actionUnits, ACTOR_STATES, rebuildTable } from '../shared/stage';
import type { Move, RoomView } from '../shared/whisper';

const move = (kind: Move['kind'], extra: Partial<Move> = {}): Move => ({ kind, speech: '这句对白声称已成交，查验成功，质疑成立。', report: '私密汇报不能公开', intention: '私密计划不能公开', ...extra });
const create = () => createGame(SCENARIOS[0], { a: 'composed', b: 'enigmatic' }, 42);

describe('adjudicated public performances and reconstruction', () => {
  it('maps all seven actions, groups speech/results once, and never infers outcomes from speech', () => {
    const game = create();
    const claim = applyMove(game, SCENARIOS[0], 'b', move('claim'), 1).event;
    applyMove(game, SCENARIOS[0], 'a', move('probe', { targetId: claim.id }), 1);
    applyMove(game, SCENARIOS[0], 'a', move('verify', { fact: 'alternative' }), 1);
    applyMove(game, SCENARIOS[0], 'a', move('challenge', { targetId: claim.id }), 1);
    applyMove(game, SCENARIOS[0], 'a', move('offer', { price: 6, promise: true }), 1);
    applyMove(game, SCENARIOS[0], 'b', move('accept'), 1);
    applyMove(game, SCENARIOS[0], 'b', move('wait'), 1);
    const units = actionUnits([...game.events, ...game.events]);
    expect(units).toHaveLength(7);
    expect(new Set(units.map(u => u.kind)).size).toBe(7);
    expect(Object.keys(ACTOR_STATES)).toHaveLength(7);
    expect(units.every(u => u.segmentId === 1 && u.act === 1)).toBe(true);
    expect(units[1].target).toEqual({ type: 'claim', id: claim.id });
    const table = rebuildTable(game.events);
    expect(table.claims[0].status).toBe('refuted');
    expect(table.challenges[0].evidenceId).toBe(table.evidence[0].id);
    expect(table.agreement?.price).toBe(6);
    expect(table.promises[0].broken).toBe(false);
    const serialized = JSON.stringify(units);
    for (const forbidden of ['私密汇报不能公开', '私密计划不能公开', 'trust', 'tendencies', 'minimum', 'maximum']) expect(serialized).not.toContain(forbidden);
  });
  it('keeps unverified claims unknown and only highlights explicit public targets', () => {
    const game = create();
    const claim = applyMove(game, SCENARIOS[0], 'b', move('claim')).event;
    expect(claim.performance?.claim).not.toHaveProperty('truth');
    expect(rebuildTable(game.events).claims[0].status).toBe('unknown');
    const probe = applyMove(game, SCENARIOS[0], 'a', move('probe', { speech: '我追问有其他货源这条声明' })).event;
    expect(probe.performance?.target).toBeUndefined();
    const secretTarget = applyMove(game, SCENARIOS[0], 'a', move('probe', { targetId: 'private-report-id' })).event;
    expect(secretTarget.performance?.target).toBeUndefined();
  });
  it('does not animate an invalid proposal or a failed challenge as success', () => {
    const game = create();
    const invalid = applyMove(game, SCENARIOS[0], 'a', move('offer', { price: 0 })).event.performance!;
    expect(invalid).toMatchObject({ kind: 'offer', valid: false, result: 'failed' });
    expect(invalid.summary).toContain('提议未生效');
    expect(rebuildTable(game.events).offer).toBeNull();
    const scenario = SCENARIOS[2];
    const trueGame = createGame(scenario, { a: 'composed', b: 'enigmatic' });
    const claim = applyMove(trueGame, scenario, 'b', move('claim')).event;
    applyMove(trueGame, scenario, 'a', move('verify', { fact: 'alternative' }));
    const challenge = applyMove(trueGame, scenario, 'a', move('challenge', { targetId: claim.id })).event.performance!;
    expect(challenge).toMatchObject({ valid: true, result: 'failed', challenge: { upheld: false } });
    expect(challenge.summary).toContain('质疑未成立');
    expect(rebuildTable(trueGame.events).claims[0].status).toBe('unknown');
    expect(rebuildTable(trueGame.events).evidence).toHaveLength(1);
  });
  it('reconstructs refresh and historical seeks without replacing an agreement with a unilateral offer', () => {
    const game = create();
    const first = applyMove(game, SCENARIOS[0], 'a', move('offer', { price: 6 })).event;
    applyMove(game, SCENARIOS[0], 'b', move('accept'));
    applyMove(game, SCENARIOS[0], 'a', move('offer', { price: 7 }));
    expect(rebuildTable(game.events).agreement?.price).toBe(6);
    expect(rebuildTable(game.events).offer?.price).toBe(7);
    expect(rebuildTable(game.events, first.id).agreement).toBeNull();
    expect(rebuildTable(JSON.parse(JSON.stringify(game.events)))).toEqual(rebuildTable(game.events));
    applyMove(game, SCENARIOS[0], 'b', move('accept'));
    expect(rebuildTable(game.events).agreement?.price).toBe(7);
  });
  it('replays price seals and actual breaches at the action that caused them', () => {
    const game = create();
    const first = applyMove(game, SCENARIOS[0], 'a', move('offer', { price: 6, promise: true })).event;
    receiveWhisper(game, 'a', '不再涨价', 'public', { publicCard: 'promise' });
    expect(rebuildTable(game.events).promises).toHaveLength(2);
    applyMove(game, SCENARIOS[0], 'a', move('offer', { price: 8 }));
    expect(rebuildTable(game.events).promises.every(p => p.broken)).toBe(true);
    expect(rebuildTable(game.events, first.id).promises[0].broken).toBe(false);
    expect(actionUnits(game.events).at(-1)?.breaches).toHaveLength(2);
  });
});

describe('public stage rendering', () => {
  afterEach(() => vi.unstubAllGlobals());
  function room(game: ReturnType<typeof create>, scenario = SCENARIOS[0]) {
    return { code: 'ABC234', act: 1, phase: 'public', events: game.events, agents: [], you: 'a', scenario, thinking: null, playback: null } as unknown as RoomView;
  }
  function renderTable(game: ReturnType<typeof create>, scenario = SCENARIOS[0]) {
    const units = actionUnits(game.events);
    return renderToStaticMarkup(createElement(TableArchive, { room: room(game, scenario), table: rebuildTable(game.events), selected: units.at(-1), step: 3, units, review: null, setReview: () => {}, staged: false, outcomeVisible: true }));
  }
  function render(game: ReturnType<typeof create>, scenario = SCENARIOS[0]) {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    return renderToStaticMarkup(createElement(NegotiationStage, { room: room(game, scenario), connected: true, request: async <T,>() => undefined as T, reduceMotion: true }));
  }
  it('renders a rejected proposal without a successful price card or dialogue-based adjudication', () => {
    const game = create();
    applyMove(game, SCENARIOS[0], 'a', move('offer', { price: 0 }));
    const html = renderTable(game);
    expect(html).toContain('提议未生效'); expect(html).toContain('等待出价');
    expect(html).not.toContain('双方已接受'); expect(html).not.toContain('私密计划不能公开');
    expect(render(game)).toContain('data-action="wait"');
  });
  it('renders an unsuccessful challenge with both original objects and an explicit failure', () => {
    const game = create(), scenario = SCENARIOS[2];
    const claim = applyMove(game, scenario, 'b', move('claim')).event;
    applyMove(game, scenario, 'a', move('verify', { fact: 'alternative' }));
    applyMove(game, scenario, 'a', move('challenge', { targetId: claim.id }));
    const html = renderTable(game, scenario);
    expect(html).toContain('质疑未成立'); expect(html).toContain('被质疑声明'); expect(html).toContain('引用凭证');
    expect(html).not.toContain('已被反证'); expect(html).toContain('data-upheld="false"');
  });
  it('keeps a visible gate with the start label while the automatic stage prepares', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const game = create();
    const room = { code: 'ABC234', act: 1, phase: 'exchange', events: game.events, agents: [], you: 'a', scenario: SCENARIOS[0], thinking: null, playback: { id: 1, act: 1, lastActionId: null, waiting: true, expiresAt: null, completed: false, peerCompleted: true } } as unknown as RoomView;
    const html = renderToStaticMarkup(createElement(NegotiationStage, { room, connected: true, request: async <T,>() => undefined as T, reduceMotion: true }));
    expect(html).toContain('演出推进'); expect(html).toContain('本回合等待开始'); expect(html).toContain('开始本回合交锋');
    expect(html).toContain('暂停演出'); expect(html).not.toContain('data-playing-id');
  });
});
