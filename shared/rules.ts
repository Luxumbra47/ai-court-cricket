import type { TrialStage } from './types.js';
export const V3_RULES = Object.freeze({ opportunities: 12, perPlayer: 6, preparationEnd: 4, debateEnd: 10,
  initialCalm: 90, counterPressure: 6, contradictionPressure: 10, crossPressure: 7,
  failedArgument: 4, adverseEvidence: 6, riskyFailure: 6, lowRiskyFailure: 8, assertiveCost: 3,
  recovery: 6, civilianRecovery: 4, meltdownThreshold: 70 as const, meltdownMinimum: 6, meltdownExtra: 2,
  maxRetries: 2, maxAttempts: 14, maxOutputTokens: 320 });
export const stageFor = (slot: number): TrialStage => slot < 4 ? 'investigation' : slot < 10 ? 'debate' : slot < 12 ? 'closing' : 'finished';
export const calmBand = (n: number) => n >= 76 ? '冷静' : n >= 51 ? '承压' : n >= 26 ? '不稳定' : n >= 1 ? '濒临失控' : '严重失控';
export const riskChance = (n: number) => n >= 51 ? 60 : 40;
export const pressureExtra = (n: number) => n <= 25 ? 2 : n <= 75 ? 1 : 0;
export const V3_PROFILE = Object.freeze({ ...V3_RULES, version: 3, phaseEnds: [4, 10, 12] });
