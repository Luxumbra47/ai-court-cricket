import { createHmac } from 'node:crypto';
import type { ActionCommand, ActionDraft, ActionForecast, ActionOption, ActionPreview, CaseTemplate, EngineState, MatchMode, Side } from '../shared/types.js';
import { prepareAction, getActionOptions, commandSchema, type PreparedAction } from './game.js';
import { ITEM_CATALOG } from './cases.js';
import { playerText } from '../shared/presentation.js';
import { buildPreviewV3 } from './preview-v3.js';

const previewActionId = '00000000-0000-4000-8000-000000000000';
export function draftCommand(input: unknown): ActionCommand {
  return commandSchema.parse({ ...(input as object), actionId: previewActionId });
}
export function previewSignature(secret: string, playerId: string, mode: MatchMode, command: ActionCommand) {
  const { actionId: _id, previewId: _preview, ...draft } = command;
  return createHmac('sha256', secret).update(JSON.stringify([playerId, mode, draft])).digest('hex');
}
const purposes: Record<string, string> = {
  present_evidence: '把一份已知材料正式出示给法庭。已公开但未出示的材料也可首次出示。',
  challenge_evidence: '指出一份公开材料中值得质疑的地方，每份材料每方只能质疑一次。',
  counter_argument: '回应对方尚未被反驳的得分说法，须引用那次发言使用的材料。',
  cross_examination: '围绕一份材料追问对方已经公开的说法。',
  timeline_analysis: '将两份材料放在一起，解释它们与案情的联系。',
  review_evidence: '再次核对一份符合条件的记录，与放大镜共用检查次数。',
  closing_statement: '围绕已经公开的交锋作最后陈述。', use_item: '使用一件尚未用过的道具。',
};
const itemPurposes: Record<string, string> = { magnifier: '借助放大镜检查一份符合条件的材料。', coffee: '喝咖啡整理思路。', archive: '调阅尚未查看的私人档案。', interrogate: '整理下次追问的问题。', firewall: '为激烈交锋做好心理准备。', extension: '为下一次组合材料做准备。' };
const stylePurposes: Record<string, string> = { steady: '按材料本身展开论证。', assertive: '以强硬口吻反驳或追问。', risky: '尝试冒险论证。', logical_summary: '总结本方此前的有效论证。', evidence_rebuttal: '回应对方尚未被反驳的得分说法。', forceful_closing: '需要冷静值至少 80，且已有两次有利论证。', risky_closing: '以冒险方式作最后陈述。' };

/** Game options stay untouched. Only this audience projection changes with mode. */
export function projectOptions(options: ActionOption[], mode: MatchMode, version = 2): ActionOption[] {
  return options.map(o => ({ ...o,
    description: version === 3 ? o.itemId ? itemPurposes[o.itemId] : o.actionType === 'closing_statement' ? '结合此前公开论证作最后陈述。' : o.description : o.itemId ? itemPurposes[o.itemId] : o.actionType === 'closing_statement' ? stylePurposes[o.styles[0].id] : purposes[o.actionType],
    risk: '', // All predictive information goes through the private, mode-filtered endpoint.
    styles: o.styles.map(s => ({ id: s.id, label: s.label, enabled: s.enabled, reason: s.reason, description: version === 3 && s.id === 'forceful_closing' ? '需要此前至少两次有利论证，不限制冷静值。' : stylePurposes[s.id] })),
  }));
}
function costsFor(state: EngineState, side: Side, command: ActionCommand, choice: ActionOption, template: CaseTemplate) {
  const p = state.players[side], costs = ['使用后结束本回合。'];
  if (choice.actionType === 'cross_examination') costs.push(p.extraQuestion ? '使用储存的追问机会，不消耗调查。' : '消耗 1 次调查。');
  if (choice.actionType === 'review_evidence' || command.itemId === 'magnifier') {
    const technical = template.evidence.find(e => e.id === command.evidenceIds[0])?.technical;
    costs.push(p.identity === 'scientist' && !p.scientificAnalysisUsed && technical ? '使用科学家首次免费复核，不消耗调查。' : '消耗 1 次调查。');
  }
  if (command.itemId) costs.push(`消耗${ITEM_CATALOG.find(i => i.id === command.itemId)!.name}，本局不能再次使用。`);
  if (p.preparation && choice.actionType === 'timeline_analysis') costs.push('组合成立时消耗已准备的组合机会。');
  return costs;
}
const conditions: Record<string, string> = {
  present_evidence: '材料的证明力须经过法庭审查，可能支持任一方，也可能不足以改变证据强度。',
  challenge_evidence: '只有材料确有可质疑之处，质疑才能削弱它；削弱材料也可能有利于对方。',
  timeline_analysis: '两份材料必须存在案件认可的联系；联系可能支持任一方。',
  cross_examination: '材料须足以支持本方的追问，才能动摇对方；否则可能扰乱自己的思路。',
  review_evidence: '检查可能发现问题，也可能确认原记录，结果可能有利于任一方。',
};
/** Run the real engine over PUBLIC possibilities, never expose the real hidden scoring branch.
 * Endpoints are deliberately conservative: unknown proof weights/links are not a hint service.
 * Extreme weights saturate the public 0..100 score; interior branches cover zero, signs and failure.
 */
export function buildPreview(template: CaseTemplate, state: EngineState, side: Side, command: ActionCommand, mode: MatchMode, previewId = ''): ActionPreview {
  if (state.rulesVersion === 3) return buildPreviewV3(template, state, side, command, mode, previewId);
  const prepared = prepareAction(template, state, side, command, { turnId: command.turnId, actorId: 'preview', roll: 1, now: 'preview' });
  const choice = getActionOptions(template, state, side).find(o => o.id === command.optionId)!;
  const selected = template.evidence.filter(e => command.evidenceIds.includes(e.id));
  const result: ActionPreview = { previewId, turnId: command.turnId, mode,
    purpose: command.itemId ? itemPurposes[command.itemId] : purposes[choice.actionType],
    targets: selected.map(e => e.title), requirements: ['只能在本方回合确认；本次选择与合法目标必须保持一致。'],
    costs: costsFor(state, side, command, choice, template),
    disclosure: selected.filter(e => !state.publicEvidenceIds.includes(e.id)).map(e => e.title),
  };
  if (choice.targetRequired) result.requirements.push('引用目标发言中的公开材料。');
  if (choice.actionType === 'review_evidence' || command.itemId === 'magnifier') result.requirements.push('同一材料每方只可检查一次。');
  if (command.tactic === 'risky' || command.tactic === 'risky_closing') result.requirements.push('冷静值至少 40 才能选择冒险。');
  if (command.tactic === 'forceful_closing') result.requirements.push('冷静值至少 80，且此前至少两次有利论证。');
  if (command.tactic === 'assertive') result.requirements.push('冷静值至少 40 才能强势进攻。');
  if (mode === 'hardcore') return result;
  const hidden = ['present_evidence', 'challenge_evidence', 'timeline_analysis', 'cross_examination', 'review_evidence'].includes(choice.actionType) || command.itemId === 'magnifier';
  const rolls = command.tactic === 'risky' || command.tactic === 'risky_closing' ? [1, 100] : [1];
  const outcomes: PreparedAction[] = [];
  const run = (t: CaseTemplate) => {
    for (const roll of rolls) {
      try { outcomes.push(prepareAction(t, state, side, command, { turnId: command.turnId, actorId: 'preview', roll, now: 'preview' })); }
      catch { /* A counterfactual can lack a legal magnifier target. It contributes no possible outcome. */ }
    }
  };
  if (!hidden) run(template);
  else if (choice.actionType === 'timeline_analysis') {
    for (const delta of [-100, 0, 100]) run({ ...template, timelineRules: delta === 0 ? [] : [{ evidenceIds: command.evidenceIds as [string, string], delta }] });
  } else {
    const limit = Math.max(100, 100 / template.rules.presentMultiplier);
    for (const strength of [-limit, -1, 0, 1, limit]) for (const reliability of [0, .64, .65, .69, .7, .74, 1]) for (const hasFlaw of [false, true]) {
      run({ ...template, evidence: template.evidence.map(e => command.evidenceIds.includes(e.id) ? { ...e, strength, reliability, flaw: hasFlaw ? '待核对' : null, linkedIds: [] } : e) });
    }
  }
  if (!outcomes.length) throw new Error('无法生成合法行动预览，请重新选择');
  const range = (read: (p: PreparedAction) => number): [number, number] => [Math.min(...outcomes.map(read)), Math.max(...outcomes.map(read))];
  const score = range(p => p.event.scoreDelta ?? 0), selfCalm = range(p => p.next.players[side].stability - state.players[side].stability);
  const opponent: Side = side === 'defense' ? 'prosecution' : 'defense';
  const opponentCalm = range(p => p.next.players[opponent].stability - state.players[opponent].stability);
  const dir = side === 'defense' ? -1 : 1, favorable = score.some(n => n * dir > 0), adverse = score.some(n => n * dir < 0);
  const fixed = [score, selfCalm, opponentCalm].every(([min, max]) => min === max);
  const forecast: ActionForecast = { certainty: fixed && !hidden && rolls.length === 1 ? 'certain' : 'conditional',
    direction: favorable && adverse ? '可能支持任一方，取决于材料审查。' : favorable ? fixed && !hidden && rolls.length === 1 ? '本次将为本方争取有利变化。' : '有机会为本方争取有利变化。' : adverse ? '可能有利于对方，谨慎判断材料方向。' : '不立即改变控方证据强度。',
    conditions: hidden ? [conditions[choice.actionType] ?? conditions.review_evidence] : ['效果依据本局已经公开的行动和当前状态计算。'], risks: [] };
  if (hidden) forecast.risks.push('材料未能支持本方时，可能没有收益；反而支持对方时还会影响本方冷静值。');
  if (command.tactic === 'assertive') forecast.risks.push('强势进攻会给自己带来额外压力；收益仍受目标原有得分限制。');
  if (rolls.length > 1) forecast.risks.push('冒险可能失败；失败不保留有利分数，已用资源和公开材料不会收回。');
  if (command.tactic !== 'steady') forecast.conditions.push(mode === 'casual' ? playerText(choice.styles.find(s => s.id === command.tactic)!.description) :
    ({ assertive: '有效追问或反驳可以得到额外收益，同时承受冷静值代价。', risky: '仅在材料支持本方且冒险检定成功时获得额外收益。', logical_summary: '此前有效有利论证越充分，总结的作用越大。', evidence_rebuttal: '最多抵消目标原有得分的一部分。', forceful_closing: '需要保持冷静，且此前已有充分的有效有利论证。', risky_closing: '陈词的收益取决于一次冒险检定。' } as Record<string, string>)[command.tactic]);
  if (command.itemId && command.itemId !== 'magnifier') {
    const detail = playerText(ITEM_CATALOG.find(i => i.id === command.itemId)!.description);
    forecast.conditions = [mode === 'casual' ? detail : ({ coffee: '恢复部分冷静值，不超过上限。', archive: '获得一份尚未掌握的私人材料，之后出示才影响证据强度。', interrogate: '为下次有效追问保留免调查及加强机会。', firewall: '抵消下一次冷静值损失的一部分或全部。', extension: '下一次有效组合证据得到加强。' } as Record<string, string>)[command.itemId]];
  }
  if (mode === 'casual') Object.assign(forecast, { score, selfCalm, opponentCalm,
    ...(rolls.length > 1 ? { probability: state.players[side].stability >= 80 ? 60 : 40 } : {}),
    note: hidden ? '这是不读取隐藏证明力或关联答案的保守可能范围，不是所选材料的得分提示；实际效果以审查为准。' : '已考虑分数上限、冷静值上限及现有防火墙。' });
  result.forecast = forecast;
  // Validation above is intentionally discarded; only public possibilities form the forecast.
  void prepared;
  return result;
}
export function comparisonText(preview: ActionPreview, prepared: PreparedAction) {
  if (!preview.forecast) return '硬核模式未展示出招前预测；以下为真实结算。';
  if (preview.forecast.certainty === 'certain') return '本次为公开状态可确定的效果，与出招前预览一致。';
  return `出招前已标明条件效果。${prepared.event.random ? prepared.event.random.succeeded ? '本次冒险条件满足且检定成功。' : prepared.event.random.qualified ? '材料具备收益条件，但本次冒险检定未通过。' : '所选材料未满足冒险获得有利收益的条件。' : '法庭已完成材料审查。'}${prepared.event.reason ?? ''}`;
}
