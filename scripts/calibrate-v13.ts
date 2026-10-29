// Offline scripted fixtures only. This is never imported by the game server or used as an auto player.
import { mkdirSync, writeFileSync } from 'node:fs';
import { CASES_V3, instantiateCase } from '../server/cases-v3.js';
import { createGame, finalizeAction, getActionOptions, prepareAction, replayGame, turnIdFor } from '../server/game.js';
import { make, clashChoice } from '../tests/v13-helpers.js';
import { config } from '../tests/helpers.js';
import type { Identity } from '../shared/types.js';
const rows: { caseId: string; route: string; identity: Identity; policy: string; score: number; defenseCalm: number; prosecutionCalm: number; firstPressureAt: number | null; actualActions: number; skipped: number; pressureEvents: number }[] = [];
for (const base of CASES_V3) for (const route of ['route-a', 'route-b'] as const) for (const identity of ['civilian', 'tycoon', 'scientist'] as Identity[]) for (const policy of ['交锋', '连续冒险失败', '谨慎材料基准']) {
  const t = instantiateCase(base.id, `calibration:${base.id}:${route}:${identity}:${policy}`, route);
  const players = { defense: config({ identity, items: ['coffee', 'firewall', 'extension'] }), prosecution: config({ identity, items: ['coffee', 'firewall', 'extension'] }) };
  let s = createGame(t, players), firstPressureAt: number | null = null;
  while (s.phase !== 'finished') {
    const options = getActionOptions(t, s, s.turn).filter(o => o.enabled), actor = s.players[s.turn];
    let c = clashChoice(t, s);
    if (policy === '谨慎材料基准') {
      const option = s.stage === 'closing' ? options.find(o => o.id === 'closing:logical_summary') : options.find(o => o.actionType === 'regain_composure' && actor.stability <= 84) ?? options.find(o => o.actionType === 'investigate_lead') ?? options.find(o => o.itemId === 'firewall') ?? options.find(o => o.actionType === 'present_evidence');
      if (option) { c = make(s, option); if (option.actionType === 'present_evidence') c.evidenceIds = [t.evidence.filter(e => option.evidenceIds.includes(e.id) && e.strength * (s.turn === 'defense' ? -1 : 1) > 0).sort((a, b) => b.reliability - a.reliability)[0]?.id ?? c.evidenceIds[0]]; }
    }
    if (policy === '连续冒险失败') {
      const option = options.find(o => o.id === c.optionId)!;
      if (s.stage === 'closing') c = make(s, options.find(o => o.id === 'closing:risky_closing')!);
      else if (option.styles.some(style => style.id === 'risky')) c.tactic = 'risky';
    }
    c.turnId = turnIdFor('calibration', s);
    const p = prepareAction(t, s, s.turn, c, { turnId: c.turnId, actorId: s.turn, roll: policy === '连续冒险失败' ? 100 : 1, meltdownRoll: 100, now: '2026-10-29T12:00:00Z' });
    if (firstPressureAt === null && Object.values(p.event.settlement!.calmChanges).some(n => n < 0)) firstPressureAt = s.opportunities! + 1;
    s = finalizeAction(p, p.action);
  }
  replayGame(t, players, s.events);
  rows.push({ caseId: t.id, route, identity, policy, score: s.score, defenseCalm: s.players.defense.stability, prosecutionCalm: s.players.prosecution.stability, firstPressureAt, actualActions: s.completedActions, skipped: s.skippedOpportunities!, pressureEvents: s.events.filter(e => e.kind === 'action' && Object.values(e.settlement!.calmChanges).some(n => n < 0)).length });
}
const median = (a: number[]) => { const s = [...a].sort((a, b) => a - b); return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2; };
const summaries = [...new Set(rows.map(r => r.policy))].map(policy => { const r = rows.filter(r => r.policy === policy), values = r.flatMap(x => [x.defenseCalm, x.prosecutionCalm]); return { policy, matches: r.length, medianFinalCalm: median(values), minFinalCalm: Math.min(...values), maxFinalCalm: Math.max(...values), medianFirstPressureOpportunity: median(r.flatMap(x => x.firstPressureAt === null ? [] : [x.firstPressureAt])), bothAbove85: r.filter(x => x.defenseCalm > 85 && x.prosecutionCalm > 85).length }; });
const report = { fixtures: rows.length, externalModelCalls: 0, replaysVerified: rows.length, note: '自构造脚本路线，不代表玩家水平、真实LLM质量或竞技平衡证明。谨慎基准可利用作者已知的材料方向；不为满足冷静值目标强制扣分。', summaries, rows };
mkdirSync('docs', { recursive: true }); writeFileSync('docs/V1.3-CALIBRATION.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ fixtures: report.fixtures, externalModelCalls: 0, summaries }, null, 2));
