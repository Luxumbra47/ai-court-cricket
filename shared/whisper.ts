import type { ProviderId } from './providers.js';

export type Side = 'a' | 'b';
export type Personality = 'composed' | 'incisive' | 'enigmatic';
export type Phase = 'whisper' | 'exchange' | 'public' | 'response' | 'finished' | 'cancelled';
export type Channel = 'private' | 'public';
/** A private directive card. It authorises the agent, it never overrides the engine rules. */
export type Stance = 'hold' | 'probe' | 'press' | 'close';
/** A public card. Only the promise card can bind a price in the existing promise ledger. */
export type PublicCard = 'promise' | 'pressure' | 'statement';
export const SIDE_NAMES: Record<Side, string> = { a: '甲方', b: '乙方' };
export const AGENT_NAMES: Record<Side, string> = { a: '维恩', b: '赛芙' };
export const STANCES: Record<Stance, { name: string; description: string }> = {
  hold: { name: '守价', description: '本幕不主动让价，只在明显有利时接受报价。' },
  probe: { name: '试探', description: '优先追问或查验，不轻易改变自己的价格。' },
  press: { name: '施压', description: '优先声明或质疑，主动向对方制造压力。' },
  close: { name: '成交', description: '在底线内优先接受；无合适报价时给出接近目标的方案。' },
};
export const PUBLIC_CARDS: Record<PublicCard, { name: string; description: string }> = {
  promise: { name: '承诺', description: '若已有本方报价则绑定价格；违约按原规则扣信任与心理分。' },
  pressure: { name: '施压', description: '生成双方可见的公开施压事件，让代理人更倾向查验或质疑。' },
  statement: { name: '表态', description: '只记录公开话语，不自动判定履约。' },
};
export const PERSONALITIES: Record<Personality, { name: string; description: string }> = {
  composed: { name: '沉静', description: '耐心查证，重视稳妥的结果。' },
  incisive: { name: '锋利', description: '主动施压，敢于争取更大收益。' },
  enigmatic: { name: '莫测', description: '善于试探，习惯保留自己的筹码。' },
};
export const ACT_NAMES = ['试探', '交锋', '决断'];
export const PHASE_NAMES: Record<Phase, string> = {
  whisper: '耳语时刻', exchange: '代理人交锋中', public: '公开低语', response: '代理人正在回应', finished: '本局落幕', cancelled: '对局已中止',
};
export interface AgentConfig {
  provider: ProviderId; baseUrl: string; model: string; apiKey: string; personality: Personality;
  inputPricePerMillion?: number; outputPricePerMillion?: number;
}
export type ConfigView = Omit<AgentConfig, 'apiKey'>;
export interface Scenario {
  id: string; title: string; subtitle: string; kind: string; introduction: string; object: string;
  publicFacts: string[]; roles: Record<Side, string>;
}
export type MoveKind = 'offer' | 'probe' | 'verify' | 'claim' | 'challenge' | 'accept' | 'wait';
export type FactId = 'alternative' | 'deadline';
export interface Move {
  kind: MoveKind; price?: number; fact?: FactId; targetId?: string; promise?: boolean;
  speech: string; report: string; intention: string;
}
export interface PublicEvent {
  id: string; act: number; side?: Side; kind: 'speech' | 'action' | 'whisper' | 'system';
  text: string; action?: MoveKind; price?: number; fact?: FactId; at: number;
  performance?: ActionUnit; actionId?: string; publicPromise?: PromiseEntry; publicCard?: PublicCard;
}
export interface PublicTarget { type: 'claim' | 'offer'; id: string }
export interface PublicClaim { id: string; side: Side; fact: FactId; text: string }
export interface PublicEvidence { id: string; fact: FactId; text: string }
export interface PublicOffer { id: string; side: Side; price: number }
export interface PublicAgreement { id: string; offerId: string; price: number; acceptedBy: Side }
/** A public, adjudicated action. Never put private agent state into this payload. */
export interface ActionUnit {
  id: string; segmentId: number; act: number; side: Side; kind: MoveKind;
  result: 'success' | 'failed' | 'noop'; valid: boolean; speech: string; summary: string;
  target?: PublicTarget; offer?: PublicOffer; claim?: PublicClaim; evidence?: PublicEvidence;
  challenge?: { claimId: string; evidenceId: string; upheld: boolean; contradiction: string };
  agreement?: PublicAgreement; promises: PromiseEntry[]; breaches: string[];
}
export interface PlaybackSegment { id: number; act: number; lastActionId: string | null; waiting: boolean; expiresAt: number | null; completed: boolean; peerCompleted: boolean }
export interface Report { id: string; act: number; text: string; intention: string; at: number }
export interface Whisper {
  id: string; act: number; channel: Channel; side: Side; text: string;
  verdict: 'considered' | 'questioned' | 'pending'; reason?: string;
  stance?: Stance; publicCard?: PublicCard;
}
export interface TrustChange { id: string; act: number; delta: number; reason: string }
export interface PromiseEntry { id: string; side: Side; act: number; text: string; limit: number | null; broken: boolean; conditionId?: string }
export type ObjectiveKind = 'credible-claim' | 'refute-claim' | 'early-deal' | 'valid-verify' | 'keep-promise' | 'price-margin';
/** A hidden per-side objective. Achievement is only projected after the match. */
export interface ObjectiveView { title: string; description: string; reward: number; achieved?: boolean; detail?: string }
export interface Score { arbitration: number; psychology: number; total: number; reasons: string[] }
export interface AgentView {
  side: Side; name: string; nickname: string; ready: boolean; online: boolean; bot: boolean; configured: boolean;
  personality: Personality | null;
}
export interface OwnView {
  side: Side; trust: number; changes: TrustChange[]; reports: Report[]; whispers: Whisper[];
  secret: string; goal: string; verificationLeft: number; config: ConfigView; objective: ObjectiveView;
}
export interface Outcome {
  winner: Side | 'draw'; reason: string; price: number | null;
  scores: Record<Side, Score>; secrets: Record<Side, string>; whispers: Whisper[];
  objectives: Record<Side, ObjectiveView>;
  turningPoints: { eventId: string; title: string; detail: string }[];
}
export interface RoomView {
  code: string; host: Side; you: Side; practice: boolean; status: 'waiting' | 'playing' | 'finished' | 'cancelled';
  scenario: Scenario; agents: AgentView[]; own: OwnView; act: number; phase: Phase; deadline: number | null;
  submitted: Record<Channel, boolean>; peerSubmitted: Record<Channel, boolean>;
  events: PublicEvent[]; promises: PromiseEntry[]; thinking: Side | null;
  offer: { side: Side; price: number } | null; agreement: number | null;
  outcome: Outcome | null; notice: string | null;
  usage: { calls: number; fallbacks: number; inputTokens: number; outputTokens: number };
  playback: PlaybackSegment | null;
}
export interface Session { code: string; side: Side; token: string }
export interface Entry { session: Session; room: RoomView }
export interface Ack<T = unknown> { ok: boolean; data?: T; error?: string }
export const other = (side: Side): Side => side === 'a' ? 'b' : 'a';
export const countCharacters = (text: string): number => Array.from(text).length;
