// Read-only v1 replay support. No scheduler, model calls, or playable entry point.
import { z } from 'zod';
import type { Action, ActionType, CaseTemplate, LegacyEngineState as EngineState, Evidence, GameEvent, ItemId, PlayerState, PublicConfig, Side } from '../shared/types.js';

const actionTypes = ['challenge_evidence', 'timeline_analysis', 'counter_argument', 'present_evidence', 'cross_examination', 'closing_statement', 'use_item'] as const;
const itemIds = ['magnifier', 'coffee', 'archive', 'interrogate', 'firewall', 'extension'] as const;
export const actionSchema = z.object({
  speech: z.string().trim().min(1).max(1400),
  action_type: z.enum(actionTypes),
  cited_evidence_ids: z.array(z.string().regex(/^[A-Z][0-9]{2}$/)).max(3).refine(ids => new Set(ids).size === ids.length, '不能重复引用证据'),
  target_argument_id: z.string().max(80).nullable(),
  item_id: z.enum(itemIds).nullable(),
  tone: z.string().trim().min(1).max(40),
}).strict();

const other = (side: Side): Side => side === 'prosecution' ? 'defense' : 'prosecution';
const direction = (side: Side) => side === 'prosecution' ? 1 : -1;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const hasFlaw = (e: Evidence) => e.flaw !== null || e.reliability < 0.65;
const actionKey = (side: Side, id: string) => `${side}:${id}`;

export function createGame(template: CaseTemplate, configs: Record<Side, PublicConfig>): EngineState {
  const publicIds = template.evidence.filter(e => e.visibility === 'public').map(e => e.id);
  const makePlayer = (side: Side): PlayerState => ({
    side, identity: configs[side].identity, scientificAnalysisUsed: false, extraQuestion: false,
    stability: 100, actionPoints: 4, investigation: configs[side].identity === 'tycoon' ? 3 : configs[side].identity === 'civilian' ? 2 : 1,
    items: [...new Set(configs[side].items)].slice(0, 3), usedItems: [],
    knownEvidenceIds: [...publicIds, ...template.evidence.filter(e => e.visibility === side).slice(0, 1).map(e => e.id)],
    firewall: false, preparation: 0, lastAction: null,
  });
  return {
    caseId: template.id, score: template.initialScore, round: 1, turn: 'prosecution', phase: 'debate',
    players: { defense: makePlayer('defense'), prosecution: makePlayer('prosecution') },
    events: [], publicEvidenceIds: publicIds, presented: [], challenged: [], analyzed: [], countered: [], completedActions: 0, verdict: null,
  };
}

export function getVisibleEvidence(template: CaseTemplate, state: EngineState, side: Side): Evidence[] {
  const allowed = new Set([...state.publicEvidenceIds, ...state.players[side].knownEvidenceIds]);
  return template.evidence.filter(e => allowed.has(e.id));
}
export function getPublicEvidence(template: CaseTemplate, state: EngineState): Evidence[] {
  return template.evidence.filter(e => state.publicEvidenceIds.includes(e.id));
}

function append(state: EngineState, event: Omit<GameEvent, 'id' | 'sequence' | 'scoreAfter'> & { id?: string }): GameEvent {
  const result: GameEvent = { ...event, id: event.id ?? `event-${state.events.length + 1}`, sequence: state.events.length + 1, scoreAfter: state.score };
  state.events.push(result);
  return result;
}
function changeStability(state: EngineState, side: Side, delta: number, reason: string): number {
  const player = state.players[side];
  const before = player.stability;
  if (delta < 0 && player.firewall) {
    player.firewall = false;
    delta = Math.min(0, delta + 15);
    append(state, { kind: 'system', side, round: state.round, text: '逻辑防火墙抵消了至多 15 点稳定度损失。', stabilityDelta: 0, stabilityAfter: before });
  }
  player.stability = clamp(before + delta, 0, 100);
  // The acting side's total delta is recorded on its action; avoid counting it twice.
  if (player.stability !== before) append(state, { kind: 'system', side, round: state.round, text: reason, stabilityDelta: side === state.turn ? undefined : player.stability - before, stabilityAfter: player.stability });
  return player.stability - before;
}
function unlock(template: CaseTemplate, state: EngineState, side: Side, linkedTo?: Evidence): boolean {
  const player = state.players[side];
  const next = template.evidence.find(e => e.visibility === side && !player.knownEvidenceIds.includes(e.id) && (!linkedTo || linkedTo.linkedIds.includes(e.id) || e.linkedIds.includes(linkedTo.id)));
  if (!next) return false;
  player.knownEvidenceIds.push(next.id);
  // Do not put a private evidence ID or description in public events.
  append(state, { kind: 'system', side, round: state.round, text: '该方获得一条案件预置的私人调查情报；内容仅对其本人可见。' });
  return true;
}

function validateSemantic(template: CaseTemplate, state: EngineState, side: Side, action: Action, cited: Evidence[]): string | null {
  const player = state.players[side];
  if (!template.allowedActions.includes(action.action_type)) return '此案件不允许该策略';
  if (state.phase === 'closing' && action.action_type !== 'closing_statement') return '当前仅允许最终陈词';
  if (state.phase === 'debate' && action.action_type === 'closing_statement') return '正式辩论阶段不能提前陈词';
  if (action.action_type !== 'use_item' && action.item_id !== null) return '普通行动不能附带使用道具';
  if (cited.length !== action.cited_evidence_ids.length) return '引用了不存在或无权访问的证据';
  if (player.stability < 40 && ['counter_argument', 'cross_examination'].includes(action.action_type) && player.preparation === 0) return '严重混乱时需先准备或使用安全策略';
  if (player.stability < 80 && player.lastAction === 'counter_argument' && action.action_type === 'counter_argument') return '混乱状态不能连续强势反驳';
  if (action.action_type === 'closing_statement') return null;
  if (action.action_type !== 'use_item' && cited.length === 0) return '该策略至少需要引用一条可见证据';
  if (action.action_type === 'present_evidence' && cited.some(e => state.presented.includes(e.id))) return '已提交的证据不能重复计分';
  if (action.action_type === 'challenge_evidence' && cited.some(e => state.challenged.includes(actionKey(side, e.id)))) return '同一方不能重复质疑同一证据';
  if (action.action_type === 'timeline_analysis') {
    const singleTech = cited.length === 1 && cited[0].technical && (player.preparation > 0 || (player.identity === 'scientist' && !player.scientificAnalysisUsed));
    if (!singleTech && (cited.length < 2 || !cited.some(e => e.linkedIds.some(id => cited.some(otherEvidence => otherEvidence.id === id))))) return '时间线分析需要至少两条有关联的证据，或可用的技术复查机会';
    const key = actionKey(side, cited.map(e => e.id).sort().join(','));
    if (state.analyzed.includes(key)) return '同一方不能重复分析同一证据组合';
  }
  if (action.action_type === 'counter_argument') {
    const target = state.events.find(e => e.id === action.target_argument_id && e.kind === 'action');
    if (!target || target.side === side || !target.accepted) return '反驳必须指向对方已公开且有效的论点';
    if (state.countered.includes(target.id)) return '此论点已经被反制，不能重复计分';
  }
  if (action.action_type === 'cross_examination' && player.investigation === 0 && !player.extraQuestion) return '调查资源已经用尽';
  if (action.action_type === 'use_item') {
    if (!action.item_id || !player.items.includes(action.item_id) || player.usedItems.includes(action.item_id)) return '道具不存在、未携带或已经使用';
    switch (action.item_id) {
      case 'coffee': if (player.stability === 100) return '稳定度已满，无需咖啡'; break;
      case 'archive': if (!template.evidence.some(e => e.visibility === side && !player.knownEvidenceIds.includes(e.id))) return '该方额外情报已经全部解锁'; break;
      case 'magnifier': {
        const entry = cited[0];
        if (cited.length !== 1 || (!entry.technical && entry.reliability >= 0.75)) return '放大镜只能检查一条技术性或可信度低于 75% 的证据';
        const free = player.identity === 'scientist' && !player.scientificAnalysisUsed && entry.technical;
        if (!free && player.investigation === 0) return '放大镜需要一次调查资源';
        break;
      }
      case 'firewall': if (player.firewall) return '防火墙已经处于待触发状态'; break;
      case 'interrogate': if (player.extraQuestion) return '已有未用的额外质询机会'; break;
      case 'extension': if (player.preparation > 0) return '已有未用的准备机会'; break;
    }
  }
  return null;
}

export function applyAction(template: CaseTemplate, state: EngineState, side: Side, input: Action, actionId = `turn-${state.completedActions + 1}`): GameEvent {
  if (state.caseId !== template.id) throw new Error('案件状态不匹配');
  if (state.phase === 'finished') throw new Error('对局已结束');
  if (state.turn !== side) throw new Error('不能越过当前回合');
  if (state.events.some(e => e.id === actionId)) throw new Error('重复行动');
  const action = actionSchema.parse(input);
  const player = state.players[side];
  const opponent = state.players[other(side)];
  const known = getVisibleEvidence(template, state, side);
  const cited = known.filter(e => action.cited_evidence_ids.includes(e.id));
  const invalid = validateSemantic(template, state, side, action, cited);
  const before = state.score;
  const stabilityBefore = player.stability;
  let explanation = invalid ?? '';
  let delta = 0;
  if (invalid) {
    changeStability(state, side, -15, '无效策略使该方稳定度下降。');
  } else {
    switch (action.action_type) {
      case 'present_evidence': {
        delta = cited.reduce((sum, e) => sum + Math.round(e.strength * e.reliability * template.rules.presentMultiplier), 0);
        for (const e of cited) {
          state.presented.push(e.id);
          if (!state.publicEvidenceIds.includes(e.id)) state.publicEvidenceIds.push(e.id);
        }
        explanation = '证据按模板的方向、可信度及强度计分；已提交证据不能再次计分。';
        if (delta * direction(side) < 0) changeStability(state, side, -12, '提交了对己方不利的证据，触发逻辑冲突。');
        break;
      }
      case 'challenge_evidence': {
        const success = cited.filter(hasFlaw);
        delta = success.reduce((sum, e) => sum - Math.sign(e.strength) * (template.rules.challengeBonus + Math.round(Math.abs(e.strength) * (1 - e.reliability))), 0);
        state.challenged.push(...cited.map(e => actionKey(side, e.id)));
        explanation = success.length ? '命中了案件预置的证据缺陷，按固定规则削弱其证明方向。' : '证据没有可触发的预置缺陷，本次质疑未得分。';
        if (!success.length) changeStability(state, side, -8, '质疑未命中可验证缺陷。');
        if (delta * direction(side) < 0) changeStability(state, side, -12, '质疑了对己方有利的证据，触发逻辑冲突。');
        break;
      }
      case 'timeline_analysis': {
        const key = actionKey(side, cited.map(e => e.id).sort().join(','));
        state.analyzed.push(key);
        // Mixed links use the stronger absolute evidence; ties favor reasonable doubt.
        const anchor = [...cited].sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength) || a.strength - b.strength)[0];
        const prepared = player.preparation > 0;
        delta = Math.sign(anchor.strength) * (template.rules.timelineBonus + (prepared ? 2 : 0));
        if (cited.length === 1 && !prepared) player.scientificAnalysisUsed = true;
        if (prepared) player.preparation--;
        explanation = '关联证据形成有效时间线；以绝对证明强度较高的证据为方向，按案件固定时间线分值计分。';
        if (delta * direction(side) < 0) changeStability(state, side, -12, '时间线结论与本方主张相反，触发逻辑冲突。');
        break;
      }
      case 'counter_argument': {
        const target = state.events.find(e => e.id === action.target_argument_id)!;
        const overlaps = target.action?.cited_evidence_ids.some(id => action.cited_evidence_ids.includes(id));
        if (overlaps && target.scoreDelta && target.scoreDelta * direction(other(side)) > 0) {
          delta = -Math.sign(target.scoreDelta) * Math.min(Math.abs(target.scoreDelta), template.rules.counterBonus);
          changeStability(state, other(side), -10, '对方命中已公开论点的反制关系。');
          explanation = '引用了目标论点中的证据，固定反制生效。';
        } else {
          changeStability(state, side, -6, '反驳未覆盖目标证据或目标没有有效得分。');
          explanation = '未命中可验证的反制关系，本次反驳未得分。';
        }
        state.countered.push(target.id);
        break;
      }
      case 'cross_examination': {
        const extra = player.extraQuestion;
        if (extra) player.extraQuestion = false; else player.investigation--;
        if (cited.some(e => e.reliability >= 0.7 && Math.sign(e.strength) === direction(side))) {
          delta = direction(side) * (template.rules.crossBonus + (extra ? 2 : 0));
          opponent.preparation = 0;
          changeStability(state, other(side), -6, '对方的有效质询使准备失效并损失稳定度。');
          explanation = '可信度至少 70% 且支持本方的证据使质询生效；对方准备机会被清除。';
          unlock(template, state, side);
        } else {
          explanation = '质询证据不足，调查资源已使用但没有得分。';
          changeStability(state, side, -6, '质询未得到有效证据支持。');
        }
        break;
      }
      case 'use_item': {
        const item = action.item_id as ItemId;
        player.usedItems.push(item);
        switch (item) {
          case 'coffee': changeStability(state, side, 25, '清醒咖啡恢复稳定度。'); explanation = '清醒咖啡恢复至多 25 点稳定度。'; break;
          case 'archive': unlock(template, state, side); explanation = '神秘档案解锁一条己方预置情报；未自动提交证据或增加分数。'; break;
          case 'interrogate': player.extraQuestion = true; explanation = '已获得一次额外质询机会，下一次质询免调查并强化 2 分。'; break;
          case 'firewall': player.firewall = true; explanation = '防火墙等待下一次稳定度损失，最多抵消 15 点。'; break;
          case 'extension': player.preparation = 1; explanation = '已获得一次额外准备机会，用于下一次时间线分析；有效质询可使其失效。'; break;
          case 'magnifier': {
            const entry = cited[0];
            if (player.identity === 'scientist' && !player.scientificAnalysisUsed && entry.technical) player.scientificAnalysisUsed = true; else player.investigation--;
            delta = hasFlaw(entry) ? -Math.sign(entry.strength) * 4 : Math.sign(entry.strength) * 3;
            unlock(template, state, side, entry);
            explanation = hasFlaw(entry) ? '放大镜确认预置缺陷，削弱该证据方向 4 分。' : '放大镜核验技术证据，强化该证据方向 3 分。';
            break;
          }
        }
        break;
      }
      case 'closing_statement': explanation = '最终陈词仅总结，不另外计分。'; break;
    }
  }
  state.score = clamp(state.score + delta, 0, 100);
  player.actionPoints--;
  player.lastAction = action.action_type;
  // Invalid private references are redacted; unauthorized IDs and claims never become public evidence.
  const publicAction = invalid ? { ...action, speech: '该方行动未通过服务器规则校验。', cited_evidence_ids: [] } : action;
  const result = append(state, {
    id: actionId, kind: 'action', side, round: state.round, text: publicAction.speech,
    action: publicAction, accepted: !invalid, reason: explanation,
    scoreDelta: state.score - before, stabilityDelta: player.stability - stabilityBefore, stabilityAfter: player.stability,
  });
  state.completedActions++;
  if (state.completedActions === 8) {
    state.phase = 'finished';
    const convicted = state.score >= template.threshold;
    state.verdict = {
      winner: convicted ? 'prosecution' : 'defense', convicted, score: state.score, threshold: template.threshold,
      explanation: `控方证据强度 ${state.score}，定罪阈值 ${template.threshold}。${convicted ? '达到阈值，控方胜诉。' : '未达到阈值，被告依疑罪从无规则胜诉。'}本结果由程序规则计算，最终陈词不改变分数。`,
    };
    append(state, { kind: 'verdict', round: 4, text: state.verdict.explanation });
  } else {
    state.turn = other(side);
    state.round = Math.floor(state.completedActions / 2) + 1;
    state.phase = state.completedActions >= 6 ? 'closing' : 'debate';
  }
  return result;
}

export function replayScore(template: CaseTemplate, events: GameEvent[]): number {
  return events.filter(e => e.kind === 'action').reduce((score, e) => clamp(score + (e.scoreDelta ?? 0), 0, 100), template.initialScore);
}

export function replayGame(template: CaseTemplate, configs: Record<Side, PublicConfig>, events: GameEvent[]): EngineState {
  const replay = createGame(template, configs);
  for (const event of events.filter(e => e.kind === 'action')) {
    if (!event.side || !event.action) throw new Error('行动记录缺少必要字段');
    // Rejected payloads are redacted in public records. Preserve their action type,
    // but force the same fixed invalid-action penalty using an impossible case ID.
    const recorded = event.accepted === false ? { ...event.action, cited_evidence_ids: ['Z99'] } : event.action;
    const result = applyAction(template, replay, event.side, recorded, event.id);
    if (result.accepted !== event.accepted || result.scoreAfter !== event.scoreAfter || result.scoreDelta !== event.scoreDelta || result.stabilityAfter !== event.stabilityAfter || result.stabilityDelta !== event.stabilityDelta) throw new Error('行动记录与案件规则不一致');
  }
  const numbers = (rows: GameEvent[]) => rows.map(e => ({ id: e.id, sequence: e.sequence, kind: e.kind, side: e.side, round: e.round, scoreAfter: e.scoreAfter, stabilityAfter: e.stabilityAfter, stabilityDelta: e.stabilityDelta }));
  if (JSON.stringify(numbers(replay.events)) !== JSON.stringify(numbers(events))) throw new Error('状态变化记录与案件规则不一致');
  return replay;
}
