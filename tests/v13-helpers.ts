import type { ActionCommand, ActionOption, CaseTemplate, EngineState } from '../shared/types';
import { getActionOptions, turnIdFor } from '../server/game';
import { command } from './helpers';
export function make(s: EngineState, o: ActionOption, patch: Partial<ActionCommand> = {}): ActionCommand {
  const target = o.targetRequired ? o.targetIds[0] : null;
  const ids = o.evidencePairs?.[0] ?? (target && ['counter_argument', 'closing_statement'].includes(o.actionType) ? s.events.find(e => e.id === target)!.action!.cited_evidence_ids.filter(id => o.evidenceIds.includes(id)).slice(0, o.minEvidence) : o.evidenceIds.slice(0, o.minEvidence));
  return command(s, o.id, ids, { turnId: turnIdFor('fixture', s), targetArgumentId: target, tactic: o.styles[0].id,
    ...(o.leads ? { leadIds: o.leads.slice(0, o.minLeads).map(l => l.id) } : {}), ...patch });
}
export function clashChoice(t: CaseTemplate, s: EngineState) {
  const options = getActionOptions(t, s, s.turn).filter(o => o.enabled), n = s.opportunities!, prefix = t.evidence[0].id[0];
  const choice = (type: string) => options.find(o => o.actionType === type);
  let o: ActionOption | undefined;
  if (n === 0 || n === 1 || n === 9) o = choice('present_evidence');
  else if (n === 2 || n === 3) o = choice('investigate_lead');
  else if (n === 4 || n === 5) o = choice('counter_argument');
  else if (n === 6) o = choice('timeline_analysis');
  else if (n === 7) o = choice('cross_examination');
  else if (n === 8) o = choice('challenge_evidence');
  else o = options.find(o => o.id === 'closing:logical_summary');
  o ??= options[0]; const c = make(s, o);
  if (o.actionType === 'present_evidence') {
    const own = t.evidence.find(e => e.visibility === s.turn && o!.evidenceIds.includes(e.id) && e.strength * (s.turn === 'defense' ? -1 : 1) > 0);
    c.evidenceIds = n === 1 ? [t.evidence[0].id] : [own?.id ?? o.evidenceIds[0]];
  }
  if (o.actionType === 'timeline_analysis') {
    const r = t.timelineRules!.find(r => r.delta < 0 && r.evidenceIds.every(id => o!.evidenceIds.includes(id)) && !s.analyzed.includes(`${s.turn}:${[...r.evidenceIds].sort().join(',')}`));
    if (r) c.evidenceIds = [...r.evidenceIds];
  }
  if (o.actionType === 'challenge_evidence' && o.evidenceIds.includes(`${prefix}02`)) c.evidenceIds = [`${prefix}02`];
  if (o.actionType === 'cross_examination') c.evidenceIds = [t.evidence[0].id];
  return c;
}
