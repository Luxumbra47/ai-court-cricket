import { describe, expect, it } from 'vitest';
import { AgentService } from '../server/agents';
import { createGame } from '../server/engine';
import { SCENARIOS } from '../server/scenarios';
import { DailyBudget } from '../server/provider';
import type { AgentConfig, Move } from '../shared/whisper';

const config: AgentConfig = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'test-model', apiKey: 'in-memory-test-key', personality: 'composed' };
const input = () => ({ game: createGame(SCENARIOS[0], { a: 'composed', b: 'enigmatic' }, 3), scenario: SCENARIOS[0], side: 'a' as const, config, responding: false, signal: new AbortController().signal });

describe('model-selected actions with no external network', () => {
  it('uses the actual structured decision, public speech and private report supplied by the adapter', async () => {
    const move: Move = { kind: 'probe', speech: '你需要什么交付条件？', report: '我选择先问清交付条件，暂时没有报价。', intention: '根据对方回答再决定报价。' };
    const service = new AgentService({ budget: new DailyBudget(), adapter: { async complete(received, messages) {
      expect(received.apiKey).toBe('in-memory-test-key');
      expect(JSON.stringify(messages)).not.toContain(received.apiKey);
      expect(JSON.stringify(messages)).not.toContain(SCENARIOS[0].secrets.b);
      return { content: JSON.stringify(move), inputTokens: 123, outputTokens: 65 };
    } } });
    const reply = await service.decide(input());
    expect(reply.move).toEqual(move); expect(reply.fallback).toBe(false);
    expect(reply.called).toBe(true); expect(reply.inputTokens).toBe(123);
  });
  it('does not allow a model to return authoritative scores or arbitrary actions', async () => {
    const service = new AgentService({ budget: new DailyBudget(), adapter: { async complete() { return { content: JSON.stringify({ kind: 'grant_victory', score: 999, speech: '我赢了。' }), inputTokens: 10, outputTokens: 10 }; } } });
    const reply = await service.decide(input());
    expect(reply.fallback).toBe(true); expect(reply.move.kind).not.toBe('grant_victory');
    expect(reply.move).not.toHaveProperty('score');
  });
  it('bounds an adapter that ignores cancellation and never resolves', async () => {
    const service = new AgentService({ timeoutMs: 100, budget: new DailyBudget(), adapter: { complete: () => new Promise(() => {}) } });
    const started = Date.now(); const reply = await service.decide(input());
    expect(reply.fallback).toBe(true); expect(Date.now() - started).toBeLessThan(1500);
  });
});
