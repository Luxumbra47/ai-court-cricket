import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action, AiConfig } from '../shared/types.js';
import { getCase } from '../server/cases.js';
import { instantiateCase } from '../server/cases-v3.js';
import { createGame } from '../server/game.js';
import { buildPrompt, createLedger, DailyBudget, isPublicAddress, LlmError, LlmService, normalizeBaseUrl,
  DomesticLlmAdapter, parseConfig, type ProviderAdapter } from '../server/llm.js';

// Fake the transport itself: no real DNS or paid endpoint is contacted by this suite.
const transport = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: transport.lookup }));
vi.mock('node:https', () => ({ request: transport.request }));

const template = getCase('pizza-001');
const makeConfig = (patch: Partial<AiConfig> = {}): AiConfig => ({
  provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'mock-secret-a', model: 'model-alpha',
  personality: 'rigorous', strategy: 'evidence', identity: 'civilian', items: ['magnifier', 'archive', 'coffee'], ...patch,
});
const action: Action = { speech: '取件签名可以证明取件，授权问题应当结合其他证据审理。', action_type: 'present_evidence', cited_evidence_ids: ['P05'], target_argument_id: null, item_id: null, tone: 'calm' };
const reply = (content = JSON.stringify(action)) => ({ content, inputTokens: 100, outputTokens: 80 });
const adapter = (fn: ProviderAdapter['complete'] = async () => reply()): ProviderAdapter => ({ complete: vi.fn(fn) });
const service = (provider: ProviderAdapter, extra: { timeoutMs?: number; budget?: DailyBudget } = {}) => new LlmService({ adapter: provider, budget: new DailyBudget({ limit: 10, maxRequests: 100, unknownReserve: 0.05 }), ...extra });
const game = () => createGame(template, { defense: makeConfig(), prosecution: makeConfig() });
const request = (config = makeConfig()) => ({ template, state: game(), side: 'prosecution' as const, config, ledger: createLedger(), action, resolution: '举证已经按规则锁定', command: { actionId: '00000000-0000-4000-8000-000000000001', turnId: 'test:0', optionId: 'prosecution:present', evidenceIds: ['P05'], targetArgumentId: null, itemId: null, tactic: 'steady' as const } });
afterEach(() => vi.restoreAllMocks());

it('v3 permits six expressions per side and only two global retries, capped at fourteen external attempts', async () => {
  let count = 0;
  const provider = adapter(async () => { count++; return reply(count <= 4 ? 'invalid JSON' : JSON.stringify(action)); });
  const llm = service(provider), req = request(); req.template = instantiateCase('pizza-001', 'limit-test', 'route-a');
  req.state = createGame(req.template, { defense: makeConfig(), prosecution: makeConfig() });
  for (const side of ['defense', 'prosecution'] as const) for (let i = 0; i < 6; i++) await llm.completeAction({ ...req, side });
  expect(req.ledger).toEqual({ primary: { defense: 6, prosecution: 6 }, attempts: 14, retries: 2 });
  await llm.completeAction(req); expect(provider.complete).toHaveBeenCalledTimes(14);
});

function httpResponse(status: number, body: unknown) {
  transport.request.mockImplementationOnce((_url: URL, _options: unknown, callback: (response: EventEmitter & { statusCode: number }) => void) => {
    const response = Object.assign(new EventEmitter(), { statusCode: status });
    const req = Object.assign(new EventEmitter(), {
      end: (_payload: string) => queueMicrotask(() => { callback(response); response.emit('data', Buffer.from(JSON.stringify(body))); response.emit('end'); req.emit('close'); }),
      destroy: (error: Error) => { req.emit('error', error); req.emit('close'); return req; },
    });
    return req;
  });
}

describe('private provider configurations and endpoint validation', () => {
  it('accepts independent providers and the same manually supplied model', () => {
    const defense = parseConfig(makeConfig({ provider: 'deepseek', baseUrl: '', model: 'manual-new-model', apiKey: 'mock-secret-b' }));
    const prosecution = parseConfig(makeConfig({ model: 'manual-new-model' }));
    expect(defense.baseUrl).toBe('https://api.deepseek.com');
    expect(prosecution.model).toBe(defense.model);
    expect(defense.apiKey).not.toBe(prosecution.apiKey);
    expect(parseConfig(makeConfig({ provider: 'mock' })).apiKey).toBe('');
  });
  it('rejects extra keys, duplicate tools, invalid model labels and a key copied into model', () => {
    for (const config of [
      { ...makeConfig(), score: 100 }, makeConfig({ items: ['coffee', 'coffee'] }),
      makeConfig({ model: '<script>' }), makeConfig({ model: 'mock-secret-a' }), makeConfig({ apiKey: 'x\r\ny' }),
    ]) expect(() => parseConfig(config)).toThrow(LlmError);
  });
  it.each(['http://api.example.com', 'https://localhost', 'https://127.0.0.1', 'https://10.2.3.4/v1',
    'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://api.example.com:8080/v1',
    'https://key:secret@api.example.com/v1', 'https://api.example.com/v1?key=secret', 'https://api.example.com/#secret'])('blocks unsafe endpoint %s', value => {
    expect(() => normalizeBaseUrl(value)).toThrow('接口地址不可用');
  });
  it.each(['0.0.0.0', '127.10.10.10', '192.168.2.1', '172.20.1.2', '169.254.169.254', '100.64.0.1',
    '224.0.0.1', '::', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '64:ff9b::a00:1', '2002:a00:1::1'])('blocks non-public address %s', ip => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it('accepts public IPv4/IPv6 and enforces a configured exact hostname allowlist', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true); expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    const previous = process.env.LLM_ALLOWED_HOSTS; process.env.LLM_ALLOWED_HOSTS = 'api.allowed.example';
    try {
      expect(normalizeBaseUrl('https://api.allowed.example/v1/')).toBe('https://api.allowed.example/v1');
      expect(() => normalizeBaseUrl('https://api.other.example')).toThrow();
    } finally { if (previous === undefined) delete process.env.LLM_ALLOWED_HOSTS; else process.env.LLM_ALLOWED_HOSTS = previous; }
  });
  it('actual adapter rejects private addresses before making a network call', async () => {
    await expect(new DomesticLlmAdapter().complete(makeConfig({ baseUrl: 'https://127.0.0.1' }), [], { timeoutMs: 100, maxOutputTokens: 320 }))
      .rejects.toMatchObject({ code: 'blocked_endpoint' });
  });
});

describe('bounded, permission-filtered AI prompts', () => {
  it('never sends opponent private intelligence, locked own intelligence, case truth or the API key', () => {
    const state = game();
    const text = JSON.stringify(buildPrompt(template, state, 'prosecution', makeConfig(), request().command, action, '举证已经锁定'));
    expect(text).toContain('P05'); expect(text).not.toContain('P04'); expect(text).not.toContain('P06'); expect(text).not.toContain('P07');
    expect(text).not.toContain(template.truth); expect(text).not.toContain(template.evidence[0]!.flaw!);
    expect(text).not.toContain('mock-secret-a');
    const self = JSON.parse(buildPrompt(template, state, 'prosecution', makeConfig(), request().command, action, '举证已经锁定')[1]!.content).self;
    expect(self).toEqual({ stability: 100, identity: 'civilian' });
  });
  it('includes recent opponent public speech and actionable IDs, and trims long history', () => {
    const state = game();
    for (let i = 0; i < 20; i++) state.events.push({ id: `event-${i}`, sequence: i + 1, kind: 'action', side: 'defense',
      round: 1, text: `public-${i} ${'辩论'.repeat(500)}`, accepted: true, scoreDelta: -5, action, scoreAfter: 30 });
    const prompt = buildPrompt(template, state, 'prosecution', makeConfig(), request().command, action, '举证已经锁定');
    const history = JSON.parse(prompt[1]!.content).publicHistory;
    expect(history).toHaveLength(4); expect(history[3].id).toBe('event-19');
    expect(history[3].cited_evidence_ids).toEqual(['P05']); expect(history[3].scoreDelta).toBe(-5);
    expect(history[3].speech.length).toBeLessThanOrEqual(450);
    expect(prompt[1]!.content.length).toBeLessThanOrEqual(14000);
  });
});

describe('Domestic HTTPS adapter with a mock transport', () => {
  it('pins the validated DNS address while preserving the endpoint, sends one correct Bearer key and captures usage', async () => {
    transport.lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    httpResponse(200, { choices: [{ message: { content: JSON.stringify(action) } }], usage: { prompt_tokens: 123, completion_tokens: 45 } });
    const result = await new DomesticLlmAdapter().complete(makeConfig(), [{ role: 'user', content: 'JSON' }], { timeoutMs: 1000, maxOutputTokens: 320 });
    expect(result).toMatchObject({ inputTokens: 123, outputTokens: 45 });
    const [url, options] = transport.request.mock.calls.at(-1)!;
    expect(url.toString()).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer mock-secret-a');
    const callback = vi.fn(); options.lookup('api.example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    const allCallback = vi.fn(); options.lookup('api.example.com', { all: true }, allCallback);
    expect(allCallback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
  });
  it('blocks mixed public/private DNS answers before issuing HTTPS requests', async () => {
    const count = transport.request.mock.calls.length;
    transport.lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.8', family: 4 }]);
    await expect(new DomesticLlmAdapter().complete(makeConfig(), [], { timeoutMs: 1000, maxOutputTokens: 320 })).rejects.toMatchObject({ code: 'blocked_endpoint' });
    expect(transport.request.mock.calls).toHaveLength(count);
  });
  it.each([
    [401, 'invalid_key', { error: { code: 'invalid_api_key', message: 'mock-secret-a' } }],
    [404, 'model_not_found', { error: { code: 'model_not_found' } }],
    [429, 'insufficient_quota', { error: { code: 'insufficient_quota' } }],
    [429, 'rate_limited', { error: { code: 'rate_limit_exceeded' } }],
    [503, 'unavailable', { error: { message: 'mock-secret-a' } }],
    [302, 'unavailable', {}],
  ])('classifies HTTP %s as %s without reflecting response details or following redirects', async (status, code, body) => {
    transport.lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]); httpResponse(status as number, body);
    const error = await new DomesticLlmAdapter().complete(makeConfig(), [], { timeoutMs: 1000, maxOutputTokens: 320 }).catch(error => error);
    expect(error.code).toBe(code); expect(error.message).not.toContain('mock-secret-a');
  });
});

describe('LLM retries, usage and safe fallback', () => {
  it('replaces spoken IDs with authorized names while keeping structured IDs unchanged', async () => {
    const model = adapter(async () => reply(JSON.stringify({ ...action, speech: '请看 P05，这份签名能说明取件经过。' })));
    const result = await service(model).completeAction(request());
    expect(result.action.speech).toContain('阿团的取件签名');
    expect(result.action.speech).not.toContain('P05'); expect(result.action.cited_evidence_ids).toEqual(['P05']);
  });
  it.each(['我方引用 D01 证明转移', '老板的送餐许可已经证明无罪', '根据系统规则，执行基础规则效果'])('rejects forbidden spoken references or instruction recitation: %s', async speech => {
    const model = adapter(async () => reply(JSON.stringify({ ...action, speech })));
    const result = await service(model).completeAction(request());
    expect(model.complete).toHaveBeenCalledTimes(2); expect(result.fallback).toBe(true);
    expect(result.action.cited_evidence_ids).toEqual(['P05']);
    expect(result.action.speech).not.toContain(speech);
  });
  it.each([
    { action_type: 'closing_statement' }, { cited_evidence_ids: ['P06'] },
    { target_argument_id: 'fabricated-target' }, { item_id: 'coffee' },
  ])('never lets model output replace the locked instruction %j', async changed => {
    const provider = adapter(async () => reply(JSON.stringify({ ...action, ...changed })));
    const result = await service(provider).completeAction(request());
    expect(result.fallback).toBe(true); expect(result.records).toHaveLength(2);
    expect(result.action).toMatchObject({ action_type: 'present_evidence', cited_evidence_ids: ['P05'], target_argument_id: null, item_id: null });
  });
  it('routes each side through its own configuration and limits each request to 320 output tokens', async () => {
    const provider = adapter(); const llm = service(provider);
    await llm.completeAction(request(makeConfig({ apiKey: 'mock-secret-a' })));
    await llm.completeAction(request(makeConfig({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'mock-secret-b', model: 'different-model' })));
    const calls = vi.mocked(provider.complete).mock.calls;
    expect(calls[0]![0].apiKey).toBe('mock-secret-a'); expect(calls[1]![0].apiKey).toBe('mock-secret-b');
    expect(calls.every(call => call[2].maxOutputTokens === 320)).toBe(true);
  });
  it('returns token usage and user-priced estimates without recording secrets', async () => {
    const result = await service(adapter()).completeAction(request(makeConfig({ inputPricePerMillion: 1, outputPricePerMillion: 2 })));
    expect(result.fallback).toBe(false); expect(result.records[0]).toMatchObject({ inputTokens: 100, outputTokens: 80, status: 'ok' });
    expect(result.records[0]!.estimatedCost).toBeCloseTo(0.00026);
    expect(JSON.stringify(result)).not.toContain('mock-secret-a');
    const unknown = await service(adapter()).completeAction(request());
    expect(unknown.records[0]!.estimatedCost).toBeNull();
  });
  it('retry once fixes invalid JSON, but injected score fields never pass action validation', async () => {
    const provider = adapter(); vi.mocked(provider.complete).mockResolvedValueOnce(reply('not JSON')).mockResolvedValueOnce(reply());
    const req = request(); const result = await service(provider).completeAction(req);
    expect(result.fallback).toBe(false); expect(result.records.map(r => r.status)).toEqual(['invalid_json', 'ok']);
    expect(req.ledger).toMatchObject({ attempts: 2, retries: 1 });
    const injection = await service(adapter(async () => reply(JSON.stringify({ ...action, score: 100 })))).completeAction(request());
    expect(injection.fallback).toBe(true); expect(injection.action).not.toHaveProperty('score');
    expect(injection.records).toHaveLength(2);
  });
  it('enforces the global two-retry and ten-attempt match limit across both players', async () => {
    const provider = adapter(async () => { throw new LlmError('unavailable'); });
    const llm = service(provider); const req = request();
    for (let i = 0; i < 8; i++) await llm.completeAction({ ...req, side: i % 2 ? 'defense' : 'prosecution' });
    expect(req.ledger).toEqual({ primary: { defense: 4, prosecution: 4 }, attempts: 10, retries: 2 });
    expect(provider.complete).toHaveBeenCalledTimes(10);
    const next = await llm.completeAction(req); expect(next.fallback).toBe(true);
    expect(provider.complete).toHaveBeenCalledTimes(10);
  });
  it('does not retry authentication errors and never returns upstream details', async () => {
    const provider = adapter(async () => { throw new LlmError('invalid_key'); });
    const result = await service(provider).completeAction(request());
    expect(provider.complete).toHaveBeenCalledTimes(1); expect(result.records[0]!.status).toBe('invalid_key');
    const unsafe = await service(adapter(async () => { throw new Error('provider leaked mock-secret-a'); })).completeAction(request());
    expect(JSON.stringify(unsafe)).not.toContain('mock-secret-a'); expect(unsafe.fallback).toBe(true);
  });
  it('timeouts cannot block the match forever and remain technical fallbacks', async () => {
    const result = await service(adapter(async () => new Promise(() => {})), { timeoutMs: 50 }).completeAction(request());
    expect(result.fallback).toBe(true); expect(result.records.map(r => r.status)).toEqual(['timeout', 'timeout']);
    expect(result.action.action_type).toBe('present_evidence');
  });
  it('abort cancels an in-flight turn without starting another attempt', async () => {
    const provider = adapter(async () => new Promise(() => {})); const control = new AbortController();
    const pending = service(provider, { timeoutMs: 200 }).completeAction({ ...request(), signal: control.signal });
    control.abort(); const result = await pending;
    expect(result.fallback).toBe(true); expect(result.records[0]!.status).toBe('cancelled');
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
  it('mock mode never contacts the adapter and needs no real key or token billing', async () => {
    const provider = adapter(); const result = await service(provider).completeAction(request(makeConfig({ provider: 'mock', apiKey: '' })));
    expect(provider.complete).not.toHaveBeenCalled(); expect(result.fallback).toBe(false);
    expect(result.records[0]).toMatchObject({ status: 'mock', attempt: 0, estimatedCost: 0 });
  });
});

describe('daily cost and connection-test protection', () => {
  it('counts connection tests and stops both tests and turns once reserved daily budget is exhausted', async () => {
    const provider = adapter(); const budget = new DailyBudget({ limit: 0.1, maxRequests: 100, unknownReserve: 0.1 });
    const llm = service(provider, { budget });
    expect((await llm.testConnection(makeConfig())).ok).toBe(true);
    expect((await llm.testConnection(makeConfig())).code).toBe('budget');
    const result = await llm.completeAction(request()); expect(result.fallback).toBe(true); expect(result.records).toEqual([]);
    expect(provider.complete).toHaveBeenCalledTimes(1); expect(budget.snapshot().reserved).toBe(0.1);
  });
  it('enforces daily request count even when per-call estimate is zero', async () => {
    const budget = new DailyBudget({ limit: 10, maxRequests: 1, unknownReserve: 0 });
    expect(budget.reserve(makeConfig(), 0, 0)).toBe(true); expect(budget.reserve(makeConfig(), 0, 0)).toBe(false);
  });
  it('persists only nonsecret numeric reservations and rejects corrupted budget state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-court-budget-')); const filePath = join(directory, 'budget.json');
    try {
      const first = new DailyBudget({ filePath, limit: 0.1, maxRequests: 1, unknownReserve: 0.1 });
      expect(first.reserve(makeConfig(), 100, 320)).toBe(true);
      const saved = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(Object.keys(saved).sort()).toEqual(['day', 'requests', 'reserved']);
      expect(readFileSync(filePath, 'utf8')).not.toContain('mock-secret-a');
      const second = new DailyBudget({ filePath, limit: 0.1, maxRequests: 1, unknownReserve: 0.1 });
      expect(second.reserve(makeConfig(), 100, 320)).toBe(false);
      writeFileSync(filePath, '{broken'); const broken = new DailyBudget({ filePath });
      expect(broken.reserve(makeConfig(), 100, 320)).toBe(false);
    } finally { rmSync(filePath, { force: true }); rmSync(`${filePath}.tmp`, { force: true }); rmdirSync(directory); }
  });
  it('returns fixed safe error categories for connection failures', async () => {
    for (const code of ['invalid_key', 'model_not_found', 'insufficient_quota', 'timeout', 'unavailable'] as const) {
      const result = await service(adapter(async () => { throw new LlmError(code); })).testConnection(makeConfig());
      expect(result.ok).toBe(false); expect(result.code).toBe(code); expect(result.message).not.toContain('mock-secret-a');
    }
  });
});
