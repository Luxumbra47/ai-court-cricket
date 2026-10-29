import { randomInt } from 'node:crypto';
import type { Action, ActionCommand, ActionOption, ActionType, CaseTemplate, EngineState, GameEvent, ItemId, PublicConfig, Side, StyleOption, Tactic, TrialStage } from '../shared/types.js';
import { SIDE_NAMES, TACTICS } from '../shared/types.js';
import { V3_RULES as R, V3_PROFILE, pressureExtra, riskChance, stageFor } from '../shared/rules.js';
import { actionSchema, commandSchema } from './commands.js';
import { ITEM_CATALOG } from './cases.js';

const other = (s: Side): Side => s === 'defense' ? 'prosecution' : 'defense';
const dir = (s: Side) => s === 'prosecution' ? 1 : -1;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const key = (s: Side, id: string) => `${s}:${id}`;
const pair = (ids: string[]) => [...ids].sort().join(',');
const argumentTypes: ActionType[] = ['present_evidence', 'challenge_evidence', 'timeline_analysis', 'counter_argument', 'cross_examination', 'closing_statement'];
const favorable = (s: EngineState, side: Side) => s.events.filter(e => e.kind === 'action' && e.stage !== 'closing' && e.side === side && (e.scoreDelta ?? 0) * dir(side) > 0);
function append(s: EngineState, input: Omit<GameEvent, 'id' | 'sequence' | 'scoreAfter'> & { id?: string }) {
  const event: GameEvent = { ...input, id: input.id ?? `event-${s.events.length + 1}`, sequence: s.events.length + 1, scoreAfter: s.score }; s.events.push(event); return event;
}
export function createGameV3(t: CaseTemplate, configs: Record<Side, PublicConfig>): EngineState {
  if (!t.variant) throw new Error('新局缺少已冻结的案件变体');
  if (Object.entries(V3_PROFILE).some(([key, value]) => JSON.stringify(t.ruleProfile?.[key]) !== JSON.stringify(value))) throw new Error('规则快照与v3版本不一致');
  for (const side of ['defense', 'prosecution'] as Side[]) {
    if (!t.variant.initialPrivateIds[side].length || t.variant.initialPrivateIds[side].some(id => !t.evidence.some(e => e.id === id && e.visibility === side))) throw new Error('起始私证阵营不一致');
    for (const l of (t.leads ?? []).filter(l => l.side === side)) if (l.revealsIds.some(id => !t.evidence.some(e => e.id === id && e.visibility === side)) || l.requiresIds.some(id => !t.evidence.some(e => e.id === id && (e.visibility === side || e.visibility === 'public')))) throw new Error('调查线索权限不一致');
  }
  const publicIds = t.evidence.filter(e => e.visibility === 'public').map(e => e.id);
  const player = (side: Side) => ({ side, identity: configs[side].identity, scientificAnalysisUsed: false, extraQuestion: false,
    stability: R.initialCalm, actionPoints: R.perPlayer, investigation: configs[side].identity === 'tycoon' ? 3 : configs[side].identity === 'civilian' ? 2 : 1,
    items: [...new Set(configs[side].items)].slice(0, 3), usedItems: [] as ItemId[], knownEvidenceIds: [...publicIds, ...t.variant!.initialPrivateIds[side]],
    firewall: false, preparation: 0, lastAction: null, failureStreak: 0, composurePhases: [] as TrialStage[], civilianRecoveryUsed: false, tycoonInvestigationUsed: false });
  return { rulesVersion: 3, caseId: t.id, caseVersion: t.version, score: t.initialScore, round: 1, turn: 'defense', phase: 'debate', stage: 'investigation',
    opportunities: 0, skippedOpportunities: 0, completedActions: 0, triggeredEvents: [], crossExamined: [],
    players: { defense: player('defense'), prosecution: player('prosecution') }, events: [], publicEvidenceIds: publicIds, presented: [], challenged: [], analyzed: [], reviewed: [], countered: [], verdict: null };
}
export function legalLeads(t: CaseTemplate, s: EngineState, side: Side, batch = false) {
  const known = new Set(s.players[side].knownEvidenceIds), own = (t.leads ?? []).filter(l => l.side === side && l.revealsIds.some(id => !known.has(id)));
  const direct = own.filter(l => l.requiresIds.every(id => known.has(id)));
  if (!batch) return direct;
  const reachable = new Set([...known, ...direct.flatMap(l => l.revealsIds)]);
  return own.filter(l => l.requiresIds.every(id => reachable.has(id)));
}
function styles(s: EngineState, side: Side, type: ActionType): StyleOption[] {
  if (['use_item', 'review_evidence', 'investigate_lead', 'regain_composure'].includes(type)) return [{ id: 'steady', label: TACTICS.steady, description: '固定效果，不受失控随机惩罚。', enabled: true }];
  const result: StyleOption[] = [{ id: 'steady', label: TACTICS.steady, description: '按材料本身论证。', enabled: true }];
  if (['counter_argument', 'cross_examination'].includes(type)) result.push({ id: 'assertive', label: TACTICS.assertive, description: '有效收益额外 2 点；反驳不超过原得分。自身冷静值消耗 3 点。', enabled: true });
  result.push({ id: 'risky', label: TACTICS.risky, enabled: true, probability: riskChance(s.players[side].stability), description: `材料支持本方时，${riskChance(s.players[side].stability)}%机会额外争取4点；失败取消有利效果，自身承受6点压力（冷静值不高于50时8点）。` }); return result;
}
export function getActionOptionsV3(t: CaseTemplate, s: EngineState, side: Side): ActionOption[] {
  if (s.phase === 'finished') return [];
  const p = s.players[side], visible = t.evidence.filter(e => s.publicEvidenceIds.includes(e.id) || p.knownEvidenceIds.includes(e.id));
  const pub = visible.filter(e => s.publicEvidenceIds.includes(e.id));
  const opposing = s.events.filter(e => e.kind === 'action' && e.side === other(side) && e.stage !== 'closing' && argumentTypes.includes(e.action!.action_type));
  const counters = opposing.filter(e => e.action!.action_type !== 'counter_argument' && !s.countered.includes(e.id) && (e.scoreDelta ?? 0) * dir(other(side)) > 0);
  const make = (id: string, type: ActionType, label: string, description: string, evidenceIds: string[] = [], min = 0, max = min, targets: string[] = [], targetRequired = false, group: ActionOption['group'] = 'main', itemId: ItemId | null = null): ActionOption => ({
    id, actionType: type, label, description, evidenceIds, minEvidence: min, maxEvidence: max, targetIds: targets, targetRequired, group, itemId,
    styles: styles(s, side, type), cost: '使用后结束本回合。', risk: '', enabled: evidenceIds.length >= min && (!targetRequired || !!targets.length), reason: evidenceIds.length < min ? '没有尚可使用的材料' : targetRequired && !targets.length ? '目前没有可回应的对方论点' : undefined });
  if (s.stage === 'closing') return (['logical_summary', 'evidence_rebuttal', 'forceful_closing', 'risky_closing'] as Tactic[]).map(tactic => {
    const rebuttal = tactic === 'evidence_rebuttal', o = make(`closing:${tactic}`, 'closing_statement', TACTICS[tactic], '围绕已公开的交锋作最后陈述。', pub.map(e => e.id), rebuttal ? 1 : 0, 3, rebuttal ? counters.map(e => e.id) : [], rebuttal);
    const description = tactic === 'logical_summary' ? '此前每次有利论证贡献1点，总结最多2点。' : rebuttal ? '反驳一个尚未被反制的得分论点，最多抵消3点。' : tactic === 'forceful_closing' ? '至少两次有利论证时得3点，不限制冷静值。' : `检定成功得4点，成功机会${riskChance(p.stability)}%；失败承受6或8点压力。`;
    o.styles = [{ id: tactic, label: o.label, description, enabled: true }];
    if (tactic === 'forceful_closing' && favorable(s, side).length < 2) { o.enabled = false; o.reason = '此前至少需要两次有利论证'; } return o;
  }).filter(o => t.allowedActions.includes(o.actionType));
  const ids = (list: typeof visible) => list.map(e => e.id), reviewed = (id: string) => s.reviewed.includes(key(side, id));
  const main = [make(`${side}:present`, 'present_evidence', '出示证据', '正式出示一份尚未提交的材料。', ids(visible.filter(e => !s.presented.includes(e.id))), 1),
    make(`${side}:challenge`, 'challenge_evidence', '质疑证据', '指出公开材料的证明局限，每方每份只能质疑一次。', ids(pub.filter(e => !s.challenged.includes(key(side, e.id)))), 1)];
  const research = [make(`${side}:investigate`, 'investigate_lead', '调查线索', '沿本人掌握的线索查找下一份预置材料。', [], 0, 0, [], false, s.stage === 'investigation' ? 'main' : 'resource'),
    make(`${side}:review`, 'review_evidence', '重新检查证据', '复核一份技术记录，每方每份只能检查一次。', ids(pub.filter(e => e.technical && !reviewed(e.id))), 1, 1, [], false, s.stage === 'investigation' ? 'main' : 'resource')];
  const leads = legalLeads(t, s, side), inv = research[0]; inv.leads = leads.map(l => ({ id: l.id, label: l.label, description: l.description })); inv.minLeads = inv.maxLeads = 1;
  inv.enabled = leads.length > 0 && p.investigation > 0; inv.reason = !p.investigation ? '调查资源已用尽' : !leads.length ? '当前没有新的调查方向' : undefined; inv.cost += '消耗1次调查，所得仅你可见。';
  if (s.stage === 'debate') main.push(
    make(`${side}:counter`, 'counter_argument', '找出对方漏洞', '回应对方尚未被反制的得分论点。', ids(visible), 1, 3, counters.map(e => e.id), true),
    make(`${side}:link`, 'timeline_analysis', '组合证据', '核对两份尚未以该组合分析过的材料。', ids(visible), 2, 2),
    make(`${side}:cross`, 'cross_examination', '追问对方', '用材料追问尚未被本方追问过的论点。', ids(visible), 1, 1, opposing.filter(e => !s.crossExamined?.includes(key(side, e.id))).map(e => e.id), true, 'resource'));
  const recovery = make('regain', 'regain_composure', '整理思路', '花本回合稳住思路，每阶段一次。', [], 0, 0, [], false, 'resource');
  recovery.enabled = p.stability < 100 && !p.composurePhases?.includes(s.stage!); recovery.reason = p.stability === 100 ? '冷静值已满' : p.composurePhases?.includes(s.stage!) ? '本阶段已经整理过思路' : undefined;
  const result = [...main, ...research, recovery];
  if (p.identity === 'tycoon' && !p.tycoonInvestigationUsed) {
    const o = make('skill:double', 'investigate_lead', '富豪并行调查', '一次行动花两份调查资源，沿两条可到达的线索连续调查。', [], 0, 0, [], false, 'resource');
    o.leads = legalLeads(t, s, side, true).map(l => ({ id: l.id, label: l.label, description: l.description })); o.minLeads = o.maxLeads = 2;
    o.enabled = p.investigation >= 2 && o.leads.length >= 2; o.reason = !o.enabled ? '需要两份调查资源和两条可到达线索' : undefined; o.cost += '消耗2次调查；每局一次。'; result.push(o);
  }
  for (const item of ITEM_CATALOG.filter(i => p.items.includes(i.id))) {
    const materials = item.id === 'magnifier' ? visible.filter(e => e.technical && !reviewed(e.id)) : [];
    const o = make(`item:${item.id}`, 'use_item', item.name, item.description, ids(materials), item.id === 'magnifier' ? 1 : 0, item.id === 'magnifier' ? 1 : 0, [], false, 'resource', item.id);
    if (p.usedItems.includes(item.id)) { o.enabled = false; o.reason = '本局已经使用'; }
    if (item.id === 'coffee' && p.stability === 100) { o.enabled = false; o.reason = '冷静值已满'; }
    if (item.id === 'archive' && !t.evidence.some(e => e.visibility === side && !p.knownEvidenceIds.includes(e.id))) { o.enabled = false; o.reason = '额外材料已全部掌握'; }
    if ((item.id === 'firewall' && p.firewall) || (item.id === 'interrogate' && p.extraQuestion) || (item.id === 'extension' && p.preparation)) { o.enabled = false; o.reason = '相同准备已经生效'; } result.push(o);
  }
  for (const o of result) {
    if (o.actionType === 'timeline_analysis') o.evidencePairs = o.evidenceIds.flatMap((a, i) => o.evidenceIds.slice(i + 1).filter(b => !s.analyzed.includes(key(side, pair([a, b])))).map(b => [a, b] as [string, string]));
    if (o.actionType === 'review_evidence' || o.itemId === 'magnifier') {
      const free = p.identity === 'scientist' && !p.scientificAnalysisUsed; o.cost += free ? '首次技术检查免调查。' : '消耗1次调查。';
      if (!free && p.investigation < 1) { o.enabled = false; o.reason = '调查资源已用尽'; }
    }
    if (o.actionType === 'cross_examination') { o.cost += p.extraQuestion ? '使用储存的追问机会。' : '消耗1次调查。'; if (!p.extraQuestion && !p.investigation) { o.enabled = false; o.reason = '没有可用追问资源'; } }
    if (o.actionType === 'timeline_analysis' && !o.evidenceIds.some((a, i) => o.evidenceIds.slice(i + 1).some(b => !s.analyzed.includes(key(side, pair([a, b])))))) { o.enabled = false; o.reason = '可选组合已经分析完毕'; }
  }
  return result.filter(o => t.allowedActions.includes(o.actionType));
}
function verdict(s: EngineState, t: CaseTemplate) {
  s.phase = 'finished'; s.stage = 'finished'; const convicted = s.score >= t.threshold;
  s.verdict = { winner: convicted ? 'prosecution' : 'defense', convicted, score: s.score, threshold: t.threshold,
    explanation: `最终控方证据强度${s.score}，胜诉阈值${t.threshold}。${convicted ? '达到阈值，控方胜诉。' : '没有达到阈值，辩方胜诉，被告获得无罪判决。'}案件真相与本局证据是否充分是两件事。` };
  append(s, { kind: 'verdict', round: s.round, stage: 'finished', text: s.verdict.explanation });
}
function moveTurn(s: EngineState, t: CaseTemplate) {
  const slot = s.opportunities!;
  if (slot >= R.opportunities) return verdict(s, t);
  s.turn = slot % 2 === 0 ? 'defense' : 'prosecution'; s.stage = stageFor(slot); s.phase = s.stage === 'closing' ? 'closing' : 'debate';
  s.round = Math.floor(slot / 2) + 1;
}
export function skipExhausted(t: CaseTemplate, input: EngineState): EngineState {
  const s = structuredClone(input);
  while (s.phase !== 'finished' && !getActionOptionsV3(t, s, s.turn).some(o => o.enabled)) {
    append(s, { kind: 'skip', side: s.turn, round: s.round, stage: s.stage, text: `${SIDE_NAMES[s.turn]}本阶段已经没有合法且有意义的行动，跳过本次机会，不消耗资源或模型调用。` });
    s.skippedOpportunities!++; s.opportunities!++; moveTurn(s, t);
  } return s;
}
export interface PreparedActionV3 { command: ActionCommand; action: Action; next: EngineState; event: GameEvent; side: Side }
export function prepareActionV3(t: CaseTemplate, s: EngineState, side: Side, input: unknown, options: { turnId: string; actorId: string; roll?: number; meltdownRoll?: number; now?: string }): PreparedActionV3 {
  const command = commandSchema.parse(input), { tactic } = command;
  if (s.phase === 'finished') throw new Error('对局已结束');
  if (s.caseId !== t.id || s.caseVersion !== t.version || s.turn !== side || s.rulesVersion !== 3) throw new Error('不能越过回合或使用不同案件版本');
  if (command.turnId !== options.turnId) throw new Error('回合已过期');
  if (s.events.some(e => e.id === command.actionId)) throw new Error('重复行动');
  const choice = getActionOptionsV3(t, s, side).find(o => o.id === command.optionId);
  if (!choice?.enabled || !choice.styles.some(style => style.id === tactic && style.enabled)) throw new Error(choice?.reason ?? '本阶段不允许此行动或战术');
  if (command.evidenceIds.length < choice.minEvidence || command.evidenceIds.length > choice.maxEvidence || command.evidenceIds.some(id => !choice.evidenceIds.includes(id))) throw new Error('材料不存在、无权使用或数量不符');
  if (choice.itemId !== command.itemId || (choice.targetRequired ? !command.targetArgumentId || !choice.targetIds.includes(command.targetArgumentId) : command.targetArgumentId !== null)) throw new Error('道具或论点目标不合法');
  const target = s.events.find(e => e.id === command.targetArgumentId);
  if (target && ['counter_argument', 'closing_statement'].includes(choice.actionType) && !target.action!.cited_evidence_ids.some(id => command.evidenceIds.includes(id))) throw new Error('反驳需要引用目标论点的材料');
  const leadIds = command.leadIds ?? [];
  if (choice.actionType === 'investigate_lead') {
    if (leadIds.length < choice.minLeads! || leadIds.length > choice.maxLeads! || leadIds.some(id => !choice.leads!.some(l => l.id === id))) throw new Error('请选择合法的调查方向');
    const known = new Set(s.players[side].knownEvidenceIds); let todo = [...leadIds];
    while (todo.length) { const id = todo.find(id => t.leads!.find(l => l.id === id)!.requiresIds.every(e => known.has(e))); if (!id) throw new Error('调查的前置线索尚未满足'); t.leads!.find(l => l.id === id)!.revealsIds.forEach(e => known.add(e)); todo = todo.filter(x => x !== id); }
  } else if (leadIds.length) throw new Error('本行动不能指定调查线索');
  if (choice.actionType === 'timeline_analysis' && s.analyzed.includes(key(side, pair(command.evidenceIds)))) throw new Error('不能重复分析同一组合');
  const n = structuredClone(s), p = n.players[side], op = n.players[other(side)], before = s.players[side], selected = t.evidence.filter(e => command.evidenceIds.includes(e.id)), names = selected.map(e => `「${e.title}」`).join('和');
  const isArgument = argumentTypes.includes(choice.actionType), costs = ['使用1次行动机会'], rules: string[] = [choice.actionType];
  const action: Action = { action_type: choice.actionType, speech: '', cited_evidence_ids: [...command.evidenceIds], target_argument_id: command.targetArgumentId, item_id: command.itemId, tone: 'calm' };
  let delta = 0, pressure = 0, failure = 0, conditionMet = true, reason = '', unlock = false, counter = false, clearPreparation = false;
  const spendInvestigation = () => { if (!p.investigation) throw new Error('调查资源不足'); p.investigation--; costs.push('消耗1次调查'); };
  const recover = (amount: number) => { p.stability = clamp(p.stability + amount); };
  const alterCalm = (who: Side, amount: number) => { const actor = n.players[who]; if (amount < 0 && actor.firewall) { actor.firewall = false; amount = Math.min(0, amount + 15); costs.push(`消耗${SIDE_NAMES[who]}防火墙保护`); rules.push('firewall'); } actor.stability = clamp(actor.stability + amount); };
  const review = () => {
    const e = selected[0]; if (p.identity === 'scientist' && !p.scientificAnalysisUsed) { p.scientificAnalysisUsed = true; costs.push('使用科学家首次免费检查'); } else spendInvestigation();
    n.reviewed.push(key(side, e.id)); const flawed = e.flaw !== null || e.reliability < .65; delta = (flawed ? -4 : 3) * Math.sign(e.strength);
    reason = flawed ? `检查「${e.title}」发现${e.flaw ?? '材料存在证明局限'}，其证明力受到削弱。` : `「${e.title}」通过核对，原有证明方向得到加强。`;
  };
  n.publicEvidenceIds = [...new Set([...n.publicEvidenceIds, ...command.evidenceIds])];
  switch (choice.actionType) {
    case 'present_evidence': { const e = selected[0]; n.presented.push(e.id); delta = Math.round(e.strength * e.reliability * t.rules.presentMultiplier); reason = `「${e.title}」已正式出示。${e.supports} ${e.limitations}`; break; }
    case 'challenge_evidence': { const e = selected[0]; n.challenged.push(key(side, e.id)); conditionMet = e.flaw !== null || e.reliability < .65;
      if (conditionMet) { delta = -Math.sign(e.strength) * (t.rules.challengeBonus + Math.round(Math.abs(e.strength) * (1 - e.reliability))); reason = `质疑成立：${e.flaw ?? e.limitations}。「${e.title}」的证明力被削弱。`; }
      else { failure = R.failedArgument; reason = `本次没有找出足以削弱「${e.title}」的问题，质疑未获支持。`; } break; }
    case 'timeline_analysis': { n.analyzed.push(key(side, pair(command.evidenceIds))); const relation = t.timelineRules?.find(r => pair(r.evidenceIds) === pair(command.evidenceIds)); conditionMet = !!relation;
      if (relation) { delta = relation.delta; reason = relation.explanation ?? `两份材料形成案件认可的证据关系。`; if (p.preparation) { delta += Math.sign(delta) * 2; p.preparation--; costs.push('使用组合准备机会'); } }
      else { failure = R.failedArgument; reason = `${names}未能形成支持本次推断的关系，组合没有成立。`; } break; }
    case 'counter_argument': delta = -Math.sign(target!.scoreDelta!) * Math.min(Math.abs(target!.scoreDelta!), t.rules.counterBonus); counter = true; pressure = R.counterPressure; reason = `反驳回应了${SIDE_NAMES[other(side)]}此前围绕${names}的得分论点，抵消其部分说服力。`; break;
    case 'cross_examination': {
      n.crossExamined!.push(key(side, target!.id)); const extra = p.extraQuestion; if (extra) { p.extraQuestion = false; costs.push('使用储存的追问机会'); } else spendInvestigation();
      conditionMet = selected.some(e => e.reliability >= .7 && Math.sign(e.strength) === dir(side));
      if (conditionMet) { delta = dir(side) * (t.rules.crossBonus + (extra ? 2 : 0)); pressure = R.crossPressure; unlock = true; clearPreparation = true; reason = `${names}支持了本次追问，对方已经提出的解释受到动摇。`; }
      else { failure = R.failedArgument; reason = `${names}未能支持这次追问，资源已经使用，未建立有利论证。`; } break;
    }
    case 'review_evidence': review(); break;
    case 'investigate_lead': {
      const entries = t.leads!.filter(l => leadIds.includes(l.id)); for (const l of entries) { spendInvestigation(); p.knownEvidenceIds = [...new Set([...p.knownEvidenceIds, ...l.revealsIds])]; }
      if (command.optionId === 'skill:double') { p.tycoonInvestigationUsed = true; costs.push('使用富豪本局并行调查能力'); }
      reason = `已沿${entries.length}条线索取得预置材料，仅调查者可见；尚未向法庭出示，不立即改变证据强度。`; break;
    }
    case 'regain_composure': {
      let amount = R.recovery; if (p.identity === 'civilian' && !p.civilianRecoveryUsed) { amount += R.civilianRecovery; p.civilianRecoveryUsed = true; costs.push('使用贫民首次额外恢复'); }
      recover(amount); p.composurePhases!.push(s.stage!); reason = `花本回合重新梳理思路，冷静值实际恢复${p.stability - before.stability}点。`; break;
    }
    case 'use_item': {
      p.usedItems.push(command.itemId!); costs.push(`使用${ITEM_CATALOG.find(i => i.id === command.itemId)!.name}`);
      if (command.itemId === 'magnifier') { review(); unlock = true; }
      if (command.itemId === 'coffee') { recover(25); reason = `清醒咖啡实际恢复${p.stability - before.stability}点冷静值。`; }
      if (command.itemId === 'archive') { unlock = true; reason = '调阅一份预置私人材料，仅本人可见；尚未出示。'; }
      if (command.itemId === 'firewall') { p.firewall = true; reason = '防火墙准备完成，抵消下一次最多15点冷静值损失，不能抵消证据强度变化。'; }
      if (command.itemId === 'interrogate') { p.extraQuestion = true; reason = '下次追问免调查，并在有效时额外加强2点。'; }
      if (command.itemId === 'extension') { p.preparation = 1; reason = '下次有效组合沿原方向额外加强2点；有效追问可以打断准备。'; } break;
    }
    case 'closing_statement': {
      if (tactic === 'logical_summary') { const count = favorable(s, side).length; delta = dir(side) * Math.min(count, 2); reason = `此前${count}次有利论证，本次总结产生${Math.min(count, 2)}点基础效果。`; }
      if (tactic === 'evidence_rebuttal') { delta = -Math.sign(target!.scoreDelta!) * Math.min(3, Math.abs(target!.scoreDelta!)); counter = true; reason = '最终陈词针对对方尚未被反制的得分论点，抵消至多3点。'; }
      if (tactic === 'forceful_closing') { delta = dir(side) * 3; reason = '此前两次有利论证满足条件，强势陈词产生3点基础效果。'; }
      if (tactic === 'risky_closing') reason = '最终陈词采用冒险检定。'; break;
    }
  }
  if (tactic === 'assertive') { if (delta * dir(side) > 0) delta = dir(side) * (counter ? Math.min(Math.abs(delta) + 2, Math.abs(target!.scoreDelta!)) : Math.abs(delta) + 2); alterCalm(side, -R.assertiveCost); rules.push('assertive'); }
  let potentialBenefit = Math.max(0, delta * dir(side));
  let random: GameEvent['random'];
  const checkedRoll = (v: number | undefined) => { const result = v ?? randomInt(1, 101); if (!Number.isInteger(result) || result < 1 || result > 100) throw new Error('随机记录不合法'); return result; };
  if (tactic === 'risky' || tactic === 'risky_closing') {
    const roll = checkedRoll(options.roll), threshold = riskChance(before.stability), qualified = tactic === 'risky_closing' || delta * dir(side) > 0, succeeded = qualified && roll <= threshold;
    random = { roll, threshold, qualified, succeeded }; rules.push('risky');
    if (succeeded) { delta += dir(side) * 4; potentialBenefit = Math.max(potentialBenefit, delta * dir(side)); reason += '冒险检定成功，基础效果额外加强4点。'; }
    else { if (delta * dir(side) > 0) delta = 0; failure = before.stability <= 50 ? R.lowRiskyFailure : R.riskyFailure; conditionMet = false; pressure = 0; counter = false; unlock = false; clearPreparation = false; reason += qualified ? '冒险检定未通过，有利效果及成功附带效果取消。' : '材料没有满足冒险的有利条件，有利效果及成功附带效果取消。'; }
  }
  const hadAdverseEffect = delta * dir(side) < 0;
  let meltdown: GameEvent['meltdown'];
  if (before.stability === 0 && isArgument) {
    const roll = checkedRoll(options.meltdownRoll), occurred = roll <= R.meltdownThreshold, penalty = occurred ? Math.max(R.meltdownMinimum, potentialBenefit + R.meltdownExtra) : 0;
    meltdown = { roll, threshold: 70, occurred, penalty, line: occurred ? t.comicSlip! : '' }; rules.push('zero_calm');
    if (occurred) { delta = dir(side) * (Math.min(0, delta * dir(side)) - penalty); conditionMet = false; pressure = 0; counter = false; unlock = false; clearPreparation = false; reason += `冷静值为0，本次触发论证失控：取消有利效果，另向不利方向施加${penalty}点惩罚，原有不利效果保留。`; }
    else reason += '冷静值为0，但本次保持正常思维，继续按所选战术结算。';
  }
  const argumentFailure = isArgument && !conditionMet;
  if (argumentFailure) { p.failureStreak = (before.failureStreak ?? 0) + 1; if (failure) failure = Math.min(8, failure + (p.failureStreak >= 2 ? 2 : 0)); }
  else if (isArgument) p.failureStreak = 0;
  if (failure) { alterCalm(side, -failure); rules.push('argument_failure'); }
  if (hadAdverseEffect) { alterCalm(side, -R.adverseEvidence); rules.push('adverse_evidence'); reason += '材料或复核结果实际支持对方，本方承受6点压力。'; }
  if (counter) n.countered.push(target!.id);
  if (unlock) { const found = t.evidence.find(e => e.visibility === side && !p.knownEvidenceIds.includes(e.id) && (command.itemId !== 'magnifier' || selected[0].linkedIds.includes(e.id) || e.linkedIds.includes(selected[0].id))); if (found) p.knownEvidenceIds.push(found.id); }
  if (clearPreparation) op.preparation = 0;
  const eventNotices: { rule: string; title: string; text: string }[] = [];
  for (const rule of t.caseEvents ?? []) {
    const k = key(side, rule.id); if (n.triggeredEvents!.includes(k)) continue;
    const branch = rule.branches.find(b => b.side === side && b.evidenceIds.every(id => rule.kind === 'discovery' ? p.knownEvidenceIds.includes(id) : n.publicEvidenceIds.includes(id)));
    if (!branch) continue;
    if (rule.kind === 'discovery') {
      if (!branch.evidenceIds.some(id => !before.knownEvidenceIds.includes(id))) continue;
      n.triggeredEvents!.push(k); eventNotices.push({ rule: k, title: rule.title, text: '调查取得新的交接细节，仅调查者可以查看材料内容。' });
    } else {
      if (!isArgument || !conditionMet || delta * dir(side) <= 0 || meltdown?.occurred || !command.evidenceIds.some(id => branch.evidenceIds.includes(id))) continue;
      const challenged = [...s.events].reverse().find(e => e.kind === 'action' && e.side === other(side) && e.action?.cited_evidence_ids.some(id => branch.targetEvidenceIds.includes(id)) && (e.scoreDelta ?? 0) * dir(other(side)) > 0);
      if (!challenged) continue;
      n.triggeredEvents!.push(k); pressure = Math.max(pressure, R.contradictionPressure); rules.push(k); reason += branch.explanation;
      eventNotices.push({ rule: k, title: rule.title, text: branch.explanation });
    }
  }
  if (pressure) { const loss = Math.min(12, pressure + pressureExtra(s.players[other(side)].stability)); alterCalm(other(side), -loss); rules.push(pressure >= R.contradictionPressure ? 'critical_contradiction' : 'opponent_pressure'); }
  n.score = clamp(s.score + delta); const actual = n.score - s.score, favorableEffect = actual * dir(side) > 0;
  if (isArgument || delta) reason += actual === 0 ? delta ? '证据强度已触及边界，本次实际分数不变。' : '本次控方证据强度实际不变。' : `控方证据强度实际${actual > 0 ? '增加' : '降低'}${Math.abs(actual)}点，${favorableEffect ? '有利于' : '不利于'}${SIDE_NAMES[side]}。`;
  p.actionPoints--; p.lastAction = choice.actionType;
  const speech = choice.actionType === 'present_evidence' ? `请看${names}。${selected[0].supports} ${selected[0].limitations}` : choice.actionType === 'challenge_evidence' ? `${names}提供了一些线索，但${selected[0].limitations}。这一步不能省略。` : choice.actionType === 'timeline_analysis' ? `请把${names}放在一起看。事情的经过，需要两份记录互相解释。` : choice.actionType === 'counter_argument' ? `对方刚才的说法还缺少一步。${names}能说明一些事情，但${selected[0].limitations}。` : choice.actionType === 'cross_examination' ? `请正面回答：${selected[0].description} ${selected[0].limitations}。这与你刚才的说法如何对应？` : choice.actionType === 'review_evidence' ? `请仔细核对${names}。我们需要确认记录能证明到哪一步。` : choice.actionType === 'investigate_lead' ? '案情还有没理清的细节。我申请沿手头线索继续调查，核对后再向法庭出示。' : choice.actionType === 'regain_composure' ? '容我理一理思路。接下来我会把事实和推断分开，逐条回应。' : choice.actionType === 'use_item' ? ({ magnifier: `请放大检查${names}。细节决定记录能说明什么。`, coffee: '先喝口咖啡，让绕成麻花的思路慢慢松开。', archive: '我申请查阅手头尚未打开的档案。先看清材料，再作判断。', interrogate: '下次我要把问题问得更清楚，先整理一下重点。', firewall: '争辩再热闹，我也会稳住思路，逐条回应。', extension: '请给我这一回合梳理材料，下一步再解释它们之间的联系。' }[command.itemId!]) : `${side === 'defense' ? '关键是指控是否获得充分证明。' : '请综合庭上已经出示的材料。'}刚才的交锋已经摆明争议，请依据这些证据作出判断。`;
  action.speech = meltdown?.occurred ? `${meltdown.line} 我刚才的推理绕远了。` : speech;
  action.tone = meltdown?.occurred ? 'absurd' : before.stability <= 25 ? 'strained' : 'calm';
  const event = append(n, { id: command.actionId, kind: 'action', side, round: s.round, stage: s.stage, text: action.speech, action, command, actorId: options.actorId, occurredAt: options.now ?? new Date().toISOString(),
    accepted: true, successful: conditionMet, reason, scoreDelta: actual, stabilityDelta: p.stability - before.stability, stabilityAfter: p.stability,
    ...(random ? { random } : {}), ...(meltdown ? { meltdown } : {}), resources: { investigationBefore: before.investigation, investigationAfter: p.investigation, usedItems: [...p.usedItems], scientificAnalysisUsed: p.scientificAnalysisUsed } });
  for (const notice of eventNotices) append(n, { kind: 'case_event', side, round: s.round, stage: s.stage, ruleId: notice.rule, text: `${notice.title}：${notice.text}` });
  n.completedActions++; n.opportunities!++; moveTurn(n, t);
  const afterSkips = skipExhausted(t, n);
  const outcome = meltdown?.occurred ? 'meltdown' : actual * dir(side) < 0 ? 'backfired' : !conditionMet ? 'failed' : actual === 0 && isArgument ? 'no_effect' : 'effective';
  const settledEvent = afterSkips.events.find(e => e.id === event.id)!;
  settledEvent.settlement = { scoreBefore: s.score, scoreAfter: afterSkips.score,
    calmChanges: { defense: afterSkips.players.defense.stability - s.players.defense.stability, prosecution: afterSkips.players.prosecution.stability - s.players.prosecution.stability },
    costs, nextSide: afterSkips.phase === 'finished' ? null : afterSkips.turn, conditionMet, favorable: favorableEffect,
    affectedSides: (['defense', 'prosecution'] as Side[]).filter(who => afterSkips.players[who].stability !== s.players[who].stability || actual !== 0), ruleIds: rules, outcome, explanation: reason,
    impact: afterSkips.verdict ? afterSkips.verdict.explanation : afterSkips.score >= t.threshold ? '控方已达到阈值，但仍须等待双方完成剩余交锋与陈词。' : `控方距离胜诉阈值还差${t.threshold - afterSkips.score}点。` };
  return { command, action, next: afterSkips, event: settledEvent, side };
}
export function finalizeActionV3(p: PreparedActionV3, input: unknown) {
  const a = actionSchema.parse(input);
  if (a.action_type !== p.action.action_type || pair(a.cited_evidence_ids) !== pair(p.action.cited_evidence_ids) || a.target_argument_id !== p.action.target_argument_id || a.item_id !== p.action.item_id) throw new Error('模型不能修改玩家指令');
  if (p.event.meltdown?.occurred && !a.speech.startsWith(p.event.meltdown.line)) a.speech = `${p.event.meltdown.line} ${a.speech}`.slice(0, 800);
  p.event.text = a.speech; p.event.action = a; return p.next;
}
export function replayGameV3(t: CaseTemplate, configs: Record<Side, PublicConfig>, events: GameEvent[]) {
  let state = skipExhausted(t, createGameV3(t, configs));
  for (const e of events.filter(e => e.kind === 'action')) {
    if (!e.command || !e.side || !e.action || !e.actorId || !e.occurredAt) throw new Error('行动记录缺少必要字段');
    state = finalizeActionV3(prepareActionV3(t, state, e.side, e.command, { turnId: e.command.turnId, actorId: e.actorId, roll: e.random?.roll, meltdownRoll: e.meltdown?.roll, now: e.occurredAt }), e.action);
  }
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['presentation', 'comparison'].includes(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, canonical(val)])) : v;
  if (JSON.stringify(canonical(state.events)) !== JSON.stringify(canonical(events))) throw new Error('行动记录与规则不一致'); return state;
}
