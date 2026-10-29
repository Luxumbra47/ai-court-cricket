import type { Action, CaseTemplate, EngineState, LegacyEngineState, PublicConfig, Side } from '../shared/types.js';
import * as old from './legacy-v12-game.js';
import * as current from './game-v3.js';
import { CASES_V3 } from './cases-v3.js';
export { actionSchema, commandSchema } from './commands.js';
export type PreparedAction = current.PreparedActionV3;
export const turnIdFor = (matchId: string, state: EngineState) => `${matchId}:${state.opportunities ?? state.completedActions}`;
export const createGame = (t: CaseTemplate, c: Record<Side, PublicConfig>): EngineState => t.engineVersion === 3 ? current.createGameV3(t, c) : old.createGame(t, c);
export const getActionOptions = (t: CaseTemplate, s: EngineState, side: Side) => s.rulesVersion === 3 ? current.getActionOptionsV3(t, s, side) : old.getActionOptions(t, s, side);
export const getVisibleEvidence = old.getVisibleEvidence;
export const getPublicEvidence = old.getPublicEvidence;
export const matchesInstruction = old.matchesInstruction;
export function readableSpeech(speech: string, t: CaseTemplate, state: EngineState, selected: string[]) {
  const allowed = new Set(t.evidence.filter(e => state.publicEvidenceIds.includes(e.id) || selected.includes(e.id)).map(e => e.title));
  if (CASES_V3.flatMap(c => c.evidence).some(e => !allowed.has(e.title) && speech.includes(e.title))) return null;
  return old.readableSpeech(speech, t, state, selected);
}
export const prepareAction = (t: CaseTemplate, s: EngineState, side: Side, input: unknown, options: { turnId: string; actorId: string; roll?: number; meltdownRoll?: number; now?: string }): PreparedAction => s.rulesVersion === 3 ? current.prepareActionV3(t, s, side, input, options) : old.prepareAction(t, s, side, input, options);
export const finalizeAction = (p: PreparedAction, input: unknown) => p.next.rulesVersion === 3 ? current.finalizeActionV3(p, input) : old.finalizeAction(p, input);
export const createScriptedSpeech = (a: Action, c: PublicConfig, value: number): Action => a.tone === 'absurd' ? { ...a } : old.createScriptedSpeech(a, c, value);
export const replayScore = old.replayScore;
export const replayGame = (t: CaseTemplate, c: Record<Side, PublicConfig>, events: Parameters<typeof old.replayGame>[2]): EngineState | LegacyEngineState => t.engineVersion === 3 ? current.replayGameV3(t, c, events) : old.replayGame(t, c, events);
