import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import type { AgentConfig as AiConfig } from '../shared/whisper.js';
import { getProviderPreset, PROVIDER_IDS } from '../shared/providers.js';

const configSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  baseUrl: z.string().max(500).default(''),
  apiKey: z.string().max(512).default(''),
  model: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_.:/@+ -]+$/),
  personality: z.enum(['composed', 'incisive', 'enigmatic']),
  inputPricePerMillion: z.number().min(0).max(10000).optional(),
  outputPricePerMillion: z.number().min(0).max(10000).optional(),
}).strict();

export function parseConfig(input: unknown): AiConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new LlmError('configuration');
  const config = parsed.data;
  if (config.provider === 'mock') return { ...config, apiKey: '', baseUrl: '' };
  if (!config.apiKey.trim() || !/^[\x21-\x7e]+$/.test(config.apiKey.trim())) throw new LlmError('configuration');
  config.apiKey = config.apiKey.trim();
  if (config.model.includes(config.apiKey)) throw new LlmError('configuration');
  config.baseUrl = providerBaseUrl(config.provider, config.baseUrl);
  if (config.baseUrl.includes(config.apiKey)) throw new LlmError('configuration');
  return config;
}

function providerBaseUrl(provider: string, baseUrl: string): string {
  const preset = getProviderPreset(provider);
  if (!preset || preset.id === 'mock') throw new LlmError('configuration');
  const normalized = normalizeBaseUrl(baseUrl.trim() || preset.baseUrl);
  const known = preset.allowedBaseUrls ?? [preset.baseUrl];
  const workspace = provider === 'qwen' && /^https:\/\/[a-zA-Z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com\/compatible-mode\/v1$/.test(normalized);
  if (!known.includes(normalized) && !workspace) throw new LlmError('blocked_endpoint');
  return normalized;
}

/** Reuse only this player's in-memory key, bound to the same vendor and exact endpoint. */
export function resolveConfig(input: unknown, previous?: AiConfig): AiConfig {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new LlmError('configuration');
  const candidate = parsed.data;
  if (candidate.provider !== 'mock' && !candidate.apiKey.trim() && previous?.apiKey &&
    candidate.provider === previous.provider && providerBaseUrl(candidate.provider, candidate.baseUrl) === providerBaseUrl(previous.provider, previous.baseUrl)) {
    return parseConfig({ ...candidate, apiKey: previous.apiKey });
  }
  return parseConfig(candidate);
}

export type ErrorCode = 'configuration' | 'blocked_endpoint' | 'invalid_key' | 'model_not_found' |
  'insufficient_quota' | 'rate_limited' | 'timeout' | 'unavailable' | 'invalid_json' | 'budget' | 'call_limit' | 'cancelled';
const ERROR_TEXT: Record<ErrorCode, string> = {
  configuration: '配置无效，请检查服务商、模型、密钥和代理人风格。',
  blocked_endpoint: '接口地址不可用：仅允许公网 HTTPS 地址，请检查域名或服务端白名单。',
  invalid_key: '密钥无效或无权访问该服务。',
  model_not_found: '模型或 API 路径不存在，请检查模型 ID 与 Base URL。',
  insufficient_quota: '服务商账户额度不足，请在服务商控制台检查。',
  rate_limited: '服务商请求过于频繁，请稍后再试。',
  timeout: '模型请求超时，本次将由本地策略代理接管。',
  unavailable: '模型服务暂不可用，本次将由本地策略代理接管。',
  invalid_json: '模型未返回有效的行动格式，本次将由本地策略代理接管。',
  budget: '已达到服务端每日请求或预算上限，将由本地策略代理接管。',
  call_limit: '已达到本局模型调用上限，将由本地策略代理接管。',
  cancelled: '模型调用已取消。',
};
export class LlmError extends Error {
  constructor(readonly code: ErrorCode) { super(ERROR_TEXT[code]); this.name = 'LlmError'; }
}
function safeError(error: unknown): LlmError { return error instanceof LlmError ? error : new LlmError('unavailable'); }

export function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (url.port && url.port !== '443') || url.pathname.length > 200) throw new Error();
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(hostname) ||
      (isIP(hostname) && !isPublicAddress(hostname))) throw new Error();
    const allowlist = (process.env.LLM_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowlist.length && !allowlist.includes(hostname)) throw new Error();
    return url.toString().replace(/\/+$/, '');
  } catch { throw new LlmError('blocked_endpoint'); }
}

const denied4 = new BlockList();
const denied6 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) denied4.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) denied6.addSubnet(address, prefix, 'ipv6');
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !denied4.check(address, 'ipv4') : family === 6 ? !denied6.check(address, 'ipv6') : false;
}

async function publicEndpoint(baseUrl: string, timeoutMs: number) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/chat/completions`);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new LlmError('timeout')), timeoutMs); }),
    ]);
    if (!addresses.length || addresses.some(row => !isPublicAddress(row.address))) throw new LlmError('blocked_endpoint');
    return { url, address: addresses[0]!.address, family: addresses[0]!.family };
  } catch (error) { throw error instanceof LlmError ? error : new LlmError('unavailable'); }
  finally { if (timer) clearTimeout(timer); }
}

export interface Message { role: 'system' | 'user'; content: string }
export interface ProviderReply { content: string; inputTokens: number | null; outputTokens: number | null }
export interface ProviderAdapter {
  complete(config: AiConfig, messages: Message[], options: { timeoutMs: number; maxOutputTokens: number; signal?: AbortSignal }): Promise<ProviderReply>;
}

function classifyStatus(status: number, body: unknown): LlmError {
  // Only inspect known error codes; never return upstream text, URLs, or headers to clients/logs.
  const code = z.object({ error: z.object({ code: z.union([z.string(), z.number()]).optional(), type: z.string().optional() }).passthrough() })
    .safeParse(body);
  const label = code.success ? String(code.data.error.code || code.data.error.type || '').toLowerCase() : '';
  if (status === 401 || status === 403) return new LlmError('invalid_key');
  if (status === 402 || /quota|balance|credit|insufficient/.test(label)) return new LlmError('insufficient_quota');
  if (status === 404 || /model.*(not|invalid|unknown)/.test(label)) return new LlmError('model_not_found');
  if (status === 429) return new LlmError('rate_limited');
  return new LlmError('unavailable');
}

export function providerRequestBody(config: AiConfig, messages: Message[], maxOutputTokens: number): Record<string, unknown> {
  const preset = getProviderPreset(config.provider);
  if (!preset || preset.protocol !== 'chat-completions') throw new LlmError('configuration');
  const tokenField = config.provider === 'sensenova' && config.baseUrl.includes('/compatible-mode/v2') ? 'max_completion_tokens' : preset.tokenField;
  const body: Record<string, unknown> = { model: config.model, messages, stream: false, [tokenField]: maxOutputTokens };
  if (preset.jsonMode) body.response_format = { type: 'json_object' };
  // Thinking fields differ by vendor and model family. Never send one vendor's extension to another.
  if (config.provider === 'qwen' && /^(qwen3|qwen-plus|qwen-flash)/i.test(config.model)) body.enable_thinking = false;
  if (config.provider === 'doubao' || config.provider === 'mimo') body.thinking = { type: 'disabled' };
  if (config.provider === 'zhipu' && /^glm-(4\.[5-9]|[5-9])/i.test(config.model)) body.thinking = { type: 'disabled' };
  if (config.provider === 'kimi') {
    if (/^kimi-k2\.(5|6)(?:-|$)/i.test(config.model)) body.thinking = { type: 'disabled' };
    if (/^kimi-k3/i.test(config.model)) body.reasoning_effort = 'low';
  }
  if (config.provider === 'siliconflow' && /(?:^|\/)Qwen3/i.test(config.model)) body.enable_thinking = false;
  return body;
}

export class DomesticLlmAdapter implements ProviderAdapter {
  async complete(config: AiConfig, messages: Message[], options: { timeoutMs: number; maxOutputTokens: number; signal?: AbortSignal }): Promise<ProviderReply> {
    if (options.signal?.aborted) throw new LlmError('cancelled');
    const started = Date.now();
    const endpoint = await publicEndpoint(providerBaseUrl(config.provider, config.baseUrl), options.timeoutMs);
    if (options.signal?.aborted) throw new LlmError('cancelled');
    const remaining = options.timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw new LlmError('timeout');
    const payload = JSON.stringify(providerRequestBody(config, messages, options.maxOutputTokens));
    const body = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      // DNS is pinned to an address already checked above. Redirects are never followed.
      const req = request(endpoint.url, {
        method: 'POST', agent: false,
        lookup: (_hostname, options, callback) => {
          const cb = callback as unknown as (...args: unknown[]) => void;
          if (typeof options === 'object' && options.all) cb(null, [{ address: endpoint.address, family: endpoint.family }]);
          else cb(null, endpoint.address, endpoint.family);
        },
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`, 'Content-Length': Buffer.byteLength(payload) },
      }, response => {
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65536) { req.destroy(new LlmError('unavailable')); return; }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ status: response.statusCode || 503, text: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', () => reject(new LlmError('unavailable')));
      });
      const timer = setTimeout(() => req.destroy(new LlmError('timeout')), remaining);
      const abort = () => req.destroy(new LlmError('cancelled'));
      options.signal?.addEventListener('abort', abort, { once: true });
      req.on('close', () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); });
      req.on('error', error => reject(safeError(error)));
      req.end(payload);
    });
    let data: unknown;
    try { data = JSON.parse(body.text); } catch { throw new LlmError(body.status >= 400 ? 'unavailable' : 'invalid_json'); }
    if (body.status < 200 || body.status >= 300) throw classifyStatus(body.status, data);
    const logical = z.object({ base_resp: z.object({ status_code: z.number() }) }).safeParse(data);
    if (logical.success && logical.data.base_resp.status_code !== 0) {
      const code = logical.data.base_resp.status_code;
      throw new LlmError(code === 1004 || code === 2049 ? 'invalid_key' : code === 1008 ? 'insufficient_quota' : code === 1002 ? 'rate_limited' : 'unavailable');
    }
    const parsed = z.object({
      choices: z.array(z.object({ message: z.object({ content: z.string().max(16000) }) })).min(1),
      usage: z.object({ prompt_tokens: z.number().int().min(0).max(1000000), completion_tokens: z.number().int().min(0).max(1000000) }).optional(),
    }).safeParse(data);
    if (!parsed.success) throw new LlmError('invalid_json');
    return { content: parsed.data.choices[0]!.message.content,
      inputTokens: parsed.data.usage?.prompt_tokens ?? null, outputTokens: parsed.data.usage?.completion_tokens ?? null };
  }
}

function numberSetting(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 && value !== undefined && value !== '' ? Math.min(parsed, max) : fallback;
}

export class DailyBudget {
  private day = ''; private used = 0; private reserved = 0;
  private broken = false; private filePath?: string;
  readonly limit: number; readonly maxRequests: number; readonly unknownReserve: number;
  constructor(options: { limit?: number; maxRequests?: number; unknownReserve?: number; filePath?: string } = {}) {
    this.limit = options.limit ?? numberSetting(process.env.DAILY_BUDGET, 5, 100000);
    this.maxRequests = options.maxRequests ?? numberSetting(process.env.DAILY_CALL_LIMIT, 200, 100000);
    this.unknownReserve = options.unknownReserve ?? numberSetting(process.env.UNKNOWN_CALL_RESERVE, 0.05, 1000);
    this.filePath = options.filePath;
    if (this.filePath && existsSync(this.filePath)) {
      try {
        const saved = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), requests: z.number().int().min(0), reserved: z.number().min(0) })
          .strict().parse(JSON.parse(readFileSync(this.filePath, 'utf8')));
        this.day = saved.day; this.used = saved.requests; this.reserved = saved.reserved;
      } catch { this.broken = true; }
    }
  }
  private reset() { const day = new Date().toISOString().slice(0, 10); if (day !== this.day) { this.day = day; this.used = 0; this.reserved = 0; } }
  reserve(config: AiConfig, inputLength: number, outputLimit: number): boolean {
    this.reset();
    if (this.broken) return false;
    // A conservative operational cap, not a claim about provider billing. Every retry/test also reserves.
    const priced = config.inputPricePerMillion !== undefined && config.outputPricePerMillion !== undefined
      ? (inputLength * config.inputPricePerMillion + outputLimit * config.outputPricePerMillion) / 1000000 : 0;
    const cost = Math.max(this.unknownReserve, priced);
    if (this.used >= this.maxRequests || this.reserved + cost > this.limit + 1e-10) return false;
    this.used++; this.reserved += cost;
    if (this.filePath) {
      try {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp`;
        writeFileSync(temp, JSON.stringify({ day: this.day, requests: this.used, reserved: this.reserved }), { mode: 0o600 });
        renameSync(temp, this.filePath);
      } catch { this.broken = true; return false; }
    }
    return true;
  }
  snapshot() { this.reset(); return { day: this.day, requests: this.used, reserved: this.reserved, limit: this.limit, maxRequests: this.maxRequests }; }
}

