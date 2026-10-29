import type { GameEvent } from './types.js';

/** Display-only translation: recorded rule events remain byte-for-byte replayable. */
export function playerText(text: string): string {
  return text.replace(/逻辑稳定度/g, 'AI 冷静值').replace(/稳定度/g, '冷静值')
    .replace(/概率判定/g, '机会判断').replace(/服务器/g, '法庭');
}

export function presentEvent(event: GameEvent): GameEvent {
  if (event.kind !== 'action') return event;
  if (event.settlement?.outcome) {
    const s = event.settlement, title = s.outcome === 'meltdown' ? '论证失控，优势反向流失' : s.outcome === 'backfired' ? `${s.conditionMet ? '行动完成，' : ''}结果支持了对方` : s.outcome === 'failed' ? '本次论证条件未满足' : s.outcome === 'no_effect' ? '材料已审查，本次证据强度不变' : s.favorable ? '论证获得支持' : '行动已完成';
    const change = event.scoreDelta ?? 0;
    const summary = change === 0 ? '控方证据强度实际不变。' : `控方证据强度实际${change > 0 ? '增加' : '降低'}${Math.abs(change)}点，${s.favorable ? '有利于' : '不利于'}${event.side === 'defense' ? '辩方' : '控方'}。`;
    const details = [playerText(s.explanation ?? event.reason ?? ''), ...s.costs, s.impact];
    if (event.random) details.push(`冒险检定：掷出${event.random.roll}，成功阈值${event.random.threshold}；${event.random.succeeded ? '成功' : '未通过或未满足有利条件'}。`);
    if (event.meltdown) details.push(`严重失控检定：掷出${event.meltdown.roll}，失控阈值70；${event.meltdown.occurred ? '本次失控' : '本次保持正常思维'}。`);
    if (s.comparison) details.push(playerText(s.comparison));
    details.push(s.nextSide ? `接下来轮到${s.nextSide === 'defense' ? '辩方' : '控方'}行动。` : '行动机会已经结束，进入程序判决。');
    return { ...event, presentation: { title, explanation: summary + playerText(s.explanation ?? event.reason ?? '').split(/(?<=[。！？])/).slice(0, 2).join(''), detailLines: details } };
  }
  const favorable = (event.scoreDelta ?? 0) * (event.side === 'defense' ? -1 : 1) > 0;
  const type = event.action?.action_type;
  let title = favorable ? '论证获得支持' : '未争取到有利分数';
  if (type === 'present_evidence') title = favorable ? '证据已出示，支持了本方观点' : '证据已出示';
  if (type === 'challenge_evidence') title = favorable ? '质疑有效' : '质疑未获支持';
  if (type === 'counter_argument') title = favorable ? '找到了对方论点的漏洞' : '反驳未获支持';
  if (type === 'timeline_analysis') title = favorable ? '证据组合获得支持' : '证据组合未能支持本方';
  if (type === 'cross_examination') title = favorable ? '追问动摇了对方说法' : '追问未获支持';
  if (type === 'review_evidence') title = '证据复核完成';
  if (type === 'use_item') title = '特殊能力已使用';
  if (type === 'closing_statement') title = favorable ? '最终陈词获得支持' : '最终陈词已听取';
  if (event.random && !event.random.succeeded) title = '这次冒险未能说服法庭';
  const reason = playerText(event.reason || '法庭已听取本次论证，证据强度没有变化。');
  const detailLines = [reason];
  if (event.random) detailLines.push(`成功机会 ${event.random.threshold}%；本次掷出 ${event.random.roll}。${event.random.qualified ? '' : '所选材料未满足争取额外收益的条件。'}`);
  if (event.resources && event.resources.investigationAfter < event.resources.investigationBefore) detailLines.push(`本次使用 ${event.resources.investigationBefore - event.resources.investigationAfter} 次调查机会。`);
  if (event.settlement) {
    detailLines.push(...event.settlement.costs, event.settlement.impact);
    if (event.settlement.comparison) detailLines.push(playerText(event.settlement.comparison));
    detailLines.push(event.settlement.nextSide ? `接下来轮到${event.settlement.nextSide === 'defense' ? '辩方' : '控方'}行动。` : '八次行动已结束，请查看最终判决。');
  }
  return { ...event, presentation: { title, explanation: reason.split(/(?<=[。！？])/).slice(0, 2).join(''), detailLines } };
}
