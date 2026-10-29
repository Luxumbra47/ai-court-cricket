import type { ActionCommand, ActionForecast, ActionPreview, CaseTemplate, EngineState, MatchMode, Side } from '../shared/types.js';
import { riskChance } from '../shared/rules.js';
import { getActionOptionsV3, prepareActionV3, type PreparedActionV3 } from './game-v3.js';
import { ITEM_CATALOG } from './cases.js';
import { playerText } from '../shared/presentation.js';
const other = (s: Side): Side => s === 'defense' ? 'prosecution' : 'defense';
const direction = (s: Side) => s === 'prosecution' ? 1 : -1;
export function buildPreviewV3(t: CaseTemplate, s: EngineState, side: Side, c: ActionCommand, mode: MatchMode, previewId: string): ActionPreview {
  // Real-template dry-run validates access only. Its hidden outcome is never used for the forecast.
  prepareActionV3(t, s, side, c, { turnId: c.turnId, actorId: 'preview', roll: 1, meltdownRoll: 1, now: 'preview' });
  const o = getActionOptionsV3(t, s, side).find(o => o.id === c.optionId)!, p = s.players[side];
  const selected = t.evidence.filter(e => c.evidenceIds.includes(e.id));
  const costs = ['使用后结束本回合。'];
  if (o.actionType === 'investigate_lead') costs.push(`消耗${c.leadIds!.length}次调查，所得仅你可见。`);
  if (o.actionType === 'cross_examination') costs.push(p.extraQuestion ? '使用储存的追问机会。' : '消耗1次调查。');
  if (o.actionType === 'review_evidence' || c.itemId === 'magnifier') costs.push(p.identity === 'scientist' && !p.scientificAnalysisUsed ? '使用科学家首次免费检查。' : '消耗1次调查。');
  if (c.itemId) costs.push(`消耗${ITEM_CATALOG.find(i => i.id === c.itemId)!.name}，本局不能重复使用。`);
  if (c.optionId === 'skill:double') costs.push('使用富豪本局一次的并行调查能力。');
  const result: ActionPreview = { previewId, turnId: c.turnId, mode, purpose: c.itemId ? ({ coffee: '喝咖啡整理思路。', magnifier: '检查一份符合条件的记录。', archive: '调阅本人尚未查看的档案。', interrogate: '为下一次追问做准备。', firewall: '为激烈交锋做好心理准备。', extension: '梳理下一次要组合的材料。' }[c.itemId]) : o.description,
    targets: [...selected.map(e => e.title), ...(o.leads ?? []).filter(l => c.leadIds?.includes(l.id)).map(l => l.label)],
    requirements: ['本方回合、合法目标及足够资源；确认后才提交。'], costs,
    disclosure: selected.filter(e => !s.publicEvidenceIds.includes(e.id)).map(e => e.title) };
  if (o.targetRequired) result.requirements.push('回应目标公开发言，反驳时须引用其材料。');
  if (o.actionType === 'regain_composure') result.requirements.push('冷静值未满，且本阶段尚未整理过思路。');
  if (c.tactic === 'forceful_closing') result.requirements.push('此前至少两次有利论证。');
  if (o.actionType === 'review_evidence' || c.itemId === 'magnifier') result.requirements.push('同一材料每方只可检查一次。');
  if (mode === 'hardcore') return result;
  const argument = !['use_item', 'review_evidence', 'investigate_lead', 'regain_composure'].includes(o.actionType);
  const hidden = ['present_evidence', 'challenge_evidence', 'timeline_analysis', 'cross_examination', 'review_evidence'].includes(o.actionType) || c.itemId === 'magnifier';
  const risky = ['risky', 'risky_closing'].includes(c.tactic), melting = argument && p.stability === 0;
  const opposing = [...s.events].reverse().find(e => e.kind === 'action' && e.side === other(side) && (e.scoreDelta ?? 0) * direction(other(side)) > 0 && e.action?.cited_evidence_ids.length);
  const maybePressure = argument && !!opposing && !!selected.length;
  const possibilities: PreparedActionV3[] = [];
  const simulate = (variant: CaseTemplate) => {
    for (const extra of maybePressure ? [false, true] : [false]) for (const roll of risky ? [1, 100] : [1]) for (const meltdownRoll of melting ? [1, 100] : [1]) {
      const hypothetical: CaseTemplate = { ...variant, caseEvents: extra ? [{ id: 'public-possibility', kind: 'contradiction', title: '可能的矛盾核对', branches: [{ side, evidenceIds: c.evidenceIds, targetEvidenceIds: opposing!.action!.cited_evidence_ids, explanation: '若公开材料回应了既有论点，会产生压力。' }] }] : [] };
      possibilities.push(prepareActionV3(hypothetical, s, side, c, { turnId: c.turnId, actorId: 'preview', roll, meltdownRoll, now: 'preview' }));
    }
  };
  if (!hidden) simulate(t);
  else if (o.actionType === 'timeline_analysis') for (const delta of [-100, 0, 100]) simulate({ ...t, timelineRules: delta ? [{ evidenceIds: c.evidenceIds as [string, string], delta }] : [] });
  else {
    const limit = Math.max(100, 100 / t.rules.presentMultiplier);
    for (const strength of [-limit, 0, limit]) for (const reliability of [0, .7, 1]) for (const flaw of [null, '待核对']) simulate({ ...t, evidence: t.evidence.map(e => c.evidenceIds.includes(e.id) ? { ...e, strength, reliability, flaw, linkedIds: [] } : e) });
  }
  const range = (get: (v: PreparedActionV3) => number): [number, number] => [Math.min(...possibilities.map(get)), Math.max(...possibilities.map(get))];
  const score = range(v => v.event.scoreDelta!), selfCalm = range(v => v.next.players[side].stability - p.stability), opponentCalm = range(v => v.next.players[other(side)].stability - s.players[other(side)].stability);
  const certain = !hidden && !risky && !melting && !maybePressure;
  const good = score.some(n => n * direction(side) > 0), bad = score.some(n => n * direction(side) < 0);
  const f: ActionForecast = { certainty: certain ? 'certain' : 'conditional',
    direction: good && bad ? '材料审查或战术结果可能有利于任一方。' : good ? certain ? '本次将为本方争取有利变化。' : '满足条件时有机会为本方争取优势。' : bad ? '可能产生对本方不利的变化。' : '不立即改变控方证据强度。',
    conditions: [hidden ? '材料证明力与组合关系仍须审查，预览不提前透露隐藏答案。' : '根据已公开的行动和当前资源执行固定效果。'], risks: [] };
  if (hidden) f.risks.push('证明局限未被解决时可能无收益；支持对方的材料还会影响自身冷静值。');
  if (maybePressure) f.conditions.push('揭示与对方既有论点有关的关键矛盾时，可能产生额外压力；同一事件不会重复生效。');
  if (risky) f.risks.push('冒险失败会取消有利效果及成功附带效果，已用资源和已公开材料不退回。');
  if (melting) f.risks.push('严重失控可能取消有利论证并造成更大的反向惩罚；仍保留正常思维的可能。');
  if (c.tactic === 'assertive') f.risks.push('强势进攻会消耗自身冷静值。');
  if (c.itemId) f.conditions = [mode === 'casual' ? playerText(ITEM_CATALOG.find(i => i.id === c.itemId)!.description) : ({ coffee: '恢复部分冷静值，不超过上限。', magnifier: '复核记录并可能找到额外的本人材料。', archive: '取得预置私人材料，出示后才影响证据强度。', firewall: '抵消下一次冷静值损失的一部分或全部，不抵消分数变化。', interrogate: '下一次追问免调查并在有效时加强。', extension: '下一次有效组合得到加强，可被有效追问打断。' }[c.itemId])];
  if (mode === 'casual') {
    Object.assign(f, { score, selfCalm, opponentCalm, ...(risky ? { probability: riskChance(p.stability) } : {}), ...(melting ? { meltdownProbability: 70 } : {}),
      note: hidden || maybePressure ? '数值是公开可能性的保守范围，并非所选材料的隐藏得分提示；已考虑边界和防火墙。' : '已考虑当前状态、上下限与防火墙。' });
    if (c.tactic !== 'steady') f.conditions.push(o.styles.find(style => style.id === c.tactic)!.description);
    if (melting) f.conditions.push('失控取消有利效果，反向惩罚为潜在有利收益加2，最低6点；原不利效果保留。');
    if (o.actionType === 'regain_composure') f.conditions.push(`本次实际恢复${selfCalm[0]}点冷静值，包含适用的身份效果。`);
  }
  result.forecast = f; return result;
}
