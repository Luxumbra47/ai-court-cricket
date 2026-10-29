import type { ActionOption, CaseGuide, CaseTemplate, EngineState, MatchMode, Side } from '../shared/types.js';
export function caseGuide(t: CaseTemplate, s: EngineState, side: Side, mode: MatchMode, options: ActionOption[]): CaseGuide {
  const known = new Set([...s.publicEvidenceIds, ...s.players[side].knownEvidenceIds]);
  const visible = t.evidence.filter(e => known.has(e.id));
  const priority = ['investigate_lead', 'counter_argument', 'challenge_evidence', 'present_evidence', 'regain_composure'];
  const usable = options.filter(o => o.enabled), proposals = usable.filter(o => priority.includes(o.actionType)).sort((a, b) => priority.indexOf(a.actionType) - priority.indexOf(b.actionType));
  const chosen = proposals.length ? proposals[Math.floor((s.opportunities ?? 0) / 2) % proposals.length] : null;
  const material = chosen ? (chosen.actionType === 'present_evidence' && side === 'defense' ? visible.find(e => e.visibility === side && chosen.evidenceIds.includes(e.id)) : null) ?? visible.find(e => chosen.evidenceIds.includes(e.id)) : null;
  const suggestion = t.difficulty === 'beginner' && mode !== 'hardcore' && chosen ? {
    id: `${t.id}:${s.opportunities}:${chosen.id}`,
    optionId: chosen.id,
    text: chosen.actionType === 'investigate_lead' ? '可以沿手头线索继续调查；新材料先只交给你，之后还需要决定是否出示。' : chosen.actionType === 'regain_composure' ? '你可以用本回合整理思路；恢复冷静会占用一次行动机会。' : chosen.actionType === 'counter_argument' ? '对方有尚未被回应的得分论点，可以引用其中的材料检验推断是否跳过了关键一步。' : material ? `可围绕「${material.title}」考虑${chosen.label}：${material.limitations}` : `可以考虑${chosen.label}，先核对必要条件。`,
  } : null;
  return { happened: t.background, dispute: t.dispute!, objective: side === 'prosecution' ? t.charge! : t.defenseGoal!,
    timeline: (t.timeline ?? []).filter(n => n.evidenceIds.every(id => known.has(id))).map(({ time, text }) => ({ time, text })),
    directions: visible.filter(e => e.visibility === side).slice(0, 2).map(e => `「${e.title}」：${e.limitations}`), suggestion };
}
