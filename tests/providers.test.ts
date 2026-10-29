import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOMESTIC_PROVIDERS, getProviderPreset, PROVIDER_IDS, PROVIDER_PRESETS } from '../shared/providers.js';
import type { AiConfig } from '../shared/types.js';
import { DomesticLlmAdapter, parseConfig, providerRequestBody, resolveConfig } from '../server/llm.js';

const transport = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: transport.lookup }));
vi.mock('node:https', () => ({ request: transport.request }));
const modelConfig = (id = 'deepseek', patch: Partial<AiConfig> = {}): AiConfig => {
  const preset = getProviderPreset(id)!;
  return { provider: preset.id, model: preset.defaultModel || preset.modelExamples[0] || 'console-model-id',
    baseUrl: preset.baseUrl, apiKey: 'test-only-secret-never-a-real-key', personality: 'rigorous', strategy: 'evidence', identity: 'civilian', items: [], ...patch };
};
afterEach(() => { vi.clearAllMocks(); });
const response = (body: unknown) => {
  let payload = '';
  transport.lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
  transport.request.mockImplementationOnce((_url: URL, _options: unknown, callback: (response: EventEmitter & { statusCode: number }) => void) => {
    const outgoing = Object.assign(new EventEmitter(), { statusCode: 200 });
    const req = Object.assign(new EventEmitter(), {
      end: (value: string) => { payload = value; queueMicrotask(() => { callback(outgoing); outgoing.emit('data', Buffer.from(JSON.stringify(body))); outgoing.emit('end'); req.emit('close'); }); },
      destroy: (error: Error) => { req.emit('error', error); req.emit('close'); return req; },
    });
    return req;
  });
  return () => JSON.parse(payload) as Record<string, unknown>;
};

describe('domestic provider catalogue and safe saved-credential reuse', () => {
  it('contains nineteen named domestic services, offline mode, and no generic foreign-provider entry', () => {
    const documentedEndpoints: Record<string, string> = {
      deepseek: 'https://api.deepseek.com', qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      doubao: 'https://ark.cn-beijing.volces.com/api/v3', kimi: 'https://api.moonshot.cn/v1',
      zhipu: 'https://open.bigmodel.cn/api/paas/v4', baidu: 'https://qianfan.baidubce.com/v2',
      hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1', spark: 'https://spark-api-open.xf-yun.com/v1',
      minimax: 'https://api.minimax.cn/v1', stepfun: 'https://api.stepfun.com/v1', yi: 'https://api.lingyiwanwu.com/v1',
      baichuan: 'https://api.baichuan-ai.com/v1', sensenova: 'https://token.sensenova.cn/v1',
      siliconflow: 'https://api.siliconflow.cn/v1', modelscope: 'https://api-inference.modelscope.cn/v1',
      internlm: 'https://chat.intern-ai.org.cn/api/v1', '360': 'https://api.360.cn/v1',
      mimo: 'https://api.xiaomimimo.com/v1', huawei: 'https://api.modelarts-maas.com/openai/v1',
    };
    expect(DOMESTIC_PROVIDERS).toHaveLength(19);
    expect(Object.fromEntries(DOMESTIC_PROVIDERS.map(p => [p.id, p.baseUrl]))).toEqual(documentedEndpoints);
    expect(new Set(PROVIDER_IDS).size).toBe(PROVIDER_PRESETS.length);
    expect(PROVIDER_IDS).toContain('qwen'); expect(PROVIDER_IDS).toContain('doubao'); expect(PROVIDER_IDS).toContain('kimi');
    expect(PROVIDER_IDS).toContain('mimo'); expect(PROVIDER_IDS).toContain('huawei');
    expect(PROVIDER_IDS).not.toContain('openai-compatible');
    expect(() => parseConfig({ ...modelConfig(), provider: 'openai-compatible' })).toThrow('配置无效');
    expect(DOMESTIC_PROVIDERS.every(p => p.documentationUrl.startsWith('https://'))).toBe(true);
  });
  it.each(DOMESTIC_PROVIDERS)('normalizes $name without needing a user to type the official endpoint', preset => {
    expect(parseConfig(modelConfig(preset.id, { baseUrl: '' })).baseUrl).toBe(preset.baseUrl);
    expect(parseConfig(modelConfig(preset.id, { baseUrl: `${preset.baseUrl}/` })).baseUrl).toBe(preset.baseUrl);
  });
  it('keeps an already saved same-vendor/same-endpoint key when changing only model and strategy', () => {
    const saved = parseConfig(modelConfig());
    const changed = resolveConfig(modelConfig('deepseek', { apiKey: '', model: 'new-manual-model', strategy: 'rebuttal', baseUrl: `${saved.baseUrl}/` }), saved);
    expect(changed.apiKey).toBe(saved.apiKey); expect(changed.model).toBe('new-manual-model');
    expect(changed.strategy).toBe('rebuttal'); expect(changed.baseUrl).toBe(saved.baseUrl);
  });
  it('never reuses a key after vendor, endpoint, or room-memory credential has changed', () => {
    const saved = parseConfig(modelConfig());
    expect(() => resolveConfig(modelConfig('qwen', { apiKey: '' }), saved)).toThrow('配置无效');
    expect(() => resolveConfig(modelConfig('deepseek', { apiKey: '', baseUrl: 'https://api.deepseek.com/v1' }), saved)).toThrow('配置无效');
    expect(() => resolveConfig(modelConfig('deepseek', { apiKey: '' }), { ...saved, apiKey: '' })).toThrow('配置无效');
    expect(() => resolveConfig(modelConfig('deepseek', { apiKey: '' }))).toThrow('配置无效');
  });
  it('cannot send a saved domestic credential to an arbitrary replacement host or a different provider URL', () => {
    for (const baseUrl of ['https://api.openai.com/v1', 'https://api.example.com/v1', 'https://api.deepseek.com.attacker.example', 'https://dashscope.aliyuncs.com/compatible-mode/v1']) {
      expect(() => parseConfig(modelConfig('deepseek', { baseUrl }))).toThrow('接口地址不可用');
      expect(() => resolveConfig(modelConfig('deepseek', { apiKey: '', baseUrl }), modelConfig())).toThrow();
    }
  });
  it('allows documented Beijing workspace endpoints but rejects unanchored suffixes and workspace paths', () => {
    const baseUrl = 'https://llm-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
    expect(parseConfig(modelConfig('qwen', { baseUrl })).baseUrl).toBe(baseUrl);
    for (const wrong of [baseUrl.replace('.com/', '.com.evil.example/'), baseUrl.replace('cn-beijing', 'us-east-1'), baseUrl + '/another-path']) {
      expect(() => parseConfig(modelConfig('qwen', { baseUrl: wrong }))).toThrow('接口地址不可用');
    }
    expect(() => parseConfig(modelConfig('qwen', { apiKey: 'sk-not-a-workspace', baseUrl: 'https://sk-not-a-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }))).toThrow('配置无效');
  });
});

describe('documented vendor-specific request payloads (mock HTTPS only)', () => {
  it.each(DOMESTIC_PROVIDERS)('$name sends its exact endpoint, own credential, bounded output and parses usage', async preset => {
    const getBody = response({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 17, completion_tokens: 9 } });
    const config = parseConfig(modelConfig(preset.id));
    const reply = await new DomesticLlmAdapter().complete(config, [{ role: 'system', content: 'Only JSON.' }], { timeoutMs: 1000, maxOutputTokens: 320 });
    expect(reply).toEqual({ content: '{"ok":true}', inputTokens: 17, outputTokens: 9 });
    const [url, options] = transport.request.mock.calls.at(-1)!;
    expect(url.toString()).toBe(`${preset.baseUrl}/chat/completions`);
    expect(options.headers.Authorization).toBe(`Bearer ${config.apiKey}`);
    const body = getBody(); expect(body[preset.tokenField]).toBe(320); expect(body.stream).toBe(false);
    expect(body.model).toBe(config.model); expect(body.temperature).toBeUndefined();
    expect(body.response_format).toEqual(preset.jsonMode ? { type: 'json_object' } : undefined);
  });
  it('only applies vendor- and model-specific thinking controls', () => {
    expect(providerRequestBody(modelConfig('qwen', { model: 'qwen-plus' }), [], 320)).toHaveProperty('enable_thinking', false);
    expect(providerRequestBody(modelConfig('qwen', { model: 'deepseek-v3' }), [], 320)).not.toHaveProperty('enable_thinking');
    expect(providerRequestBody(modelConfig('doubao'), [], 320)).toHaveProperty('thinking', { type: 'disabled' });
    expect(providerRequestBody(modelConfig('mimo'), [], 320)).toHaveProperty('thinking', { type: 'disabled' });
    expect(providerRequestBody(modelConfig('kimi', { model: 'kimi-k2.6' }), [], 320)).toHaveProperty('thinking', { type: 'disabled' });
    expect(providerRequestBody(modelConfig('kimi', { model: 'kimi-k2.7-code' }), [], 320)).not.toHaveProperty('thinking');
    expect(providerRequestBody(modelConfig('kimi', { model: 'kimi-k3.1-pro' }), [], 320)).toHaveProperty('reasoning_effort', 'low');
    expect(providerRequestBody(modelConfig('kimi', { model: 'moonshot-v1-8k' }), [], 320)).not.toHaveProperty('thinking');
    expect(providerRequestBody(modelConfig('internlm'), [], 320)).not.toHaveProperty('response_format');
    expect(providerRequestBody(modelConfig('minimax'), [], 320)).not.toHaveProperty('response_format');
  });
  it('supports the documented legacy SenseNova endpoint without reusing the modern token-limit field', () => {
    const config = parseConfig(modelConfig('sensenova', { baseUrl: 'https://api.sensenova.cn/compatible-mode/v2' }));
    expect(providerRequestBody(config, [], 320)).toHaveProperty('max_completion_tokens', 320);
    expect(providerRequestBody(config, [], 320)).not.toHaveProperty('max_tokens');
  });
  it.each([[1004, 'invalid_key'], [1008, 'insufficient_quota'], [1002, 'rate_limited']])('classifies MiniMax logical HTTP-200 error %s safely', async (statusCode, expectedCode) => {
    response({ base_resp: { status_code: statusCode, status_msg: 'test-only-secret-never-a-real-key' } });
    const error = await new DomesticLlmAdapter().complete(modelConfig('minimax'), [], { timeoutMs: 1000, maxOutputTokens: 320 }).catch(e => e);
    expect(error.code).toBe(expectedCode); expect(error.message).not.toContain('test-only-secret');
  });
});
