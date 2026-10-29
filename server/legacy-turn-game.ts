import { z } from 'zod';
import { randomInt } from 'node:crypto';
import type { Action, ActionCommand, ActionOption, ActionType, CaseTemplate, EngineState, Evidence, GameEvent, ItemId, LegacyEngineState, PlayerState, PublicConfig, Side, StyleOption, Tactic } from '../shared/types.js';
import { TACTICS } from '../shared/types.js';
import { ITEM_CATALOG } from './cases.js';
import { replayGame as replayLegacy } from './legacy-game.js';

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
  return { rulesVersion: 2, caseId: template.id, score: template.initialScore, round: 1, turn: 'defense', phase: 'debate',
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
  const list: StyleOption[] = [{ id: 'steady', label: TACTICS.steady, description: '执行基础规则效果。', enabled: true }];
  if (type === 'use_item' || type === 'review_evidence') return list;
  if (type === 'counter_argument' || type === 'cross_examination') list.push({ id: 'assertive', label: TACTICS.assertive,
    description: '有效反制/质询额外收益 2；自身稳定度 -5，防火墙可抵消。', enabled: p.stability >= 40, reason: p.stability < 40 ? '严重混乱无法强势进攻' : undefined });
  list.push({ id: 'risky', label: TACTICS.risky, enabled: p.stability >= 40, probability,
    description: `冒险检定 ${probability}%；还须命中证据规则。成功额外收益 4，失败失去有利收益且稳定度 -15。`, reason: p.stability < 40 ? '稳定度不足 40，不能冒险' : undefined });
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
    styles: styles(state, side, type), cost: '1 次主要行动', risk: '效果由案件证据条件决定；选用私证将在结算时公开。', enabled: true });
  const ids = (entries: Evidence[]) => entries.map(e => e.id);
  if (state.phase === 'closing') return (['logical_summary', 'evidence_rebuttal', 'forceful_closing', 'risky_closing'] as Tactic[]).map(tactic => {
    const entry = option(`closing:${tactic}`, 'closing_statement', TACTICS[tactic], '', ids(pub), tactic === 'evidence_rebuttal' ? 1 : 0, 3,
      tactic === 'evidence_rebuttal' ? counters.map(e => e.id) : [], tactic === 'evidence_rebuttal');
    const descriptions: Partial<Record<Tactic, string>> = { logical_summary: '前三轮一次有利行动得 1 分，至少两次得 2 分，否则 0。',
      evidence_rebuttal: '反制前三轮未被反制的得分论点，逆转最多 3 分；须引用目标证据。',
      forceful_closing: '稳定度至少 80 且前三轮至少两次有利行动，得 3 分。',
      risky_closing: `冒险检定 ${p.stability >= 80 ? 60 : 40}%；成功得 4 分，失败得 0 且稳定度 -15。` };
    entry.description = descriptions[tactic]!;
    entry.styles = [{ id: tactic, label: TACTICS[tactic], description: entry.description, enabled: true,
      ...(tactic === 'risky_closing' ? { probability: p.stability >= 80 ? 60 : 40 } : {}) }];
    if (tactic === 'evidence_rebuttal' && !counters.length) { entry.enabled = false; entry.reason = '没有尚未反制的对方得分论点'; }
    if (tactic === 'forceful_closing' && (p.stability < 80 || favorable(state, side).length < 2)) { entry.enabled = false; entry.reason = '需要稳定度 ≥80 且至少两次有利行动'; }
    if (tactic === 'risky_closing' && p.stability < 40) { entry.enabled = false; entry.reason = '稳定度不足 40'; }
    return entry;
  });
  const reviewIds = ids(pub.filter(e => e.technical && !state.reviewed.includes(key(side, e.id))));
  const canReview = p.investigation > 0 || (p.identity === 'scientist' && !p.scientificAnalysisUsed);
  const privateNew = ids(visible.filter(e => !state.publicEvidenceIds.includes(e.id) && e.visibility === side));
  const label = ({ 'pizza-001': '提交时间证明', 'diamond-002': '提交演练记录', 'robot-003': '提交同步授权' } as Record<string, string>)[template.id] || '提交辩护证据';
  const list = side === 'defense' ? [
    option('defense:challenge', 'challenge_evidence', '质疑证据', '检查公开证据的证明范围；每条每方一次。', ids(pub.filter(e => !state.challenged.includes(key(side, e.id))))),
    option('defense:present', 'present_evidence', label, '公开一条已掌握的辩护材料，按证据本身计分。', privateNew),
    option('defense:counter', 'counter_argument', '反驳对手论点', '针对对方的得分论点，选择它引用的证据。', ids(visible), 1, 3, counters.map(e => e.id), true),
    option('defense:review', 'review_evidence', '申请技术复核', '核验技术记录，可能强化或削弱证据；同证每方只复核一次。', reviewIds),
  ] : [
    option('prosecution:present', 'present_evidence', '提交新证据', '公开一条已掌握且尚未公开的控方材料。', privateNew),
    option('prosecution:cross', 'cross_examination', '质询被告', '针对对方公开论点，以一条可信材料提出质询。', ids(visible), 1, 1, opposing.map(e => e.id), true),
    option('prosecution:counter', 'counter_argument', '反驳辩护论证', '回应已公开的辩护材料，不重复反制同一论点。', ids(visible), 1, 3, counters.map(e => e.id), true),
    option('prosecution:link', 'timeline_analysis', '建立证据关联', '选两条材料核对预设关系，未形成关系将损失稳定度。', ids(visible), 2, 2),
  ];
  if (side === 'prosecution' && p.identity === 'scientist') list.push(option('skill:review', 'review_evidence', '科学家技术复核', '与放大镜共用一次免费技术复核机会。', reviewIds, 1, 1, [], false, 'resource'));
  for (const item of ITEM_CATALOG.filter(i => p.items.includes(i.id))) {
    const targets = item.id === 'magnifier' ? ids(visible.filter(e => (e.technical || e.reliability < .75) && (p.investigation > 0 || (p.identity === 'scientist' && !p.scientificAnalysisUsed && e.technical)) && !state.reviewed.includes(key(side, e.id)))) : [];
    const e = option(`item:${item.id}`, 'use_item', item.name, item.description, targets, item.id === 'magnifier' ? 1 : 0, item.id === 'magnifier' ? 1 : 0, [], false, 'resource', item.id);
    if (p.usedItems.includes(item.id)) { e.enabled = false; e.reason = '本局已使用'; }
    else if (item.id === 'coffee' && p.stability === 100) { e.enabled = false; e.reason = '稳定度已满'; }
    else if (item.id === 'archive' && !template.evidence.some(x => x.visibility === side && !p.knownEvidenceIds.includes(x.id))) { e.enabled = false; e.reason = '额外情报已全部解锁'; }
    else if (item.id === 'firewall' && p.firewall) { e.enabled = false; e.reason = '防火墙正在生效'; }
    else if (item.id === 'interrogate' && p.extraQuestion) { e.enabled = false; e.reason = '已有额外质询机会'; }
    else if (item.id === 'extension' && p.preparation) { e.enabled = false; e.reason = '已有准备机会'; }
    list.push(e);
  }
  for (const e of list) {
    if (e.actionType === 'review_evidence' || e.itemId === 'magnifier') {
      e.cost += p.identity === 'scientist' && !p.scientificAnalysisUsed ? '；首次技术证据免调查，否则 1 调查' : '；1 调查';
      if (!canReview) { e.enabled = false; e.reason = '调查资源已用尽'; }
    }
    if (e.actionType === 'cross_examination') { e.cost += p.extraQuestion ? '；消耗已储存质询' : '；1 调查'; if (!p.extraQuestion && !p.investigation) { e.enabled = false; e.reason = '调查资源已用尽'; } }
    if (e.targetRequired && !e.targetIds.length) { e.enabled = false; e.reason = '尚无可针对的对方公开论点'; }
    if (e.evidenceIds.length < e.minEvidence) { e.enabled = false; e.reason = '没有符合权限和次数的目标证据'; }
    if (p.stability < 40 && ['counter_argument', 'cross_examination'].includes(e.actionType) && !p.preparation) { e.enabled = false; e.reason = '严重混乱时须先准备或选择安全行动'; }
    if (p.stability < 80 && p.lastAction === 'counter_argument' && e.actionType === 'counter_argument') { e.enabled = false; e.reason = '混乱状态不能连续反驳'; }
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
/** No live state changes. Lock this plan and its one random draw before invoking the LLM. */
export function prepareAction(template: CaseTemplate, state: EngineState, side: Side, input: unknown,
  options: { turnId: string; actorId: string; roll?: number; now?: string }): PreparedAction {
  const command = commandSchema.parse(input);
  if (state.phase === 'finished') throw new Error('对局已结束');
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
  const action: Action = { speech: `我方选择${choice.label}${cited.length ? '，引用' + cited.map(e => `${e.id}「${e.title}」`).join('、') : ''}。请按已选材料和程序规则审查。`, action_type: choice.actionType,
    cited_evidence_ids: [...command.evidenceIds], target_argument_id: command.targetArgumentId, item_id: command.itemId, tone: 'calm' };
  let delta = 0, failureLoss = 0, logicLoss = 0, opponentLoss = 0, unlock = false, linked: Evidence | undefined, clearPreparation = false, reason = '', success = false;
  next.publicEvidenceIds = [...new Set([...next.publicEvidenceIds, ...command.evidenceIds])];
  const review = (entry: Evidence, withUnlock: boolean) => {
    const free = p.identity === 'scientist' && !p.scientificAnalysisUsed && entry.technical;
    if (!free && !p.investigation) throw new Error('没有可用调查资源');
    if (free) p.scientificAnalysisUsed = true; else p.investigation--;
    next.reviewed.push(key(side, entry.id)); delta = flaw(entry) ? -Math.sign(entry.strength) * 4 : Math.sign(entry.strength) * 3;
    reason = flaw(entry) ? '复核命中预置缺陷，削弱该证明方向 4 分。' : '技术核验通过，强化该证明方向 3 分。'; unlock = withUnlock; linked = entry;
  };
  switch (choice.actionType) {
    case 'present_evidence': delta = Math.round(cited[0].strength * cited[0].reliability * template.rules.presentMultiplier); next.presented.push(cited[0].id); reason = '公开选定的新证据，按案件证明力和可信度计分。'; break;
    case 'challenge_evidence': { const e = cited[0]; next.challenged.push(key(side, e.id));
      if (flaw(e)) { delta = -Math.sign(e.strength) * (template.rules.challengeBonus + Math.round(Math.abs(e.strength) * (1 - e.reliability))); reason = '质疑命中预置缺陷，削弱对应证明方向。'; }
      else { failureLoss = -8; reason = '未发现可验证缺陷，质疑无分数收益。'; } break; }
    case 'timeline_analysis': {
      const analysisKey = key(side, pairKey(command.evidenceIds)); if (next.analyzed.includes(analysisKey)) throw new Error('不能重复分析同一证据组合');
      next.analyzed.push(analysisKey); const relation = template.timelineRules?.find(r => pairKey(r.evidenceIds) === pairKey(command.evidenceIds));
      if (relation) { delta = relation.delta; if (p.preparation) { delta += Math.sign(delta) * 2; p.preparation--; } reason = '命中案件明确的双证关联规则，按该关系方向计分。'; }
      else { failureLoss = -6; reason = '材料未形成案件预设的有效关联，本次不计分。'; } break;
    }
    case 'counter_argument': next.countered.push(target!.id); delta = -Math.sign(target!.scoreDelta!) * Math.min(Math.abs(target!.scoreDelta!), template.rules.counterBonus); opponentLoss = -10; reason = '引用了对方得分论点的证据，固定反制生效。'; break;
    case 'cross_examination': { const extra = p.extraQuestion; if (extra) p.extraQuestion = false; else p.investigation--;
      if (cited.some(e => e.reliability >= .7 && Math.sign(e.strength) === dir)) { delta = dir * (template.rules.crossBonus + (extra ? 2 : 0)); opponentLoss = -6; clearPreparation = true; unlock = true; reason = '可信度达标且支持本方的材料使质询生效；对方准备被清除。'; }
      else { failureLoss = -6; reason = '证据不足以支持质询，调查资源已消耗。'; } break; }
    case 'review_evidence': review(cited[0], false); break;
    case 'use_item': { p.usedItems.push(command.itemId!); success = true;
      switch (command.itemId) {
        case 'magnifier': review(cited[0], true); break;
        case 'coffee': stability(next, side, 25, '', side); reason = '清醒咖啡恢复至多 25 点稳定度。'; break;
        case 'archive': unlock = true; reason = '解锁一条己方私人情报；不自动公开或加分。'; break;
        case 'interrogate': p.extraQuestion = true; reason = '储存免调查且强化 2 分的质询机会，不增加回合。'; break;
        case 'firewall': p.firewall = true; reason = '防火墙将抵消下一次最多 15 点稳定度损失。'; break;
        case 'extension': p.preparation = 1; reason = '下一次有效双证关联沿原方向额外强化 2 分。'; break;
      } break; }
    case 'closing_statement': {
      const count = favorable(state, side).length;
      if (command.tactic === 'logical_summary') { delta = dir * Math.min(count, 2); reason = `前三轮 ${count} 次有利行动，逻辑总结产生 ${Math.min(count, 2)} 分收益。`; }
      if (command.tactic === 'evidence_rebuttal') { next.countered.push(target!.id); delta = -Math.sign(target!.scoreDelta!) * Math.min(3, Math.abs(target!.scoreDelta!)); reason = '最终集中反驳逆转目标论点至多 3 分。'; }
      if (command.tactic === 'forceful_closing') { delta = dir * 3; reason = '稳定度与有利行动次数达标，强势陈词产生 3 分收益。'; }
      if (command.tactic === 'risky_closing') reason = '冒险陈词由服务器进行一次概率判定。'; break;
    }
  }
  if (delta * dir < 0) logicLoss = -12;
  let random: GameEvent['random'];
  if (command.tactic === 'assertive') {
    if (delta * dir > 0) delta = dir * (choice.actionType === 'counter_argument' ? Math.min(Math.abs(delta) + 2, Math.abs(target!.scoreDelta!)) : Math.abs(delta) + 2);
    failureLoss -= 5; reason += ' 强势进攻自身损失 5 稳定度。';
  }
  if (command.tactic === 'risky' || command.tactic === 'risky_closing') {
    const threshold = before.stability >= 80 ? 60 : 40, roll = options.roll ?? randomInt(1, 101);
    if (!Number.isInteger(roll) || roll < 1 || roll > 100) throw new Error('随机记录不合法');
    const qualified = command.tactic === 'risky_closing' || delta * dir > 0, succeeded = qualified && roll <= threshold; random = { roll, threshold, qualified, succeeded };
    if (succeeded) { delta += dir * 4; reason += ' 冒险成功，获得额外 4 分收益。'; }
    else { if (delta * dir > 0) delta = 0; failureLoss = -15; opponentLoss = 0; unlock = false; clearPreparation = false; reason += ' 冒险失败：取消有利收益及成功附带效果，稳定度 -15；成本与披露不退还。'; }
  }
  if (unlock) {
    const entry = template.evidence.find(e => e.visibility === side && !p.knownEvidenceIds.includes(e.id) && (!linked || linked.linkedIds.includes(e.id) || e.linkedIds.includes(linked.id)));
    if (entry) { p.knownEvidenceIds.push(entry.id); append(next, { kind: 'system', side, round: state.round, text: '该方获得一条预置私人调查情报，内容仅本人可见。' }); }
  }
  if (clearPreparation) opponent.preparation = 0;
  if (opponentLoss) stability(next, other(side), opponentLoss, '对方成功反制使稳定度下降。', side);
  if (failureLoss || logicLoss) stability(next, side, failureLoss + logicLoss, '', side);
  if (logicLoss) reason += ' 所选方向不利本方，触发逻辑冲突 -12 稳定度。';
  next.score = clamp(state.score + delta); p.actionPoints--; p.lastAction = choice.actionType;
  const event = append(next, { id: command.actionId, kind: 'action', side, round: state.round, text: action.speech, action, command,
    actorId: options.actorId, occurredAt: options.now ?? new Date().toISOString(), accepted: true, successful: success || (next.score - state.score) * dir > 0,
    reason, scoreDelta: next.score - state.score, stabilityDelta: p.stability - before.stability, stabilityAfter: p.stability, ...(random ? { random } : {}),
    resources: { investigationBefore: before.investigation, investigationAfter: p.investigation, usedItems: [...p.usedItems], scientificAnalysisUsed: p.scientificAnalysisUsed } });
  next.completedActions++;
  if (next.completedActions === 8) {
    next.phase = 'finished'; const convicted = next.score >= template.threshold;
    next.verdict = { winner: convicted ? 'prosecution' : 'defense', convicted, score: next.score, threshold: template.threshold,
      explanation: `最终控方证据强度 ${next.score}，定罪阈值 ${template.threshold}。${convicted ? '达到阈值，控方胜诉。' : '未达到阈值，被告获得无罪判决。'}判决依据行动、战术及记录的随机结果，由程序计算。` };
    append(next, { kind: 'verdict', round: 4, text: next.verdict.explanation });
  } else { next.turn = other(side); next.round = Math.floor(next.completedActions / 2) + 1; next.phase = next.completedActions >= 6 ? 'closing' : 'debate'; }
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
  const prefix = ({ rigorous: '根据可核验材料，', aggressive: '请正面回应这条证据：', cunning: '我方要指出一个被忽略的环节：', chaotic: '法官大人，请先把想象力放回证物袋。' })[config.personality];
  return { ...structuredClone(expected), speech: `${prefix}${expected.speech}${value < 80 ? '我的逻辑有点打结，但仍请按记录和规则审查。' : ''}`, tone: value < 40 ? 'bewildered' : 'calm' };
}
export function replayScore(template: CaseTemplate, events: GameEvent[]) { return events.filter(e => e.kind === 'action').reduce((score, e) => clamp(score + (e.scoreDelta ?? 0)), template.initialScore); }
export function replayGame(template: CaseTemplate, configs: Record<Side, PublicConfig>, events: GameEvent[]): EngineState | LegacyEngineState {
  if (template.engineVersion !== 2) return replayLegacy(template, configs, events);
  let replay = createGame(template, configs);
  for (const e of events.filter(e => e.kind === 'action')) {
    if (!e.side || !e.command || !e.action || !e.actorId || !e.occurredAt) throw new Error('回合记录缺少必要字段');
    replay = finalizeAction(prepareAction(template, replay, e.side, e.command, { turnId: e.command.turnId, actorId: e.actorId, roll: e.random?.roll, now: e.occurredAt }), e.action);
  }
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
  if (JSON.stringify(canonical(replay.events)) !== JSON.stringify(canonical(events))) throw new Error('行动记录与案件规则不一致');
  return replay;
}
