export type Side = 'defense' | 'prosecution';
export type Difficulty = 'beginner' | 'standard' | 'complex';
export const DIFFICULTIES: Record<Difficulty, string> = { beginner: '新手案件', standard: '标准案件', complex: '复杂案件' };
export type TrialStage = 'investigation' | 'debate' | 'closing' | 'finished';
export const STAGE_NAMES: Record<TrialStage, string> = { investigation: '调查与准备', debate: '交叉质询与辩论', closing: '最终陈词', finished: '庭审结束' };
export type MatchMode = 'casual' | 'standard' | 'hardcore';
export const MATCH_MODES: Record<MatchMode, { label: string; description: string }> = {
  casual: { label: '详细提示', description: '显示可确定的数值、条件范围、风险与代价；不改变案件难度。' },
  standard: { label: '标准提示', description: '显示方向、条件与风险，隐藏数值预测；不改变案件难度。' },
  hardcore: { label: '硬核提示', description: '只显示用途、目标、条件和消耗，自行判断效果。' },
};
export type Personality = 'rigorous' | 'aggressive' | 'cunning' | 'chaotic';
export type Strategy = 'evidence' | 'rebuttal' | 'cautious' | 'free';
export type Identity = 'civilian' | 'tycoon' | 'scientist';
export type ItemId = 'magnifier' | 'coffee' | 'archive' | 'interrogate' | 'firewall' | 'extension';
export type ActionType = 'challenge_evidence' | 'timeline_analysis' | 'counter_argument' | 'present_evidence' | 'cross_examination' | 'closing_statement' | 'use_item' | 'review_evidence' | 'investigate_lead' | 'regain_composure';
export type Tactic = 'steady' | 'assertive' | 'risky' | 'logical_summary' | 'evidence_rebuttal' | 'forceful_closing' | 'risky_closing';
export interface ActionCommand {
  actionId: string; turnId: string; optionId: string; evidenceIds: string[];
  targetArgumentId: string | null; itemId: ItemId | null; tactic: Tactic; previewId?: string;
  leadIds?: string[];
}
export type ActionDraft = Omit<ActionCommand, 'actionId' | 'previewId'>;
export interface ActionForecast {
  certainty: 'certain' | 'conditional'; direction: string; conditions: string[]; risks: string[];
  score?: [number, number]; selfCalm?: [number, number]; opponentCalm?: [number, number]; probability?: number;
  note?: string;
  meltdownProbability?: number;
}
export interface ActionPreview {
  previewId: string; turnId: string; mode: MatchMode; purpose: string; targets: string[];
  requirements: string[]; costs: string[]; disclosure: string[]; forecast?: ActionForecast;
}
export interface ActionSettlement {
  scoreBefore: number; scoreAfter: number; calmChanges: Record<Side, number>; costs: string[];
  nextSide: Side | null; impact: string; comparison?: string;
  conditionMet?: boolean; favorable?: boolean; affectedSides?: Side[]; ruleIds?: string[];
  outcome?: 'effective' | 'failed' | 'backfired' | 'no_effect' | 'meltdown'; explanation?: string;
}
export interface StyleOption { id: Tactic; label: string; description: string; enabled: boolean; reason?: string; probability?: number }
export interface ActionOption {
  id: string; group: 'main' | 'resource'; actionType: ActionType; label: string; description: string;
  minEvidence: number; maxEvidence: number; evidenceIds: string[]; targetIds: string[];
  targetRequired: boolean; itemId: ItemId | null; styles: StyleOption[];
  cost: string; risk: string; enabled: boolean; reason?: string;
  leads?: { id: string; label: string; description: string }[]; minLeads?: number; maxLeads?: number;
  evidencePairs?: [string, string][];
}
export interface ActionReceipt { actionId: string; turnId: string; status: 'generating' | 'resolving' | 'settled' | 'aborted'; command: ActionCommand; eventId?: string }
export type Provider = import('./providers.js').ProviderId;
export interface AiConfig {
  provider: Provider; baseUrl: string; apiKey: string; model: string;
  personality: Personality; strategy: Strategy; identity: Identity; items: ItemId[];
  inputPricePerMillion?: number; outputPricePerMillion?: number;
}
export type PublicConfig = Pick<AiConfig, 'provider' | 'model' | 'personality' | 'strategy' | 'identity' | 'items'>;
export type Loadout = Pick<AiConfig, 'identity' | 'items'>;
export type OwnAiSettings = Omit<AiConfig, 'apiKey' | 'identity' | 'items'>;
export interface Action {
  speech: string; action_type: ActionType; cited_evidence_ids: string[];
  target_argument_id: string | null; item_id: ItemId | null; tone: string;
}
export interface Evidence {
  id: string; title: string; description: string; reliability: number;
  explanation?: string; supports?: string; limitations?: string; details?: string;
  visibility: 'public' | Side; technical: boolean;
  strength: number; flaw: string | null; linkedIds: string[];
}
// Audience-facing evidence has no scoring weights, hidden flaws or hidden links.
export interface EvidenceView extends Pick<Evidence, 'id' | 'title' | 'description' | 'explanation' | 'supports' | 'limitations' | 'details' | 'technical'> {
  state: { disclosure: 'public' | 'private'; submitted: boolean; challenged: boolean; reviewed: boolean; targetable: boolean };
}
export interface CaseSummary { id: string; version?: number; dispute?: string; title: string; subtitle: string; background: string; threshold: number; initialScore: number; difficulty?: Difficulty; }
export interface CaseLead { id: string; side: Side; label: string; description: string; requiresIds: string[]; revealsIds: string[] }
export interface CaseEventRule { id: string; kind: 'discovery' | 'contradiction'; title: string; branches: { side: Side; evidenceIds: string[]; targetEvidenceIds: string[]; explanation: string }[] }
export interface CaseGuide { happened: string; dispute: string; objective: string; timeline: { time: string; text: string }[]; directions: string[]; suggestion: { id: string; text: string; optionId: string } | null; }
export interface CaseTemplate extends CaseSummary {
  version: number; truth: string; review: string; evidence: Evidence[];
  experienceVersion?: 1 | 2 | 3; matchMode?: MatchMode;
  engineVersion?: 2 | 3; timelineRules?: { evidenceIds: [string, string]; delta: number; explanation?: string }[];
  charge?: string; defenseGoal?: string; comicSlip?: string;
  timeline?: { time: string; text: string; evidenceIds: string[] }[]; leads?: CaseLead[]; caseEvents?: CaseEventRule[];
  variant?: { id: 'route-a' | 'route-b'; seed: string; initialPrivateIds: Record<Side, string[]> };
  ruleProfile?: Record<string, number | number[]>;
  allowedActions: ActionType[]; rules: { presentMultiplier: number; challengeBonus: number; timelineBonus: number; counterBonus: number; crossBonus: number };
}
export interface PlayerState {
  identity: Identity; scientificAnalysisUsed: boolean; extraQuestion: boolean;
  side: Side; stability: number; actionPoints: number; investigation: number;
  items: ItemId[]; usedItems: ItemId[]; knownEvidenceIds: string[];
  firewall: boolean; preparation: number; lastAction: ActionType | null;
  failureStreak?: number; composurePhases?: TrialStage[]; civilianRecoveryUsed?: boolean; tycoonInvestigationUsed?: boolean;
}
export interface GameEvent {
  id: string; sequence: number; kind: 'system' | 'action' | 'verdict' | 'thinking' | 'case_event' | 'skip';
  side?: Side; round: number; text: string; action?: Action;
  accepted?: boolean; reason?: string; scoreDelta?: number; stabilityDelta?: number;
  scoreAfter: number; stabilityAfter?: number;
  actorId?: string; occurredAt?: string; command?: ActionCommand; successful?: boolean;
  random?: { roll: number; threshold: number; qualified: boolean; succeeded: boolean };
  resources?: { investigationBefore: number; investigationAfter: number; usedItems: ItemId[]; scientificAnalysisUsed: boolean };
  presentation?: { title: string; explanation: string; detailLines: string[] };
  settlement?: ActionSettlement;
  meltdown?: { roll: number; threshold: 70; occurred: boolean; penalty: number; line: string };
  stage?: TrialStage; ruleId?: string;
}
export interface Verdict { winner: Side; convicted: boolean; score: number; threshold: number; explanation: string; }
export interface LegacyEngineState {
  caseId: string; score: number; round: number; turn: Side;
  phase: 'debate' | 'closing' | 'finished'; players: Record<Side, PlayerState>;
  events: GameEvent[]; publicEvidenceIds: string[]; presented: string[];
  challenged: string[]; analyzed: string[]; countered: string[]; completedActions: number;
  verdict: Verdict | null;
}
export interface EngineState extends LegacyEngineState { rulesVersion: 2 | 3; caseVersion?: number; reviewed: string[];
  stage?: TrialStage; opportunities?: number; skippedOpportunities?: number; triggeredEvents?: string[]; crossExamined?: string[]; }
export interface Usage {
  calls: number; retries: number; failures: number; fallback: number;
  inputTokens: number; outputTokens: number; estimatedCost: number | null;
}
export interface CallRecord {
  id: string; side: Side; provider: Provider; model: string; attempt: number;
  status: string; inputTokens: number; outputTokens: number; durationMs: number;
  estimatedCost: number | null;
}
export interface PlayerView {
  id: string; nickname: string; side: Side; connected: boolean; ready: boolean;
  configured: boolean; config: PublicConfig | null; loadout: Loadout; state: PlayerState | null; usage: Usage;
}
export interface RoomView {
  mode?: MatchMode;
  difficulty?: Difficulty; selection?: 'auto' | 'manual'; recentCaseIds?: string[]; guide?: CaseGuide | null;
  code: string; status: 'waiting' | 'playing' | 'finished' | 'cancelled';
  hostId: string; you: string; players: PlayerView[]; case: CaseSummary;
  publicEvidence: EvidenceView[]; privateEvidence: EvidenceView[]; events: GameEvent[];
  game: { score: number; round: number; turn: Side; phase: EngineState['phase']; verdict: Verdict | null;
    turnId: string; execution: 'awaiting_action' | 'generating' | 'resolving' | 'finished' | 'aborted';
    rulesVersion?: 2 | 3; stage?: TrialStage; opportunities?: number; totalOpportunities?: number; completedActions?: number; skippedOpportunities?: number; variantId?: string } | null;
  actionOptions: ActionOption[]; ownAction: ActionReceipt | null;
  thinking: Side | null; persistence: 'memory' | 'mysql'; notice: string | null;
  ownAiSettings: OwnAiSettings | null;
}
export interface Session { playerId: string; token: string; roomCode: string; }
export interface Ack<T = undefined> { ok: boolean; data?: T; error?: string; }
export interface Catalog {
  cases: CaseSummary[];
  identities: { id: Identity; name: string; description: string }[];
  items: { id: ItemId; name: string; description: string }[];
}
export const SIDE_NAMES: Record<Side, string> = { defense: '辩方', prosecution: '控方' };
export const PERSONALITIES = { rigorous: '严谨型', aggressive: '激进型', cunning: '狡猾型', chaotic: '混乱型' };
export const STRATEGIES = { evidence: '证据推理', rebuttal: '强势反驳', cautious: '风险控制', free: '自由策略' };
export const TACTICS: Record<Tactic, string> = { steady: '稳健论证', assertive: '强势进攻', risky: '冒险反驳', logical_summary: '逻辑总结', evidence_rebuttal: '证据集中反驳', forceful_closing: '强势陈词', risky_closing: '冒险陈词' };
