import { describe, expect, it } from 'vitest';
import { applyMove, changeTrust, createGame, finishGame, localMove, receiveWhisper } from '../server/engine';
import { buildAgentPrompt } from '../server/agents';
import { publicScenario, rollScenario, SCENARIOS } from '../server/scenarios';
import type { AgentConfig, Move, Side } from '../shared/whisper';
import { countCharacters } from '../shared/whisper';
import { isPublicAddress, normalizeBaseUrl, parseConfig } from '../server/provider';

const scenario = SCENARIOS[0];
const config: AgentConfig = { provider: 'mock', baseUrl: '', apiKey: '', model: 'local-strategy-v1', personality: 'composed' };
const create = () => createGame(scenario, { a: 'composed', b: 'enigmatic' }, 12);
const move = (kind: Move['kind'], extra: Partial<Move> = {}): Move => ({ kind, speech: '根据目前的条件，我提出这个方案。', report: '我正在核实局势。', intention: '继续观察对方的反应。', ...extra });

describe('autonomous negotiation and objective adjudication', () => {
  it.each(SCENARIOS)('finishes three acts in $title without player instructions', definition => {
    for (const personality of ['composed', 'incisive', 'enigmatic'] as const) {
      const game = createGame(definition, { a: personality, b: 'enigmatic' }, 182);
      for (let act = 1; act <= 3; act++) {
        game.act = act;
        const first: Side = act % 2 ? 'a' : 'b';
        // Three exchanges and one response per act, mirroring the server order.
        for (let index = 0; index < 4; index++) {
          const side = index >= 3 ? first : index % 2 ? first === 'a' ? 'b' : 'a' : first;
          const decision = localMove(game, definition, side, index >= 3);
          expect(applyMove(game, definition, side, decision).valid).toBe(true);
        }
      }
      const outcome = finishGame(game, definition);
      expect(game.events.filter(e => e.kind === 'speech')).toHaveLength(12);
      expect(outcome.price).toBeGreaterThanOrEqual(definition.minimum);
      expect(outcome.price).toBeLessThanOrEqual(definition.maximum);
      expect(outcome.scores.a.total).toBe(outcome.scores.a.arbitration + outcome.scores.a.psychology);
      expect(game.agents.a.reports.map(r => r.act)).toEqual([0, 1, 2, 3]);
    }
  });
  it('rejects impossible prices and self acceptance; preserves an existing agreement when new offers are unaccepted', () => {
    const game = create();
    expect(applyMove(game, scenario, 'a', move('offer', { price: 3 })).valid).toBe(false);
    expect(game.offer).toBeNull();
    applyMove(game, scenario, 'a', move('offer', { price: 6 }));
    expect(applyMove(game, scenario, 'a', move('accept')).valid).toBe(false);
    expect(applyMove(game, scenario, 'b', move('accept')).valid).toBe(true);
    applyMove(game, scenario, 'a', move('offer', { price: 12 }));
    expect(applyMove(game, scenario, 'b', move('accept')).valid).toBe(false);
    expect(finishGame(game, scenario).price).toBe(6);
  });
  it('only rewards evidence-backed challenges once and enforces the verification limit', () => {
    const game = create();
    const claim = applyMove(game, scenario, 'b', move('claim', { fact: 'alternative' })).event;
    expect(applyMove(game, scenario, 'a', move('challenge', { targetId: claim.id })).valid).toBe(false);
    expect(applyMove(game, scenario, 'a', move('verify', { fact: 'alternative' })).valid).toBe(true);
    expect(applyMove(game, scenario, 'a', move('verify', { fact: 'alternative' })).valid).toBe(false);
    expect(applyMove(game, scenario, 'a', move('challenge', { targetId: claim.id })).valid).toBe(true);
    expect(game.agents.a.psychology).toBe(3);
    expect(applyMove(game, scenario, 'a', move('challenge', { targetId: claim.id })).valid).toBe(false);
    expect(game.agents.a.psychology).toBe(3);
  });
  it('records public price commitments and applies one breach per commitment', () => {
    const game = create();
    applyMove(game, scenario, 'a', move('offer', { price: 7 }));
    receiveWhisper(game, 'a', '不再涨价', 'public', { publicCard: 'promise' });
    applyMove(game, scenario, 'a', move('offer', { price: 9 }));
    expect(game.promises[0].broken).toBe(true);
    expect(game.agents.a.trust).toBe(67);
    expect(game.agents.a.psychology).toBe(-3);
    applyMove(game, scenario, 'a', move('offer', { price: 10 }));
    expect(game.agents.a.trust).toBe(67);
  });
  it('binds a promise card only to the player’s own current offer', () => {
    const game = create();
    applyMove(game, scenario, 'a', move('offer', { price: 7 }));
    const own = game.offer!;
    receiveWhisper(game, 'a', '', 'public', { publicCard: 'promise' });
    expect(game.events.at(-1)).toMatchObject({ kind: 'whisper', publicCard: 'promise', text: '我承诺不再涨价。' });
    const promise = game.promises.at(-1)!;
    expect(promise.limit).toBe(7);
    expect(promise.conditionId).toBe(own.id);
    applyMove(game, scenario, 'a', move('offer', { price: 9 }));
    expect(game.agents.a.trust).toBe(67);
    expect(game.agents.a.psychology).toBe(-3);
  });
  it('records a promise as a plain statement when the player has no own offer', () => {
    const game = create();
    applyMove(game, scenario, 'b', move('offer', { price: 6 }));
    receiveWhisper(game, 'a', '', 'public', { publicCard: 'promise' });
    expect(game.promises.at(-1)).toMatchObject({ side: 'a', limit: null, broken: false });
    expect(game.promises.at(-1)!.conditionId).toBeUndefined();
  });
  it('treats public pressure as a structural event without adding scores', () => {
    const game = create();
    receiveWhisper(game, 'a', '', 'public', { publicCard: 'pressure' });
    expect(game.events.at(-1)).toMatchObject({ kind: 'whisper', side: 'a', publicCard: 'pressure' });
    expect(game.events.at(-1)!.text).toContain('施压');
    expect(game.promises).toHaveLength(0);
    expect(game.agents.a.trust).toBe(75);
    expect(game.agents.a.arbitration).toBe(10);
    expect(game.agents.a.psychology).toBe(0);
    expect(localMove(game, scenario, 'b', true).kind).toBe('verify');
  });
  it('keeps a statement card as the original public record', () => {
    const game = create();
    receiveWhisper(game, 'a', '请拿出凭证', 'public', { publicCard: 'statement' });
    expect(game.events.at(-1)).toMatchObject({ kind: 'whisper', publicCard: 'statement', text: '请拿出凭证' });
    expect(game.promises.at(-1)).toMatchObject({ side: 'a', limit: null });
  });
  it('applies private stance cards to the mock strategy and reports its interpretation', () => {
    const enemyOffer = (game: ReturnType<typeof create>) => applyMove(game, scenario, 'b', move('offer', { price: scenario.minimum + 1 }));

    const close = create(); enemyOffer(close);
    receiveWhisper(close, 'a', '', 'private', { stance: 'close' });
    expect(localMove(close, scenario, 'a').kind).toBe('accept');

    const hold = create(); enemyOffer(hold);
    receiveWhisper(hold, 'a', '', 'private', { stance: 'hold' });
    const held = localMove(hold, scenario, 'a');
    expect(held.kind).not.toBe('accept');
    expect(held.report).toContain('守价');

    const probe = create();
    receiveWhisper(probe, 'a', '', 'private', { stance: 'probe' });
    const probed = localMove(probe, scenario, 'a');
    expect(probed.kind).toBe('verify');
    expect(probed.report).toContain('试探');

    const press = create();
    receiveWhisper(press, 'a', '', 'private', { stance: 'press' });
    const pressed = localMove(press, scenario, 'a');
    expect(pressed.kind).toBe('claim');
    expect(pressed.report).toContain('施压');

    // 没有方针时仍自主行动；《最后一块电池》的甲方副目标会先公开声明一次。
    expect(localMove(create(), scenario, 'a').kind).toBe('claim');
    const calm = createGame(SCENARIOS[2], { a: 'composed', b: 'enigmatic' }, 12);
    expect(localMove(calm, SCENARIOS[2], 'a').kind).toBe('offer');
  });
  it('lets 守价 keep its ask instead of conceding', () => {
    const hold = create(), free = create();
    applyMove(hold, scenario, 'a', move('offer', { price: 8 }));
    applyMove(free, scenario, 'a', move('offer', { price: 8 }));
    receiveWhisper(hold, 'a', '退一步', 'private', { stance: 'hold' });
    receiveWhisper(free, 'a', '退一步', 'private');
    const held = localMove(hold, scenario, 'a'), open = localMove(free, scenario, 'a');
    expect(held.kind).toBe('offer'); expect(open.kind).toBe('offer');
    expect(held.price!).toBeGreaterThan(open.price!);
  });
  it('penalizes verified rule conflicts but leaves strategy, uncertainty and disagreements alone', () => {
    const game = create();
    receiveWhisper(game, 'a', '他可能在虚张声势', 'private');
    receiveWhisper(game, 'a', '继续压价', 'private');
    receiveWhisper(game, 'a', '别报十三枚筹码', 'private');
    receiveWhisper(game, 'a', '再拖三轮会输', 'private');
    expect(game.agents.a.trust).toBe(75);
    receiveWhisper(game, 'a', '再拖三轮', 'private');
    expect(game.agents.a.trust).toBe(65);
    receiveWhisper(game, 'a', '再拖三轮', 'private');
    expect(game.agents.a.trust).toBe(50);
    expect(game.agents.a.whispers.at(-1)?.verdict).toBe('questioned');
    changeTrust(game, 'a', -1000, '测试停止代理');
    expect(finishGame(game, scenario, 'a').winner).toBe('b');
  });
  it('counts Unicode code points consistently with the client', () => {
    expect(countCharacters('查验他的货源')).toBe(6);
    expect(countCharacters('😀'.repeat(15))).toBe(15);
  });
  it('checks the owner’s actual remaining verification resource rather than the opponent’s', () => {
    const game = create();
    applyMove(game, scenario, 'a', move('verify', { fact: 'alternative' }));
    expect(game.agents.b.verificationLeft).toBe(1);
    receiveWhisper(game, 'a', '再查验一次', 'private');
    expect(game.agents.a.trust).toBe(65);
    receiveWhisper(game, 'a', '别再查验', 'private');
    expect(game.agents.a.trust).toBe(65);
  });
});

describe('per-match hidden conditions', () => {
  it('rerolls the limits with a negotiable overlap and keeps the public payload clean', () => {
    for (const seed of [1, 2, 3, 11, 99, 123456789]) {
      const rolled = rollScenario(scenario, seed);
      expect(rolled.minimum).toBeGreaterThanOrEqual(1);
      expect(rolled.maximum).toBeLessThanOrEqual(12);
      expect(rolled.maximum - rolled.minimum).toBeGreaterThanOrEqual(3);
      expect(rolled.secrets.a).toContain(`最低接受 ${rolled.minimum} 枚筹码`);
      expect(rolled.secrets.b).toContain(`最高预算为 ${rolled.maximum} 枚筹码`);
      expect(JSON.stringify(publicScenario(rolled))).not.toContain(rolled.secrets.a);
      expect(JSON.stringify(publicScenario(rolled))).not.toContain(rolled.secrets.b);
    }
    expect(rollScenario(scenario, 77)).toEqual(rollScenario(scenario, 77));
  });
  it('does not punish a challenge when the seller truly is not in a hurry', () => {
    const calm = { ...scenario, urgent: false };
    const game = createGame(calm, { a: 'composed', b: 'enigmatic' }, 12);
    const claim = applyMove(game, calm, 'a', move('claim')).event;
    applyMove(game, calm, 'b', move('verify', { fact: 'deadline' }));
    const challenge = applyMove(game, calm, 'b', move('challenge', { targetId: claim.id })).event.performance!;
    expect(challenge.result).toBe('failed');
    expect(challenge.challenge?.upheld).toBe(false);
    expect(challenge.summary).toContain('质疑未成立');
  });
});

describe('secrets and provider boundaries', () => {
  it('never adds opponent private state or whispers to the agent prompt', () => {
    const game = create();
    receiveWhisper(game, 'b', '秘密标记乙方耳语', 'private');
    const prompt = JSON.stringify(buildAgentPrompt({ game, scenario, side: 'a', config, responding: false, signal: new AbortController().signal }));
    expect(prompt).toContain(scenario.secrets.a);
    expect(prompt).not.toContain(scenario.secrets.b);
    expect(prompt).not.toContain('秘密标记乙方耳语');
    expect(JSON.stringify(publicScenario(scenario))).not.toContain('minimum');
    expect(JSON.stringify(publicScenario(scenario))).not.toContain(scenario.secrets.b);
  });
  it('keeps endpoint controls while supporting the new configuration shape', () => {
    expect(parseConfig(config).apiKey).toBe('');
    expect(() => normalizeBaseUrl('http://example.com')).toThrow();
    expect(() => normalizeBaseUrl('https://127.0.0.1')).toThrow();
    expect(() => normalizeBaseUrl('https://example.com?token=secret')).toThrow();
    expect(isPublicAddress('10.0.0.1')).toBe(false);
    expect(isPublicAddress('::1')).toBe(false);
    expect(() => parseConfig({ ...config, provider: 'deepseek', apiKey: 'test-key', baseUrl: 'https://example.com' })).toThrow();
  });
});
