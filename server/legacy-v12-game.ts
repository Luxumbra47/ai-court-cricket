import { z } from 'zod';
import { randomInt } from 'node:crypto';
import type { Action, ActionCommand, ActionOption, ActionType, CaseTemplate, EngineState, Evidence, GameEvent, ItemId, LegacyEngineState, PlayerState, PublicConfig, Side, StyleOption, Tactic } from '../shared/types.js';
import { TACTICS } from '../shared/types.js';
import { CASES, ITEM_CATALOG } from './cases.js';
import { replayGame as replayLegacy } from './legacy-game.js';
import { replayGame as replayPreviousTurns } from './legacy-turn-game.js';

const actionTypes = ['challenge_evidence', 'timeline_analysis', 'counter_argument', 'present_evidence', 'cross_examination', 'closing_statement', 'use_item', 'review_evidence'] as const;
const itemIds = ['magnifier', 'coffee', 'archive', 'interrogate', 'firewall', 'extension'] as const;
const tactics = ['steady', 'assertive', 'risky', 'logical_summary', 'evidence_rebuttal', 'forceful_closing', 'risky_closing'] as const;
export const actionSchema = z.object({
  speech: z.string().trim().min(1).max(800), action_type: z.enum(actionTypes),
  cited_evidence_ids: z.array(z.string().regex(/^[A-Z][0-9]{2}$/)).max(3).refine(ids => new Set(ids).size === ids.length),
  target_argument_id: z.string().max(100).nullable(), item_id: z.enum(itemIds).nullable(), tone: z.string().trim().min(1).max(40),
}).strict();
export const commandSchema = z.object({
  actionId: z.string().uuid(), turnId: z.string().min(1).max(100), optionId: z.string().min(1).max(80),
  previewId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  evidenceIds: z.array(z.string().regex(/^[A-Z][0-9]{2}$/)).max(3).refine(ids => new Set(ids).size === ids.length),
  targetArgumentId: z.string().max(100).nullable(), itemId: z.enum(itemIds).nullable(), tactic: z.enum(tactics),
}).strict().transform(c => ({ ...c, evidenceIds: [...c.evidenceIds].sort() }));
const other = (side: Side): Side => side === 'defense' ? 'prosecution' : 'defense';
const direction = (side: Side) => side === 'prosecution' ? 1 : -1;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const flaw = (e: Evidence) => e.flaw !== null || e.reliability < .65;
const key = (side: Side, id: string) => `${side}:${id}`;
const pairKey = (ids: string[]) => [...ids].sort().join(',');
export const turnIdFor = (matchId: string, state: EngineState) => `${matchId}:${state.completedActions}`;

export function createGame(template: CaseTemplate, configs: Record<Side, PublicConfig>): EngineState {
  const publicIds = template.evidence.filter(e => e.visibility === 'public').map(e => e.id);
  const player = (side: Side): PlayerState => ({ side, identity: configs[side].identity,
    scientificAnalysisUsed: false, extraQuestion: false, stability: 100, actionPoints: 4,
    investigation: configs[side].identity === 'tycoon' ? 3 : configs[side].identity === 'civilian' ? 2 : 1,
    items: [...new Set(configs[side].items)].slice(0, 3), usedItems: [],
    knownEvidenceIds: [...publicIds, ...template.evidence.filter(e => e.visibility === side).slice(0, 1).map(e => e.id)],
    firewall: false, preparation: 0, lastAction: null });
  return { rulesVersion: 2, caseId: template.id, caseVersion: template.version, score: template.initialScore, round: 1, turn: 'defense', phase: 'debate',
    players: { defense: player('defense'), prosecution: player('prosecution') }, events: [],
    publicEvidenceIds: publicIds, presented: [], challenged: [], analyzed: [], reviewed: [], countered: [], completedActions: 0, verdict: null };
}
export function getVisibleEvidence(template: CaseTemplate, state: LegacyEngineState, side: Side) {
  return template.evidence.filter(e => state.publicEvidenceIds.includes(e.id) || state.players[side].knownEvidenceIds.includes(e.id));
}
export function getPublicEvidence(template: CaseTemplate, state: LegacyEngineState) { return template.evidence.filter(e => state.publicEvidenceIds.includes(e.id)); }
const favorable = (state: EngineState, side: Side) => state.events.filter(e => e.kind === 'action' && e.round <= 3 && e.side === side && (e.scoreDelta ?? 0) * direction(side) > 0);
function styles(state: EngineState, side: Side, type: ActionType): StyleOption[] {
  const p = state.players[side], probability = p.stability >= 80 ? 60 : 40;
  const list: StyleOption[] = [{ id: 'steady', label: TACTICS.steady, description: '按材料本身论证，不额外冒险；证据仍可能不足以说服法庭。', enabled: true }];
  if (type === 'use_item' || type === 'review_evidence') return list;
  if (type === 'counter_argument' || type === 'cross_examination') list.push({ id: 'assertive', label: TACTICS.assertive,
    description: '反驳或追问成功时多争取 2 点效果，自身稳定度降低 5 点；反驳最多抵消该论点原有的得分。', enabled: p.stability >= 40, reason: p.stability < 40 ? '当前思路混乱，无法强势进攻' : undefined });
  list.push({ id: 'risky', label: TACTICS.risky, enabled: p.stability >= 40, probability,
    description: `材料支持本方时，有 ${probability}% 机会多争取 4 点效果。失败不获得有利分数，稳定度降低 15 点；已用资源和公开的材料不退回。`, reason: p.stability < 40 ? '稳定度不足 40，不能冒险' : undefined });
  return list;
}
/** Only authorized targets and public conditions are exposed, never hidden outcome previews. */
export function getActionOptions(template: CaseTemplate, state: EngineState, side: Side): ActionOption[] {
  if (state.phase === 'finished') return [];
  const p = state.players[side], visible = getVisibleEvidence(template, state, side), pub = getPublicEvidence(template, state);
  const opposing = state.events.filter(e => e.kind === 'action' && e.round <= 3 && e.side === other(side) && e.accepted);
  const counters = opposing.filter(e => !state.countered.includes(e.id) && (e.scoreDelta ?? 0) * direction(other(side)) > 0);
  const option = (id: string, type: ActionType, label: string, description: string, evidenceIds: string[], min = 1, max = 1,
    targetIds: string[] = [], targetRequired = false, group: ActionOption['group'] = 'main', itemId: ItemId | null = null): ActionOption => ({
    id, group, actionType: type, label, description, evidenceIds, minEvidence: min, maxEvidence: max, targetIds, targetRequired, itemId,
    styles: styles(state, side, type), cost: '使用后结束本回合。', risk: '能否说服法庭取决于材料；选中的私人材料会向双方公开。', enabled: true });
  const ids = (entries: Evidence[]) => entries.map(e => e.id);
  if (state.phase === 'closing') return (['logical_summary', 'evidence_rebuttal', 'forceful_closing', 'risky_closing'] as Tactic[]).map(tactic => {
    const entry = option(`closing:${tactic}`, 'closing_statement', TACTICS[tactic], '', ids(pub), tactic === 'evidence_rebuttal' ? 1 : 0, 3,
      tactic === 'evidence_rebuttal' ? counters.map(e => e.id) : [], tactic === 'evidence_rebuttal');
    const descriptions: Partial<Record<Tactic, string>> = { logical_summary: '整理之前的论证：成功争取过一次得 1 点，两次以上得 2 点；否则不加分。',
      evidence_rebuttal: '抓住对方尚未被反驳的说法，最多抵消 3 点得分；需要引用那次使用的材料。',
      forceful_closing: '思路清晰，且之前至少两次论证有效时，可争取 3 点效果。',
      risky_closing: `有 ${p.stability >= 80 ? 60 : 40}% 机会争取 4 点效果；失败不加分，并降低 15 点稳定度。` };
    entry.description = descriptions[tactic]!;
    entry.styles = [{ id: tactic, label: TACTICS[tactic], description: entry.description, enabled: true,
      ...(tactic === 'risky_closing' ? { probability: p.stability >= 80 ? 60 : 40 } : {}) }];
    if (tactic === 'evidence_rebuttal' && !counters.length) { entry.enabled = false; entry.reason = '对方目前没有尚可反驳的得分说法'; }
    if (tactic === 'forceful_closing' && (p.stability < 80 || favorable(state, side).length < 2)) { entry.enabled = false; entry.reason = '需要稳定度达到 80，且此前至少两次论证为本方争取到分数'; }
    if (tactic === 'risky_closing' && p.stability < 40) { entry.enabled = false; entry.reason = '稳定度不足 40'; }
    return entry;
  });
  const reviewIds = ids(pub.filter(e => e.technical && !state.reviewed.includes(key(side, e.id))));
  const canReview = p.investigation > 0 || (p.identity === 'scientist' && !p.scientificAnalysisUsed);
  const unsubmitted = ids(visible.filter(e => !state.presented.includes(e.id)));
  const list = side === 'defense' ? [
    option('defense:challenge', 'challenge_evidence', '质疑证据', '指出公开材料不能证明什么；同一份材料每方只能质疑一次。', ids(pub.filter(e => !state.challenged.includes(key(side, e.id))))),
    option('defense:present', 'present_evidence', '出示证据', '把一份已知材料正式交给法庭。公开过的材料也可以首次出示。', unsubmitted),
    option('defense:counter', 'counter_argument', '找出对方漏洞', '针对对方刚才得分的说法，引用其中的材料反驳。', ids(visible), 1, 3, counters.map(e => e.id), true),
    option('defense:review', 'review_evidence', '重新检查证据', '核对技术记录，可能加强或削弱证明力；不能重复检查同一份。', reviewIds),
  ] : [
    option('prosecution:present', 'present_evidence', '出示证据', '把一份已知材料正式交给法庭。公开过的材料也可以首次出示。', unsubmitted),
    option('prosecution:cross', 'cross_examination', '追问对方', '用一份材料追问对方的说法，需要一次调查。', ids(visible), 1, 1, opposing.map(e => e.id), true),
    option('prosecution:counter', 'counter_argument', '找出对方漏洞', '引用对方得分说法中的材料反驳，同一论点不能重复反驳。', ids(visible), 1, 3, counters.map(e => e.id), true),
    option('prosecution:link', 'timeline_analysis', '组合证据', '把两份材料连起来解释案情；关联不成立会降低 6 点稳定度。', ids(visible), 2, 2),
  ];
  if (side === 'prosecution' && p.identity === 'scientist') list.push(option('skill:review', 'review_evidence', '科学家技术复核', '首次检查技术记录免调查，与放大镜共用。', reviewIds, 1, 1, [], false, 'resource'));
  for (const item of ITEM_CATALOG.filter(i => p.items.includes(i.id))) {
    const targets = item.id === 'magnifier' ? ids(visible.filter(e => (e.technical || e.reliability < .75) && (p.investigation > 0 || (p.identity === 'scientist' && !p.scientificAnalysisUsed && e.technical)) && !state.reviewed.includes(key(side, e.id)))) : [];
    const e = option(`item:${item.id}`, 'use_item', item.name, item.description, targets, item.id === 'magnifier' ? 1 : 0, item.id === 'magnifier' ? 1 : 0, [], false, 'resource', item.id);
    if (p.usedItems.includes(item.id)) { e.enabled = false; e.reason = '本局已使用'; }
    else if (item.id === 'coffee' && p.stability === 100) { e.enabled = false; e.reason = '稳定度已满'; }
    else if (item.id === 'archive' && !template.evidence.some(x => x.visibility === side && !p.knownEvidenceIds.includes(x.id))) { e.enabled = false; e.reason = '已经查阅了所有额外材料'; }
    else if (item.id === 'firewall' && p.firewall) { e.enabled = false; e.reason = '防火墙正在生效'; }
    else if (item.id === 'interrogate' && p.extraQuestion) { e.enabled = false; e.reason = '已有额外质询机会'; }
    else if (item.id === 'extension' && p.preparation) { e.enabled = false; e.reason = '已有准备机会'; }
    list.push(e);
  }
  for (const e of list) {
    if (e.actionType === 'review_evidence' || e.itemId === 'magnifier') {
      e.cost += p.identity === 'scientist' && !p.scientificAnalysisUsed ? ' 首次检查技术记录免调查，否则消耗 1 次调查。' : ' 消耗 1 次调查。';
      if (!canReview) { e.enabled = false; e.reason = '调查资源已用尽'; }
    }
    if (e.actionType === 'cross_examination') { e.cost += p.extraQuestion ? ' 使用已准备好的追问机会。' : ' 消耗 1 次调查。'; if (!p.extraQuestion && !p.investigation) { e.enabled = false; e.reason = '调查次数已用尽'; } }
    if (e.targetRequired && !e.targetIds.length) { e.enabled = false; e.reason = '对方还没有可回应的发言'; }
    if (e.evidenceIds.length < e.minEvidence) { e.enabled = false; e.reason = '当前没有可使用的材料'; }
    if (p.stability < 40 && ['counter_argument', 'cross_examination'].includes(e.actionType) && !p.preparation) { e.enabled = false; e.reason = '当前思路混乱，先整理思路或选择其他行动'; }
    if (p.stability < 80 && p.lastAction === 'counter_argument' && e.actionType === 'counter_argument') { e.enabled = false; e.reason = '当前思路不够清晰，不能连续反驳'; }
  }
  return list;
}
function append(state: EngineState, event: Omit<GameEvent, 'id' | 'sequence' | 'scoreAfter'> & { id?: string }) {
  const result: GameEvent = { ...event, id: event.id ?? `event-${state.events.length + 1}`, sequence: state.events.length + 1, scoreAfter: state.score };
  state.events.push(result); return result;
}
function stability(state: EngineState, side: Side, change: number, text: string, actingSide: Side) {
  const p = state.players[side], before = p.stability;
  if (change < 0 && p.firewall) { p.firewall = false; change = Math.min(0, change + 15); append(state, { kind: 'system', side, round: state.round, text: '逻辑防火墙抵消了至多 15 点稳定度损失。' }); }
  p.stability = clamp(before + change);
  if (p.stability !== before && side !== actingSide) append(state, { kind: 'system', side, round: state.round, text, stabilityDelta: p.stability - before, stabilityAfter: p.stability });
}
export interface PreparedAction { command: ActionCommand; action: Action; next: EngineState; event: GameEvent; side: Side }
function relationExplanation(ids: string[]) {
  const explanations: Record<string, string> = {
    'P01,P04': '监控与保温箱记录的是同一次开箱，却相差八分钟，削弱了按监控时间认定取件经过的说法。',
    'P04,P06': '开箱发生在老板许可之后，两份材料共同支持披萨是在获准后取走的解释。',
    'P02,P05': '订单确认披萨属于事务所，签名确认阿团取了三块，两份材料加强了取件经过的证明。',
    'D01,D04': '自动计划在转移前启动，与钻石转移记录相互对应，削弱了“账号登录就等于小闪亲手操作”的推断。',
    'D04,D06': '自动操作计划与事先的演练许可相互印证，支持这是一次获准测试的解释。',
    'D01,D05': '转移记录说明钻石去了哪里，账户权限记录说明小闪能够管理那里，两份材料加强了对去向控制的证明。',
    'R01,R04': '修改时间与结转规则生效时间相符，支持机器人按规则更新余额的解释。',
    'R04,R06': '结转规则与老板的事先批准相互印证，削弱了机器人擅自修改的指控。',
    'R01,R05': '修改记录与操作权限相互印证，加强了机器人能够并确实执行修改的证明。',
    'R01,R07': '修改记录与完成回执对应，加强了这次更新确由机器人执行的证明。',
  };
  return explanations[pairKey(ids)] ?? '两份材料相互印证，加强了对事情经过的说明。';
}
/** IDs stay in structured metadata; spoken references use only authorized evidence names. */
export function readableSpeech(speech: string, template: CaseTemplate, state: EngineState, selected: string[]): string | null {
  const allowed = template.evidence.filter(e => state.publicEvidenceIds.includes(e.id) || selected.includes(e.id));
  const names = new Set(allowed.map(e => e.title));
  if ([...template.evidence, ...CASES.flatMap(c => c.evidence)].some(e => !names.has(e.title) && speech.includes(e.title))) return null;
  let invalid = false;
  let text = speech.replace(/\b[A-Z]\d{2}\b/g, id => { const e = allowed.find(e => e.id === id); if (!e) invalid = true; return e?.title ?? ''; });
  if (invalid || /根据系统规则|执行基础规则|已锁定|程序规则|我方选择.{0,15}(提交|出示|行动)|cited_evidence_ids|action_type/.test(text)) return null;
  for (const e of allowed) text = text.replaceAll(`${e.title} ${e.title}`, e.title).replaceAll(`${e.title}「${e.title}」`, `「${e.title}」`);
  return text.trim().slice(0, 800) || null;
}
/** No live state changes. Lock this plan and its one random draw before invoking the LLM. */
export function prepareAction(template: CaseTemplate, state: EngineState, side: Side, input: unknown,
  options: { turnId: string; actorId: string; roll?: number; now?: string }): PreparedAction {
  const command = commandSchema.parse(input);
  if (state.phase === 'finished') throw new Error('对局已结束');
  if (state.caseVersion !== undefined && state.caseVersion !== template.version) throw new Error('案件版本不一致');
  if (state.caseId !== template.id || state.turn !== side) throw new Error('不能越过当前回合');
  if (command.turnId !== options.turnId) throw new Error('回合已过期，请同步最新状态');
  if (state.events.some(e => e.id === command.actionId)) throw new Error('重复行动');
  const choice = getActionOptions(template, state, side).find(o => o.id === command.optionId);
  if (!choice || !choice.enabled) throw new Error(choice?.reason || '当前没有此行动');
  if (!template.allowedActions.includes(choice.actionType)) throw new Error('案件不允许此行动');
  if (!choice.styles.some(s => s.id === command.tactic && s.enabled)) throw new Error('当前行动不可使用该风格');
  if (command.evidenceIds.length < choice.minEvidence || command.evidenceIds.length > choice.maxEvidence || command.evidenceIds.some(id => !choice.evidenceIds.includes(id))) throw new Error('证据不存在、无权使用或数量不符合要求');
  if (choice.itemId !== command.itemId) throw new Error('道具与所选行动不一致');
  if (choice.targetRequired ? !command.targetArgumentId || !choice.targetIds.includes(command.targetArgumentId) : command.targetArgumentId !== null) throw new Error('目标论点不合法');
  const target = state.events.find(e => e.id === command.targetArgumentId);
  if (['counter_argument', 'closing_statement'].includes(choice.actionType) && command.targetArgumentId && !target?.action?.cited_evidence_ids.some(id => command.evidenceIds.includes(id))) throw new Error('反驳须引用目标论点的公开证据');
  const next = structuredClone(state), p = next.players[side], opponent = next.players[other(side)], before = state.players[side], dir = direction(side);
  const cited = template.evidence.filter(e => command.evidenceIds.includes(e.id));
  const names = cited.map(e => `「${e.title}」`).join('和');
  const speech: Record<ActionType, string> = {
    investigate_lead: '调查材料。', regain_composure: '整理思路。',
    present_evidence: `请看${names}。${cited[0]?.supports ?? cited[0]?.explanation ?? cited[0]?.description ?? ''}`,
    challenge_evidence: `${names}确实提供了线索。${cited[0]?.limitations ?? '但这条线索还不足以独立解释整件事。'}请不要跳过这一步，就把推测当成结论。`,
    timeline_analysis: `把${names}放在一起看，才有机会看清事情的先后。${cited.map(e => e.description).join('')}`,
    counter_argument: `对方刚才的推断还缺少一步。${cited[0]?.limitations ?? cited[0]?.explanation ?? ''}请结合${names}说明，为什么其他解释都能被排除？`,
    cross_examination: `我想请对方正面回答：${cited[0]?.description ?? ''}面对${names}，刚才的解释是否还站得住？`,
    review_evidence: `请再仔细核对${names}。记录能否经得起检查，关系到我们是否应该相信眼前的推断。`,
    use_item: command.itemId === 'magnifier' ? `细节往往决定整个故事。请把${names}再检查一遍。` : ({ coffee: '容我喝口咖啡，理清思路再继续。', archive: '案情还有疑点，我申请调阅手头尚未打开的调查材料。', interrogate: '下次我会把问题问得更清楚，先让我整理要追问的重点。', firewall: '接下来的争辩再激烈，我也会守住思路，逐条回应。', extension: '让我把已有的材料重新梳理，下一步再解释它们之间的联系。' } as Partial<Record<ItemId, string>>)[command.itemId!] ?? '请给我一点时间整理材料。',
    closing_statement: `${state.events.some(e => e.side === side && e.kind === 'action') ? '刚才的交锋已经把分歧摆在了法庭面前。' : ''}${side === 'defense' ? '关键不是事情有没有发生，而是指控是否得到了充分证明。请依据已经出示的材料，保留应有的疑问。' : '请把已经出示的材料放在一起衡量。我方请求法庭认真考虑这些线索对指控的支持。'}`,
  };
  const action: Action = { speech: speech[choice.actionType], action_type: choice.actionType,
    cited_evidence_ids: [...command.evidenceIds], target_argument_id: command.targetArgumentId, item_id: command.itemId, tone: 'calm' };
  let delta = 0, failureLoss = 0, logicLoss = 0, opponentLoss = 0, unlock = false, linked: Evidence | undefined, clearPreparation = false, reason = '', success = false;
  next.publicEvidenceIds = [...new Set([...next.publicEvidenceIds, ...command.evidenceIds])];
  const review = (entry: Evidence, withUnlock: boolean) => {
    const free = p.identity === 'scientist' && !p.scientificAnalysisUsed && entry.technical;
    if (!free && !p.investigation) throw new Error('没有可用调查资源');
    if (free) p.scientificAnalysisUsed = true; else p.investigation--;
    next.reviewed.push(key(side, entry.id)); delta = flaw(entry) ? -Math.sign(entry.strength) * 4 : Math.sign(entry.strength) * 3;
    reason = flaw(entry) ? `重新检查「${entry.title}」发现问题：${entry.flaw ?? '这份材料不足以排除其他解释'}，证明力受到削弱。` : `「${entry.title}」通过核对，原有记录的证明力得到加强。`; unlock = withUnlock; linked = entry;
  };
  switch (choice.actionType) {
    case 'present_evidence': delta = Math.round(cited[0].strength * cited[0].reliability * template.rules.presentMultiplier); next.presented.push(cited[0].id); reason = `「${cited[0].title}」已正式出示。${cited[0].explanation ?? cited[0].description}`; break;
    case 'challenge_evidence': { const e = cited[0]; next.challenged.push(key(side, e.id));
      if (flaw(e)) { delta = -Math.sign(e.strength) * (template.rules.challengeBonus + Math.round(Math.abs(e.strength) * (1 - e.reliability))); reason = `对「${e.title}」的质疑成立：${e.flaw ?? '材料不足以排除其他解释'}。这份材料的证明力降低。`; }
      else { failureLoss = -8; reason = `对「${e.title}」的质疑未获支持，没有找到足以削弱它的问题；稳定度降低 8 点。`; } break; }
    case 'timeline_analysis': {
      const analysisKey = key(side, pairKey(command.evidenceIds)); if (next.analyzed.includes(analysisKey)) throw new Error('不能重复分析同一证据组合');
      next.analyzed.push(analysisKey); const relation = template.timelineRules?.find(r => pairKey(r.evidenceIds) === pairKey(command.evidenceIds));
      if (relation) { delta = relation.delta; if (p.preparation) { delta += Math.sign(delta) * 2; p.preparation--; } reason = relationExplanation(command.evidenceIds); }
      else { failureLoss = -6; reason = `${names}之间还缺少能够连接案情的依据，组合没有说服法庭；稳定度降低 6 点。`; } break;
    }
    case 'counter_argument': next.countered.push(target!.id); delta = -Math.sign(target!.scoreDelta!) * Math.min(Math.abs(target!.scoreDelta!), template.rules.counterBonus); opponentLoss = -10; reason = `围绕${names}的反驳削弱了对方先前的说法，抵消了其中部分得分。`; break;
    case 'cross_examination': { const extra = p.extraQuestion; if (extra) p.extraQuestion = false; else p.investigation--;
      if (cited.some(e => e.reliability >= .7 && Math.sign(e.strength) === dir)) { delta = dir * (template.rules.crossBonus + (extra ? 2 : 0)); opponentLoss = -6; clearPreparation = true; unlock = true; reason = `${names}支持了本次追问，对方的解释受到动摇。${opponent.preparation > 0 ? '整理好的思路也被打断。' : ''}`; }
      else { failureLoss = -6; reason = `${names}没有为这次追问提供足够支持；消耗一次调查，稳定度降低 6 点。`; } break; }
    case 'review_evidence': review(cited[0], false); break;
    case 'use_item': { p.usedItems.push(command.itemId!); success = true;
      switch (command.itemId) {
        case 'magnifier': review(cited[0], true); break;
        case 'coffee': stability(next, side, 25, '', side); reason = '清醒咖啡恢复至多 25 点稳定度。'; break;
        case 'archive': unlock = true; reason = '找到了一份新的调查材料，仅本人可见；需要之后出示，才能用于说服法庭。'; break;
        case 'interrogate': p.extraQuestion = true; reason = '已整理好下一次追问的重点：免调查，并加强 2 点效果。'; break;
        case 'firewall': p.firewall = true; reason = '防火墙将抵消下一次最多 15 点稳定度损失。'; break;
        case 'extension': p.preparation = 1; reason = '已整理好材料，下次组合证据成功时额外加强 2 点效果。'; break;
      } break; }
    case 'closing_statement': {
      const count = favorable(state, side).length;
      if (command.tactic === 'logical_summary') { delta = dir * Math.min(count, 2); reason = `此前 ${count} 次有效论证为本方争取过分数，最后的总结再争取 ${Math.min(count, 2)} 点效果。`; }
      if (command.tactic === 'evidence_rebuttal') { next.countered.push(target!.id); delta = -Math.sign(target!.scoreDelta!) * Math.min(3, Math.abs(target!.scoreDelta!)); reason = '最后的反驳削弱了对方这次发言的说服力，最多抵消 3 点得分。'; }
      if (command.tactic === 'forceful_closing') { delta = dir * 3; reason = '稳定度与有利行动次数达标，强势陈词产生 3 分收益。'; }
      if (command.tactic === 'risky_closing') reason = '冒险陈词由服务器进行一次概率判定。'; break;
    }
  }
  if (delta * dir < 0) logicLoss = -12;
  let random: GameEvent['random'];
  if (command.tactic === 'assertive') {
    if (delta * dir > 0) delta = dir * (choice.actionType === 'counter_argument' ? Math.min(Math.abs(delta) + 2, Math.abs(target!.scoreDelta!)) : Math.abs(delta) + 2);
    failureLoss -= 5; reason += ' 强势进攻让自己也承受压力，稳定度降低 5 点。';
  }
  if (command.tactic === 'risky' || command.tactic === 'risky_closing') {
    const threshold = before.stability >= 80 ? 60 : 40, roll = options.roll ?? randomInt(1, 101);
    if (!Number.isInteger(roll) || roll < 1 || roll > 100) throw new Error('随机记录不合法');
    const qualified = command.tactic === 'risky_closing' || delta * dir > 0, succeeded = qualified && roll <= threshold; random = { roll, threshold, qualified, succeeded };
    if (succeeded) { delta += dir * 4; reason += ' 冒险成功，获得额外 4 分收益。'; }
    else { const adverse = delta * dir < 0; if (delta * dir > 0) delta = 0; failureLoss = -15; opponentLoss = 0; unlock = false; clearPreparation = false; reason = `冒险论证没有说服法庭，本次没有争取到有利分数，稳定度降低 15 点。${adverse ? `所用材料反而支持了对方。${reason}` : ''}已使用的资源不会返还，选中的材料仍会公开。`; }
  }
  if (unlock) {
    const entry = template.evidence.find(e => e.visibility === side && !p.knownEvidenceIds.includes(e.id) && (!linked || linked.linkedIds.includes(e.id) || e.linkedIds.includes(linked.id)));
    if (entry) { p.knownEvidenceIds.push(entry.id); append(next, { kind: 'system', side, round: state.round, text: '调查发现了一份新材料，只有调查的一方可以查看。' }); }
  }
  if (clearPreparation) opponent.preparation = 0;
  if (opponentLoss) stability(next, other(side), opponentLoss, '对方的追问或反驳动摇了思路，稳定度下降。', side);
  if (failureLoss || logicLoss) stability(next, side, failureLoss + logicLoss, '', side);
  if (logicLoss) reason += ' 所用材料反而支持对方，自己的思路受到冲击，稳定度降低 12 点。';
  if (before.firewall && !p.firewall) reason += ' 逻辑防火墙抵消了本次部分或全部稳定度冲击。';
  next.score = clamp(state.score + delta); p.actionPoints--; p.lastAction = choice.actionType;
  const event = append(next, { id: command.actionId, kind: 'action', side, round: state.round, text: action.speech, action, command,
    actorId: options.actorId, occurredAt: options.now ?? new Date().toISOString(), accepted: true, successful: success || (next.score - state.score) * dir > 0,
    reason, scoreDelta: next.score - state.score, stabilityDelta: p.stability - before.stability, stabilityAfter: p.stability, ...(random ? { random } : {}),
    resources: { investigationBefore: before.investigation, investigationAfter: p.investigation, usedItems: [...p.usedItems], scientificAnalysisUsed: p.scientificAnalysisUsed } });
  next.completedActions++;
  if (next.completedActions === 8) {
    next.phase = 'finished'; const convicted = next.score >= template.threshold;
    next.verdict = { winner: convicted ? 'prosecution' : 'defense', convicted, score: next.score, threshold: template.threshold,
      explanation: `最终控方证据强度 ${next.score}，定罪阈值 ${template.threshold}。${convicted ? '达到阈值，控方胜诉。' : '未达到阈值，被告获得无罪判决。'}法庭根据本局已经出示的材料与双方论证作出判决。` };
    append(next, { kind: 'verdict', round: 4, text: next.verdict.explanation });
  } else { next.turn = other(side); next.round = Math.floor(next.completedActions / 2) + 1; next.phase = next.completedActions >= 6 ? 'closing' : 'debate'; }
  if (template.experienceVersion === 2) {
    const costs = ['使用 1 次行动机会'];
    if (p.investigation < before.investigation) costs.push(`使用 ${before.investigation - p.investigation} 次调查`);
    if (p.scientificAnalysisUsed && !before.scientificAnalysisUsed) costs.push('使用科学家首次免费复核');
    if (before.extraQuestion && !p.extraQuestion) costs.push('使用储存的追问机会');
    if (before.preparation && p.preparation < before.preparation) costs.push('使用已准备的组合机会');
    if (before.firewall && !p.firewall) costs.push('消耗本方防火墙保护');
    if (state.players[other(side)].firewall && !opponent.firewall) costs.push('消耗对方防火墙保护');
    if (command.itemId) costs.push(`使用${ITEM_CATALOG.find(i => i.id === command.itemId)!.name}`);
    event.settlement = { scoreBefore: state.score, scoreAfter: next.score,
      calmChanges: { defense: next.players.defense.stability - state.players.defense.stability, prosecution: next.players.prosecution.stability - state.players.prosecution.stability },
      costs, nextSide: next.phase === 'finished' ? null : next.turn,
      impact: next.phase === 'finished' ? `最终证据强度 ${next.score}，胜诉阈值 ${template.threshold}，${next.verdict!.winner === 'defense' ? '辩方' : '控方'}胜诉。` : next.score >= template.threshold ? '控方证据强度已达到胜诉阈值；最终判决仍以陈词结束后的分数为准。' : `控方距离胜诉阈值还差 ${template.threshold - next.score} 点证据强度。` };
  }
  return { command, action, next, event, side };
}
export function matchesInstruction(action: Action, expected: Action) {
  return action.action_type === expected.action_type && pairKey(action.cited_evidence_ids) === pairKey(expected.cited_evidence_ids) && action.target_argument_id === expected.target_argument_id && action.item_id === expected.item_id;
}
export function finalizeAction(prepared: PreparedAction, input: unknown): EngineState {
  const action = actionSchema.parse(input); if (!matchesInstruction(action, prepared.action)) throw new Error('模型不得覆盖玩家行动');
  prepared.event.text = action.speech; prepared.event.action = action; return prepared.next;
}
/** Speech provider only: never selects an action, a target, or the following turn. */
export function createScriptedSpeech(expected: Action, config: PublicConfig, value: number): Action {
  const prefix = ({ rigorous: '法官大人，', aggressive: '请正面看待这个问题。', cunning: '这里有个细节，值得再想一想。', chaotic: '先别急着敲锤，事情还有点绕。' })[config.personality];
  return { ...structuredClone(expected), speech: `${prefix}${expected.speech}${value < 80 ? '容我理一理思路，事情应当逐条说清。' : ''}`, tone: value < 40 ? 'bewildered' : 'calm' };
}
export function replayScore(template: CaseTemplate, events: GameEvent[]) { return events.filter(e => e.kind === 'action').reduce((score, e) => clamp(score + (e.scoreDelta ?? 0)), template.initialScore); }
export function replayGame(template: CaseTemplate, configs: Record<Side, PublicConfig>, events: GameEvent[]): EngineState | LegacyEngineState {
  if (template.engineVersion !== 2) return replayLegacy(template, configs, events);
  if (!template.experienceVersion) return replayPreviousTurns(template, configs, events);
  let replay = createGame(template, configs);
  for (const e of events.filter(e => e.kind === 'action')) {
    if (!e.side || !e.command || !e.action || !e.actorId || !e.occurredAt) throw new Error('回合记录缺少必要字段');
    replay = finalizeAction(prepareAction(template, replay, e.side, e.command, { turnId: e.command.turnId, actorId: e.actorId, roll: e.random?.roll, now: e.occurredAt }), e.action);
  }
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'presentation' && k !== 'comparison').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
  if (JSON.stringify(canonical(replay.events)) !== JSON.stringify(canonical(events))) throw new Error('行动记录与案件规则不一致');
  return replay;
}
