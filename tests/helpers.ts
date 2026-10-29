import { randomUUID } from 'node:crypto';
import type { ActionCommand, AiConfig, CaseTemplate, EngineState, Side } from '../shared/types.js';
export const config = (patch: Partial<AiConfig> = {}): AiConfig => ({ provider: 'mock', model: 'test-manual', baseUrl: '', apiKey: '', personality: 'rigorous', strategy: 'evidence', identity: 'civilian', items: ['magnifier', 'coffee', 'firewall'], ...patch });
export function command(state: EngineState, optionId: string, evidenceIds: string[] = [], patch: Partial<ActionCommand> = {}): ActionCommand {
  return { actionId: randomUUID(), turnId: `test:${state.completedActions}`, optionId, evidenceIds, itemId: optionId.startsWith('item:') ? optionId.slice(5) as ActionCommand['itemId'] : null, targetArgumentId: null, tactic: optionId.startsWith('closing:') ? optionId.slice(8) as ActionCommand['tactic'] : 'steady', ...patch };
}
/** Fixed player choices for integration tests; production has no chooser or auto driver. */
export function manualChoice(template: CaseTemplate, state: EngineState): ActionCommand {
  const prefix = template.evidence[0].id[0], n = state.completedActions;
  const last = (side: Side) => [...state.events].reverse().find(e => e.kind === 'action' && e.side === side)!;
  if (n === 0) return command(state, 'defense:present', [`${prefix}04`]);
  if (n === 1) return command(state, 'prosecution:present', [`${prefix}05`]);
  if (n === 2) return command(state, 'defense:challenge', [`${prefix}01`]);
  if (n === 3) return command(state, 'prosecution:link', [prefix === 'P' ? 'P02' : `${prefix}01`, `${prefix}05`]);
  if (n === 4) return command(state, 'defense:counter', last('prosecution').action!.cited_evidence_ids, { targetArgumentId: last('prosecution').id });
  if (n === 5) return command(state, 'prosecution:cross', [prefix === 'P' ? 'P02' : `${prefix}01`], { targetArgumentId: last('defense').id });
  return command(state, 'closing:logical_summary');
}
