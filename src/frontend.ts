import type { AiConfig, GameEvent, PlayerView, RoomView } from '../shared/types';
import { PROVIDER_PRESETS } from '../shared/providers';
import { readLoadoutPreferences, readModelPreferences } from './preferences';

export type View = 'home' | 'room' | 'config' | 'court' | 'report';
export interface Route { view: View; section?: string; event?: string }
export type FieldErrors = Partial<Record<keyof AiConfig | 'nickname' | 'code' | 'caseId', string>>;
export const PROVIDERS = Object.fromEntries(PROVIDER_PRESETS.map(p => [p.id, p.name])) as Record<AiConfig['provider'], string>;
export function newActionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const ACTIONS: Record<string, string> = {
  investigate_lead: '调查线索', regain_composure: '整理思路',
  review_evidence: '重新检查证据', challenge_evidence: '质疑证据', timeline_analysis: '组合证据', counter_argument: '找出对方漏洞',
  present_evidence: '出示证据', cross_examination: '追问对方', closing_statement: '最终陈词', use_item: '使用特殊能力',
};
export const newConfig = (): AiConfig => ({
  provider: 'mock', baseUrl: '', model: 'scripted-expression-v2', personality: 'rigorous',
  strategy: 'evidence', identity: 'civilian', items: ['magnifier', 'coffee', 'firewall'],
  ...readModelPreferences(), ...readLoadoutPreferences(), apiKey: '',
});

export function parseRoute(hash: string): Route {
  const [name, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  if (name === 'loadout') return { view: 'config', section: 'equipment' };
  if (name === 'prepare') return { view: 'room' };
  const view: View = ['room', 'config', 'court', 'report'].includes(name) ? name as View : 'home';
  return { view, section: params.get('section') || undefined, event: params.get('event') || undefined };
}
export function routeHash(route: Route) {
  const params = new URLSearchParams();
  if (route.view === 'config' && route.section === 'equipment') params.set('section', 'equipment');
  if (route.view === 'court' && route.event) params.set('event', route.event);
  return `#${route.view}${params.size ? `?${params}` : ''}`;
}
export function availableRoute(route: Route, room: RoomView | null): { route: Route; notice?: string } {
  if (!room) return route.view === 'home' ? { route } : { route: { view: 'home' }, notice: '请先创建或加入房间。' };
  if (route.view === 'home') return { route: { view: 'room' } };
  if (route.view === 'court' && !room.game) return { route: { view: 'room' }, notice: '双方准备并开庭后，即可查看庭审实录。' };
  if (route.view === 'report' && (room.status !== 'finished' || !room.game?.verdict)) return { route: { view: room.game ? 'court' : 'room' }, notice: '对局结束后生成赛后报告。' };
  const me = room.players.find(p => p.id === room.you);
  if (route.view === 'config' && room.status !== 'waiting' && !(room.status === 'playing' && !me?.configured)) {
    return { route: { view: room.game ? 'court' : 'room' }, notice: '当前对局的配置已锁定。' };
  }
  return { route };
}
export function validateEntry(nickname: string, mode: 'create' | 'join', code: string, caseId: string): FieldErrors {
  const errors: FieldErrors = validateNickname(nickname);
  if (mode === 'join' && !/^[A-Z2-9]{6}$/.test(code.trim())) errors.code = '请输入六位房间码，仅包含字母与数字 2–9。';
  if (mode === 'create' && !caseId) errors.caseId = '请选择案件。';
  return errors;
}
export function validateNickname(nickname: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!nickname.trim()) errors.nickname = '请输入昵称。';
  else if (nickname.trim().length > 24 || /[\x00-\x1f\x7f<>]/.test(nickname)) errors.nickname = '昵称最多 24 字，不能包含尖括号或控制字符。';
  return errors;
}
export function validateConfig(config: AiConfig, secure: boolean, canReuseKey = false): FieldErrors {
  const errors: FieldErrors = {};
  if (!config.model.trim() || config.model.length > 120 || !/^[A-Za-z0-9_.:/@+ -]+$/.test(config.model)) errors.model = '请填写有效的模型 ID，最多 120 个字符。';
  if (config.provider !== 'mock') {
    if (!secure) errors.apiKey = '真实密钥仅能通过 HTTPS 提交。';
    else if ((!config.apiKey.trim() && !canReuseKey) || (config.apiKey.trim() && (!/^[\x21-\x7e]+$/.test(config.apiKey.trim()) || config.apiKey.length > 512))) errors.apiKey = '请填写有效的 API Key，或复用当前房间已保存的密钥。';
    if (config.apiKey.trim() && config.model.includes(config.apiKey.trim())) errors.model = '模型 ID 不能包含 API Key。';
    {
      try {
        const url = new URL(config.baseUrl);
        if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) throw new Error();
      } catch { errors.baseUrl = '请填写公网 HTTPS API 根地址，不含凭据、查询参数或非 443 端口。'; }
    }
    for (const field of ['inputPricePerMillion', 'outputPricePerMillion'] as const) {
      const value = config[field];
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 10000)) errors[field] = '单价应在 0–10000 之间。';
    }
  }
  return errors;
}
export function focusError(errors: FieldErrors) {
  requestAnimationFrame(() => {
    const field = document.getElementById(`field-${Object.keys(errors)[0]}`);
    const details = field?.closest('details');
    if (details) details.open = true;
    field?.focus();
  });
}
export const modelName = (p: PlayerView) => p.config ? `${PROVIDERS[p.config.provider]} / ${p.config.model}` : '尚未配置 AI';
export const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;
export const actionEvents = (events: GameEvent[]) => events.filter(e => e.kind === 'action');
export const formatPrice = (value: number | null) => value == null ? '未知 / 未配置价格或用量' : `约 ${new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 5 }).format(value)}`;
export function playerCost(player: PlayerView) {
  if (player.config?.provider === 'mock') return '¥0 · 预设模式';
  if (player.usage.inputTokens === 0 && player.usage.outputTokens === 0) return '未知 / 未报告用量或未调用';
  return formatPrice(player.usage.estimatedCost);
}
