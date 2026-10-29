import type { Difficulty, MatchMode, RoomView } from '../shared/types';
const RECENT = 'court-recent-cases-v13', SETTINGS = 'court-trial-settings-v13';
export function recentCases(): string[] { try { const a: unknown = JSON.parse(localStorage.getItem(RECENT) ?? '[]'); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{1,40}$/.test(x)).slice(0, 3) : []; } catch { return []; } }
export function rememberTrial(room: RoomView) {
  if (!room.game || !['playing', 'finished'].includes(room.status)) return;
  try { localStorage.setItem(RECENT, JSON.stringify((room.recentCaseIds ?? [room.case.id, ...recentCases()]).slice(0, 3))); } catch { /* Optional public history only. */ }
}
export function trialSettings(): { difficulty: Difficulty; mode: MatchMode; selection: 'auto' | 'manual' } {
  const fallback = { difficulty: 'beginner' as const, mode: 'casual' as const, selection: 'auto' as const };
  try { const o = JSON.parse(localStorage.getItem(SETTINGS) ?? 'null'); return o && ['beginner', 'standard', 'complex'].includes(o.difficulty) && ['casual', 'standard', 'hardcore'].includes(o.mode) && ['auto', 'manual'].includes(o.selection) ? { difficulty: o.difficulty, mode: o.mode, selection: o.selection } : fallback; } catch { return fallback; }
}
export function saveTrialSettings(settings: ReturnType<typeof trialSettings>) { try { localStorage.setItem(SETTINGS, JSON.stringify({ difficulty: settings.difficulty, mode: settings.mode, selection: settings.selection })); } catch { /* Optional preferences. */ } }
