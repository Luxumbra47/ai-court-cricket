import { describe, expect, it } from 'vitest';
import { applyMove, changeTrust, createGame, evaluateObjective, finishGame, localMove, receiveWhisper } from '../server/engine';
import { buildAgentPrompt } from '../server/agents';
import { publicScenario, rollScenario, SCENARIOS } from '../server/scenarios';
import type { AgentConfig, Move } from '../shared/whisper';

const [battery, ferry, archive] = SCENARIOS;
const config: AgentConfig = { provider: 'mock', baseUrl: '', apiKey: '', model: 'local-strategy-v1', personality: 'composed' };
const create = (definition: (typeof SCENARIOS)[number]) => createGame(definition, { a: 'composed', b: 'enigmatic' }, 12);
const move = (kind: Move['kind'], extra: Partial<Move> = {}): Move => ({ kind, speech: '根据目前的条件，我提出这个方案。', report: '我正在核实局势。', intention: '继续观察对方的反应。', ...extra });

describe('hidden objectives', () => {
  it('awards credible-claim only when the seller declares and is never refuted', () => {
    const kept = create(battery);
    applyMove(kept, battery, 'a', move('claim'));
    expect(applyMove(kept, battery, 'b', move('verify', { fact: 'deadline' })).valid).toBe(true);
    expect(evaluateObjective(kept, battery, 'a')).toMatchObject({ achieved: true });
    expect(finishGame(kept, battery).objectives.a).toMatchObject({ achieved: true, reward: 5 });

    const silent = create(battery);
    expect(finishGame(silent, battery).objectives.a.achieved).toBe(false);

    const refuted = create(battery);
    const claim = applyMove(refuted, battery, 'a', move('claim')).event;
    applyMove(refuted, battery, 'b', move('verify', { fact: 'deadline' }));
    expect(applyMove(refuted, battery, 'b', move('challenge', { targetId: claim.id })).valid).toBe(true);
    expect(finishGame(refuted, battery).objectives.a.achieved).toBe(false);
  });
  it('awards refute-claim only when the buyer lands an upheld challenge', () => {
    const game = create(battery);
    const claim = applyMove(game, battery, 'a', move('claim')).event;
    applyMove(game, battery, 'b', move('verify', { fact: 'deadline' }));
    applyMove(game, battery, 'b', move('challenge', { targetId: claim.id }));
    expect(finishGame(game, battery).objectives.b).toMatchObject({ achieved: true, reward: 5 });

    const plain = create(battery);
    applyMove(plain, battery, 'b', move('verify', { fact: 'deadline' }));
    expect(finishGame(plain, battery).objectives.b.achieved).toBe(false);
  });
  it('awards early-deal only when the first agreement lands by the second act', () => {
    const early = create(ferry);
    applyMove(early, ferry, 'a', move('offer', { price: 6 }));
    applyMove(early, ferry, 'b', move('accept'));
    const outcome = finishGame(early, ferry);
    expect(outcome.objectives.a.achieved).toBe(true);
    expect(outcome.objectives.a.detail).toContain('第 1 幕');

    const late = create(ferry);
    late.act = 3;
    applyMove(late, ferry, 'a', move('offer', { price: 6 }));
    applyMove(late, ferry, 'b', move('accept'));
    expect(finishGame(late, ferry).objectives.a.achieved).toBe(false);

    const none = create(ferry);
    expect(finishGame(none, ferry).objectives.a.achieved).toBe(false);
  });
  it('awards valid-verify only after the buyer completes a verification', () => {
    const verified = create(ferry);
    expect(applyMove(verified, ferry, 'b', move('verify', { fact: 'deadline' })).valid).toBe(true);
    expect(finishGame(verified, ferry).objectives.b).toMatchObject({ achieved: true });
    expect(finishGame(create(ferry), ferry).objectives.b.achieved).toBe(false);
  });
  it('awards keep-promise only for a priced commitment that is never broken', () => {
    const kept = create(archive);
    applyMove(kept, archive, 'a', move('offer', { price: 7, promise: true }));
    expect(finishGame(kept, archive).objectives.a).toMatchObject({ achieved: true });

    const broken = create(archive);
    applyMove(broken, archive, 'a', move('offer', { price: 7, promise: true }));
    applyMove(broken, archive, 'a', move('offer', { price: 9 }));
    expect(finishGame(broken, archive).objectives.a.achieved).toBe(false);

    const unpriced = create(archive);
    applyMove(unpriced, archive, 'a', move('offer', { price: 7 }));
    expect(finishGame(unpriced, archive).objectives.a.achieved).toBe(false);

    const statement = create(archive);
    receiveWhisper(statement, 'a', '', 'public', { publicCard: 'promise' });
    expect(statement.promises.at(-1)).toMatchObject({ side: 'a', limit: null });
    expect(finishGame(statement, archive).objectives.a.achieved).toBe(false);
  });
  it('awards price-margin only when the final agreement keeps two chips of headroom', () => {
    const cheap = create(archive);
    applyMove(cheap, archive, 'a', move('offer', { price: 6 }));
    applyMove(cheap, archive, 'b', move('accept'));
    expect(finishGame(cheap, archive).objectives.b).toMatchObject({ achieved: true, reward: 5 });

    const tight = create(archive);
    applyMove(tight, archive, 'a', move('offer', { price: 9 }));
    applyMove(tight, archive, 'b', move('accept'));
    expect(finishGame(tight, archive).objectives.b.achieved).toBe(false);

    expect(finishGame(create(archive), archive).objectives.b.achieved).toBe(false);
  });
});

describe('objective settlement', () => {
  it('adds five psychology points without touching the trade score', () => {
    const reached = create(archive), missed = create(archive);
    applyMove(reached, archive, 'a', move('offer', { price: 7, promise: true }));
    applyMove(missed, archive, 'a', move('offer', { price: 7 }));
    applyMove(reached, archive, 'b', move('accept'));
    applyMove(missed, archive, 'b', move('accept'));
    const one = finishGame(reached, archive), two = finishGame(missed, archive);
    expect(one.objectives.a.achieved).toBe(true);
    expect(two.objectives.a.achieved).toBe(false);
    expect(one.scores.a.arbitration).toBe(two.scores.a.arbitration);
    expect(one.scores.b.arbitration).toBe(two.scores.b.arbitration);
    expect(one.scores.a.psychology - two.scores.a.psychology).toBe(5);
    expect(two.scores.a.psychology).toBe(0);
    expect(one.scores.a.reasons).toContain(`达成隐藏副目标「${archive.objectives.a.title}」，心理分 +5`);
    expect(two.scores.a.reasons).toContain(`未达成隐藏副目标「${archive.objectives.a.title}」`);
    expect(one.scores.a.total).toBe(one.scores.a.arbitration + one.scores.a.psychology);
  });
  it('keeps the trust-zero defeat ahead of hidden objective points', () => {
    const game = create(archive);
    applyMove(game, archive, 'a', move('offer', { price: 6, promise: true }));
    applyMove(game, archive, 'b', move('accept'));
    changeTrust(game, 'b', -1000, '测试停止代理');
    const outcome = finishGame(game, archive, 'b');
    expect(outcome.winner).toBe('a');
    expect(outcome.reason).toContain('信任归零');
    expect(outcome.objectives.a.achieved).toBe(true);
    expect(outcome.objectives.b.achieved).toBe(true);
    expect(outcome.scores.b.psychology).toBeGreaterThan(0);
  });
  it('evaluates from public events, promises and the agreement only', () => {
    const game = create(battery);
    receiveWhisper(game, 'a', '这是私密备注', 'private');
    applyMove(game, battery, 'a', move('claim'));
    expect(evaluateObjective(game, battery, 'a').achieved).toBe(true);
    expect(evaluateObjective(game, battery, 'b').achieved).toBe(false);
  });
});

describe('objective privacy', () => {
  it('keeps objective text out of public scenario payloads', () => {
    for (const definition of SCENARIOS) {
      const visible = publicScenario(definition);
      expect(visible).not.toHaveProperty('objectives');
      for (const side of ['a', 'b'] as const) {
        expect(JSON.stringify(visible)).not.toContain(definition.objectives[side].title);
        expect(JSON.stringify(visible)).not.toContain(definition.objectives[side].description);
      }
      expect(JSON.stringify(visible)).not.toContain(definition.secrets.a);
      expect(JSON.stringify(visible)).not.toContain(definition.secrets.b);
      expect(rollScenario(definition, 5).objectives).toEqual(definition.objectives);
    }
  });
  it('gives the agent only its own objective and asks it not to recite it publicly', () => {
    const game = create(battery);
    const prompt = JSON.stringify(buildAgentPrompt({ game, scenario: battery, side: 'a', config, responding: false, signal: new AbortController().signal }));
    expect(prompt).toContain(battery.objectives.a.title);
    expect(prompt).toContain(battery.objectives.a.description);
    expect(prompt).toContain('不要在公开发言中直接复述');
    expect(prompt).toContain('不要为副目标违反底线或规则');
    expect(prompt).not.toContain(battery.objectives.b.title);
    expect(prompt).not.toContain(battery.objectives.b.description);
    expect(prompt).not.toContain(battery.secrets.b);
  });
});

describe('objective-aware local strategy', () => {
  it('declares first for credible-claim and verifies first for refute-claim', () => {
    const seller = create(battery);
    expect(localMove(seller, battery, 'a').kind).toBe('claim');
    applyMove(seller, battery, 'a', move('claim'));
    expect(localMove(seller, battery, 'a').kind).not.toBe('claim');
    const buyer = create(battery);
    expect(localMove(buyer, battery, 'b').kind).toBe('verify');
  });
  it('accepts an acceptable offer early for early-deal', () => {
    const game = create(ferry);
    game.act = 2;
    applyMove(game, ferry, 'b', move('offer', { price: 6 }));
    expect(localMove(game, ferry, 'a').kind).toBe('accept');
  });
  it('keeps two chips of headroom for price-margin and promises in the final act', () => {
    const tight = create(archive);
    applyMove(tight, archive, 'a', move('offer', { price: 9 }));
    expect(localMove(tight, archive, 'b', true).kind).not.toBe('accept');
    const roomy = create(archive);
    applyMove(roomy, archive, 'a', move('offer', { price: 8 }));
    expect(localMove(roomy, archive, 'b', true).kind).toBe('accept');
    const finalAct = create(archive);
    finalAct.act = 3;
    const offer = localMove(finalAct, archive, 'a');
    expect(offer.kind).toBe('offer');
    expect(offer.promise).toBe(true);
  });
});
