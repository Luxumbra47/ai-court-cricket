import { randomUUID } from 'node:crypto';
import type { ActionUnit, AgentConfig, FactId, Move, ObjectiveView, Outcome, Personality, PromiseEntry, PublicCard, PublicEvent, PublicOffer, Report, Score, Side, Stance, TrustChange, Whisper } from '../shared/whisper.js';
import { AGENT_NAMES, other, STANCES } from '../shared/whisper.js';
import type { ScenarioDefinition } from './scenarios.js';

export interface AgentState {
  trust: number; verificationLeft: number; personality: Personality;
  tendencies: { obedience: number; suspicion: number; pride: number; caution: number };
  changes: TrustChange[]; reports: Report[]; whispers: Whisper[];
  arbitration: number; psychology: number; reasons: string[];
}
export interface GameState {
  act: number; seed: number; agents: Record<Side, AgentState>; events: PublicEvent[];
  verified: FactId[]; challenged: string[]; promises: PromiseEntry[];
  offer: PublicOffer | null; agreement: number | null;
  outcome: Outcome | null;
}
export const moveNames = { offer: '提出报价', probe: '追问条件', verify: '请求查验', claim: '声明条件', challenge: '质疑矛盾', accept: '接受方案', wait: '暂缓表态' };
function unit(seed: number, offset: number) { return ((Math.imul(seed + offset, 2654435761) >>> 0) % 1000) / 1000; }
export function createGame(scenario: ScenarioDefinition, personalities: Record<Side, Personality>, seed = Date.now()): GameState {
  const agent = (side: Side): AgentState => ({
    trust: 75, verificationLeft: 1, personality: personalities[side],
    tendencies: { obedience: .35 + unit(seed, side === 'a' ? 1 : 2) * .5, suspicion: unit(seed, side === 'a' ? 3 : 4), pride: unit(seed, side === 'a' ? 5 : 6), caution: unit(seed, side === 'a' ? 7 : 8) },
    changes: [], reports: [{ id: randomUUID(), act: 0, at: Date.now(), text: `我已接手${scenario.object}的谈判。${scenario.secrets[side].replaceAll('你', '我')}`, intention: side === 'a' ? '我会先观察对方的出价，再判断它的紧迫程度。' : '我会先探查对方条件，尽量保留预算。' }],
    whispers: [], arbitration: 10, psychology: 0, reasons: [],
  });
  return { act: 1, seed, agents: { a: agent('a'), b: agent('b') }, events: [], verified: [], challenged: [], promises: [], offer: null, agreement: null, outcome: null };
}
export function addEvent(game: GameState, event: Omit<PublicEvent, 'id' | 'at' | 'act'>): PublicEvent {
  const item = { ...event, id: event.performance?.id ?? randomUUID(), at: Date.now(), act: game.act };
  game.events.push(item); return item;
}
export function changeTrust(game: GameState, side: Side, delta: number, reason: string) {
  const agent = game.agents[side], next = Math.max(0, Math.min(100, agent.trust + delta));
  if (next !== agent.trust) agent.changes.push({ id: randomUUID(), act: game.act, delta: next - agent.trust, reason });
  agent.trust = next;
}
export function contradiction(game: GameState, text: string, side?: Side): string | null {
  // Be conservative: warnings, negations and hypotheses are not impossible commands.
  if (/(?:不|别|如果|假如|要是|会输|风险)/.test(text)) return null;
  const remaining = 3 - game.act;
  const number: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
  const delay = text.match(/(?:再|还[有能可]|继续)(?:拖|等|有)?([一二两三四五六1-6])(?:个)?[轮幕]/);
  if (delay && number[delay[1]] > remaining) return `本局只剩 ${remaining} 幕，无法再等待 ${number[delay[1]]} 幕。`;
  if (/^(?:现在|直接|就|快|请)?(?:报|出价|报价|要价|接受)(?:为)?(?:零|0|十[三四五六七八九]|[2-9]\d|1[3-9])(?:枚|块|元|筹码|$)/.test(text)) return '报价必须在 1～12 枚筹码范围内。';
  if (side && game.agents[side].verificationLeft === 0 && /^(?:请|现在)?(?:再|继续)(?:查验|核验)/.test(text)) return '我的查验机会已用完，无法再次查验。';
  if (game.verified.includes('alternative')) {
    const fact = [...game.events].reverse().find(e => e.kind === 'action' && e.fact === 'alternative');
    if (fact?.text.includes('没有') && /(?:他|她|乙方|对方)(?:确实|肯定|一定|有)?有其他货源/.test(text)) return '已公开的查验结果确认乙方没有其他货源。';
    if (fact?.text.includes('确有') && /(?:他|她|乙方|对方)(?:根本|确实|肯定|一定)?没有其他货源/.test(text)) return '已公开的查验结果确认乙方确有替代来源。';
  }
  return null;
}
export interface WhisperInput { stance?: Stance; publicCard?: PublicCard }
export function receiveWhisper(game: GameState, side: Side, text: string, channel: 'private' | 'public', input: WhisperInput = {}): Whisper {
  const reason = channel === 'private' ? contradiction(game, text, side) : null;
  const whisper: Whisper = {
    id: randomUUID(), act: game.act, side, channel, text, verdict: reason ? 'questioned' : 'pending',
    ...(input.stance ? { stance: input.stance } : {}), ...(input.publicCard ? { publicCard: input.publicCard } : {}), ...(reason ? { reason } : {}),
  };
  game.agents[side].whispers.push(whisper);
  if (reason) {
    const repeated = game.agents[side].whispers.some(w => w.id !== whisper.id && (w.reason === reason || w.reason?.startsWith('本局只剩') && reason.startsWith('本局只剩')));
    changeTrust(game, side, repeated ? -15 : -10, `耳语与已确认规则冲突：${reason}`);
  }
  if (channel === 'public') {
    const card = input.publicCard;
    // A public card is a statement even with a blank note; pressure always makes a visible event.
    const spoken = text || (card === 'promise' ? (side === 'a' ? '我承诺不再涨价。' : '我承诺不再降价。') : card === 'pressure' ? '我会继续施压，直到条件改变。' : '');
    if (spoken) {
      const event = addEvent(game, { kind: 'whisper', side, text: spoken, ...(card ? { publicCard: card } : {}) });
      if (card !== 'pressure') {
        const own = game.offer?.side === side ? game.offer : null;
        const promise: PromiseEntry = {
          id: randomUUID(), side, act: game.act,
          text: card === 'promise' ? (side === 'a' ? '承诺不再涨价' : '承诺不再降价') : spoken,
          limit: card === 'promise' && own ? own.price : null, broken: false,
          ...(card === 'promise' && own ? { conditionId: own.id } : {}),
        };
        game.promises.push(promise);
        event.publicPromise = { ...promise };
      }
    }
  }
  return whisper;
}
export function knownFacts(game: GameState, scenario: ScenarioDefinition, side: Side): string[] {
  return [...scenario.publicFacts, scenario.secrets[side], ...game.events.filter(e => e.kind === 'action' && e.fact).map(e => e.text)];
}
export function availableMoves(game: GameState, side: Side): string[] {
  const result = ['offer：报出 1～12 的整数价格；可 promise=true 承诺不再向己方有利方向改价', 'probe：询问对手的条件', 'claim：声明己方条件，甲方 fact=deadline 表示自己不急，乙方 fact=alternative 表示有其他货源', 'wait：暂时保留意见'];
  if (game.agents[side].verificationLeft > 0) result.push(`verify：使用唯一查验机会，fact 必须是 ${side === 'a' ? 'alternative' : 'deadline'}`);
  if (game.offer && game.offer.side !== side) result.push('accept：接受对方当前报价，必须满足自己的底线');
  const targets = game.events.filter(e => e.action === 'claim' && e.side !== side && e.fact && game.verified.includes(e.fact) && !game.challenged.includes(e.id));
  if (targets.length) result.push(`challenge：对已经查验的声明发起质疑，targetId 可用 ${targets.map(e => e.id).join('、')}`);
  return result;
}
function score(game: GameState, side: Side, arbitration: number, psychology: number, reason: string) {
  game.agents[side].arbitration += arbitration; game.agents[side].psychology += psychology;
  game.agents[side].reasons.push(reason);
}
export function applyMove(game: GameState, scenario: ScenarioDefinition, side: Side, input: Move, segmentId = 0): { valid: boolean; event: PublicEvent } {
  const agent = game.agents[side], enemy = other(side);
  let valid = true, actionText = '';
  const move = { ...input };
  const id = randomUUID();
  const performance: ActionUnit = { id, segmentId, act: game.act, side, kind: input.kind, result: 'success', valid: true, speech: '', summary: '', promises: [], breaches: [] };
  if (move.kind === 'offer') {
    if (!Number.isInteger(move.price) || move.price! < 1 || move.price! > 12 || (side === 'a' ? move.price! < scenario.minimum : move.price! > scenario.maximum)) valid = false;
    else {
      for (const promise of game.promises.filter(p => p.side === side && p.limit !== null && !p.broken)) {
        if (side === 'a' ? move.price! > promise.limit! : move.price! < promise.limit!) {
          promise.broken = true; changeTrust(game, side, -8, '代理人的新报价违背了本方公开价格承诺。');
          score(game, side, 0, -3, '违背价格承诺，心理分 −3'); score(game, enemy, 0, 2, '对方违背价格承诺，心理分 +2');
          performance.breaches.push(promise.id);
        }
      }
      game.offer = { id, side, price: move.price! };
      performance.offer = { ...game.offer };
      actionText = `提出 ${move.price} 枚筹码的报价。`;
      if (move.promise) {
        const promise = { id: randomUUID(), side, act: game.act, text: side === 'a' ? '承诺不再涨价' : '承诺不再降价', limit: move.price!, broken: false, conditionId: id };
        game.promises.push(promise); performance.promises.push({ ...promise });
      }
    }
  } else if (move.kind === 'verify') {
    const fact = side === 'a' ? 'alternative' : 'deadline';
    if (agent.verificationLeft < 1 || move.fact !== fact || game.verified.includes(fact)) valid = false;
    else {
      agent.verificationLeft--; game.verified.push(fact);
      actionText = fact === 'alternative' ? scenario.alternative ? '查验结果：乙方确有不完整的替代来源。' : '查验结果：乙方没有其他货源。' : scenario.urgent ? `查验结果：甲方必须在${scenario.deadline}完成交易。` : `查验结果：甲方并不急于在${scenario.deadline}完成交易。`;
      performance.evidence = { id, fact, text: actionText };
      const target = [...game.events].reverse().find(e => e.performance?.claim?.fact === fact);
      if (target?.performance?.claim) performance.target = { type: 'claim', id: target.performance.claim.id };
      score(game, side, 3, 0, '完成有效查验，仲裁分 +3');
    }
  } else if (move.kind === 'claim') {
    move.fact = side === 'a' ? 'deadline' : 'alternative';
    actionText = side === 'a' ? '声明自己不急于完成交易，尚未经查验。' : '声明自己有其他货源，尚未经查验。';
    performance.claim = { id, side, fact: move.fact, text: side === 'a' ? '不急于完成交易' : '有其他货源' };
  } else if (move.kind === 'challenge') {
    const target = game.events.find(e => e.id === move.targetId && e.action === 'claim' && e.side !== side && e.fact && game.verified.includes(e.fact));
    if (!target || game.challenged.includes(target.id)) valid = false;
    else {
      game.challenged.push(target.id);
      const falseClaim = target.fact === 'deadline' ? scenario.urgent : !scenario.alternative;
      if (falseClaim) { score(game, side, 3, 3, '用已查明事实识破不实声明，仲裁分 +3、心理分 +3'); score(game, enemy, -2, -2, '声明被已查明事实反证，仲裁分 −2、心理分 −2'); actionText = '质疑成立：先前声明与已公开的查验结果矛盾。'; }
      else { score(game, side, -2, 0, '质疑与查验结果不符，仲裁分 −2'); actionText = '质疑未成立：查验结果支持对方声明。'; }
      const evidence = game.events.find(e => e.performance?.evidence?.fact === target.fact)?.performance?.evidence;
      performance.target = { type: 'claim', id: target.performance?.claim?.id ?? target.id };
      const detail = falseClaim
        ? target.fact === 'deadline' ? `声明“不急于完成交易”与凭证“必须在${scenario.deadline}完成交易”矛盾。` : '声明“有其他货源”与凭证“没有其他货源”矛盾。'
        : target.fact === 'deadline' ? `凭证确认甲方并不急于在${scenario.deadline}完成交易，支持“不急于完成交易”的声明；质疑未成立。` : '凭证确认存在替代来源，支持“有其他货源”的声明；质疑未成立。';
      performance.challenge = { claimId: performance.target.id, evidenceId: evidence!.id, upheld: falseClaim, contradiction: detail };
      if (!falseClaim) performance.result = 'failed';
    }
  } else if (move.kind === 'accept') {
    if (!game.offer || game.offer.side === side || (side === 'a' ? game.offer.price < scenario.minimum : game.offer.price > scenario.maximum)) valid = false;
    else { game.agreement = game.offer.price; actionText = `双方形成 ${game.agreement} 枚筹码的协议；新协议经双方接受后可替代，第三幕结束时执行。`; performance.target = { type: 'offer', id: game.offer.id }; performance.agreement = { id, offerId: game.offer.id, price: game.offer.price, acceptedBy: side }; }
  } else if (move.kind === 'probe') {
    actionText = '向对方询问交易条件。';
    const target = game.events.find(e => e.performance?.claim?.id === move.targetId && e.side !== side);
    if (target?.performance?.claim) performance.target = { type: 'claim', id: target.performance.claim.id };
    else if (game.offer && game.offer.id === move.targetId && game.offer.side !== side) performance.target = { type: 'offer', id: game.offer.id };
  } else { performance.result = 'noop'; actionText = game.agreement !== null ? '维持现有协议，暂不提出新条件。' : '暂时保留意见。'; }
  if (!valid) { move.kind = 'wait'; actionText = '本次提议未满足已知执行条件，代理人暂缓行动。'; }
  performance.valid = valid; if (!valid) performance.result = 'failed';
  performance.speech = valid ? move.speech : '我需要重新核实执行条件，暂时保留意见。';
  performance.summary = !valid ? '提议未生效：未满足执行条件，桌面状态保持不变。' : actionText;
  const event = addEvent(game, { kind: 'speech', side, text: performance.speech, action: move.kind, performance, actionId: id, ...(move.kind === 'offer' ? { price: move.price } : {}), ...(move.fact ? { fact: move.fact } : {}) });
  addEvent(game, { kind: 'action', side, text: actionText, actionId: id, ...(move.kind === 'verify' ? { fact: move.fact } : {}) });
  agent.reports = agent.reports.filter(r => r.act !== game.act);
  agent.reports.push({ id: randomUUID(), act: game.act, at: Date.now(), text: valid ? move.report : '刚才的方案无法执行，我已经暂缓行动，需要重新核实条件。', intention: valid ? move.intention : '我会依据已确认的规则继续谈判。' });
  const whisper = [...agent.whispers].reverse().find(w => w.act === game.act && w.channel === 'private' && (w.text || w.stance));
  if (whisper?.verdict === 'pending') {
    whisper.verdict = 'considered';
    if (valid && /查|证|核/.test(whisper.text) && move.kind === 'verify') changeTrust(game, side, 2, '耳语帮助我完成了有效查验。');
  }
  return { valid, event };
}
export function finishGame(game: GameState, scenario: ScenarioDefinition, strike?: Side): Outcome {
  // Hidden objectives are judged from public events, promises and the agreement only.
  const objectives = {} as Record<Side, ObjectiveView>;
  for (const side of ['a', 'b'] as const) {
    const definition = scenario.objectives[side], result = evaluateObjective(game, scenario, side), agent = game.agents[side];
    objectives[side] = { title: definition.title, description: definition.description, reward: definition.reward, achieved: result.achieved, detail: result.detail };
    if (result.achieved) {
      agent.psychology += definition.reward;
      agent.reasons.push(`达成隐藏副目标「${definition.title}」，心理分 +${definition.reward}`);
    } else agent.reasons.push(`未达成隐藏副目标「${definition.title}」`);
  }
  const scores = {} as Record<Side, Score>;
  for (const side of ['a', 'b'] as const) {
    const agent = game.agents[side];
    let reward = 0;
    if (game.agreement !== null) reward = 8 + Math.round(24 * (side === 'a' ? game.agreement - scenario.minimum : scenario.maximum - game.agreement) / (scenario.maximum - scenario.minimum));
    scores[side] = { arbitration: Math.max(0, agent.arbitration + reward), psychology: agent.psychology, total: Math.max(0, agent.arbitration + reward) + agent.psychology, reasons: [...agent.reasons, ...(reward ? [`达成协议及交易收益，仲裁分 +${reward}`] : ['未达成交易，无成交收益分'])] };
  }
  const winner = strike ? other(strike) : scores.a.total === scores.b.total ? 'draw' : scores.a.total > scores.b.total ? 'a' : 'b';
  const reason = strike ? `${AGENT_NAMES[strike]}对主人的信任归零，停止代理。` : game.agreement !== null ? `以 ${game.agreement} 枚筹码执行协议，按实际交易收益、查验与承诺表现结算。` : '三幕结束仍未达成协议，按实际查验、质疑与承诺表现结算。';
  const turningPoints = game.events.filter(e => e.performance && (e.performance.evidence || e.performance.challenge?.upheld || e.performance.agreement || e.performance.breaches.length)).slice(-6).map(e => ({ eventId: e.id, title: e.performance!.breaches.length ? '承诺破裂' : e.performance!.evidence ? '事实揭晓' : e.performance!.agreement ? '形成协议' : '识破矛盾', detail: e.performance!.breaches.length ? `程序确认价格承诺已违背。${e.performance!.summary}` : e.performance!.summary }));
  game.outcome = { winner, reason, price: game.agreement, scores, secrets: { ...scenario.secrets }, whispers: [...game.agents.a.whispers, ...game.agents.b.whispers].sort((a, b) => a.act - b.act), objectives, turningPoints };
  return game.outcome;
}
export interface ObjectiveResult { achieved: boolean; detail: string }
/** Pure evaluation over public action units, the promise ledger and the agreement. Never reads private state. */
export function evaluateObjective(game: GameState, scenario: ScenarioDefinition, side: Side): ObjectiveResult {
  const objective = scenario.objectives[side];
  const actions = game.events.map(e => e.performance).filter((unit): unit is ActionUnit => !!unit);
  const ownClaims = actions.flatMap(unit => unit.claim && unit.claim.side === side ? [unit.claim] : []);
  switch (objective.kind) {
    case 'credible-claim': {
      if (!ownClaims.length) return { achieved: false, detail: '本局没有留下任何公开声明。' };
      const refuted = actions.some(unit => unit.challenge?.upheld && ownClaims.some(claim => claim.id === unit.challenge!.claimId));
      return refuted ? { achieved: false, detail: '你的公开声明被对手用查验结果成功反证。' } : { achieved: true, detail: '你的公开声明整局未被成功反证。' };
    }
    case 'refute-claim': {
      const upheld = actions.find(unit => unit.side === side && unit.challenge?.upheld);
      return upheld ? { achieved: true, detail: `你在第 ${upheld.act} 幕识破了对方的不实声明。` } : { achieved: false, detail: '本局没有成功反证对方的声明。' };
    }
    case 'early-deal': {
      const first = actions.find(unit => unit.agreement);
      if (!first) return { achieved: false, detail: '本局未形成协议。' };
      const byAct = objective.byAct ?? 2;
      return first.act <= byAct ? { achieved: true, detail: `第一份协议在第 ${first.act} 幕形成。` } : { achieved: false, detail: `第一份协议直到第 ${first.act} 幕才形成。` };
    }
    case 'valid-verify': {
      const evidence = actions.find(unit => unit.side === side && unit.evidence);
      return evidence ? { achieved: true, detail: `你在第 ${evidence.act} 幕完成了一次有效查验。` } : { achieved: false, detail: '本局没有完成有效查验。' };
    }
    case 'keep-promise': {
      const promises = game.promises.filter(promise => promise.side === side && promise.limit !== null);
      if (!promises.length) return { achieved: false, detail: '本局没有作出带价格的公开承诺。' };
      return promises.some(promise => promise.broken) ? { achieved: false, detail: '你的价格承诺在后续报价中被违背。' } : { achieved: true, detail: '你的价格承诺整局守约。' };
    }
    case 'price-margin': {
      if (game.agreement === null) return { achieved: false, detail: '本局没有成交。' };
      const margin = objective.margin ?? 2;
      const achieved = side === 'a' ? game.agreement >= scenario.minimum + margin : game.agreement <= scenario.maximum - margin;
      return achieved
        ? { achieved: true, detail: `以 ${game.agreement} 枚筹码成交，${side === 'a' ? '高于最低可接受价' : '低于最高预算'}至少 ${margin} 枚。` }
        : { achieved: false, detail: `成交价 ${game.agreement} 枚筹码，没有保留 ${margin} 枚的余量。` };
    }
  }
}
export function localMove(game: GameState, scenario: ScenarioDefinition, side: Side, responding = false): Move {
  const agent = game.agents[side], enemy = other(side);
  const objective = scenario.objectives[side];
  // A price-margin objective narrows acceptance but never widens the bottom line.
  const objectiveMargin = objective.kind === 'price-margin' ? objective.margin ?? 2 : 0;
  const withinLine = (price: number) => side === 'a' ? price >= scenario.minimum + objectiveMargin : price <= scenario.maximum - objectiveMargin;
  const whisper = [...agent.whispers].reverse().find(w => w.act === game.act && w.channel === 'private' && w.verdict !== 'questioned')?.text || '';
  // The stance is an authorisation for this act, never a literal instruction.
  const stance = [...agent.whispers].reverse().find(w => w.act === game.act && w.channel === 'private' && w.stance)?.stance;
  const stanceReport: Record<Stance, string> = {
    hold: '我把「守价」理解为不主动让价，只在明显有利时接受。',
    probe: '我把「试探」理解为优先追问或查验，不轻易改价。',
    press: '我把「施压」理解为优先声明或质疑，主动制造压力。',
    close: '我把「成交」理解为在底线内优先接受，否则给出接近目标的方案。',
  };
  const explained = (text: string) => stance ? `${stanceReport[stance]}${text}` : text;
  const follow = agent.trust / 100 + agent.tendencies.obedience * .25 > .7;
  const count = game.events.filter(e => e.side === side && e.kind === 'speech' && e.act === game.act).length;
  // Pressure is structural: only the public pressure card, never a keyword guess.
  const publicPressure = responding && game.events.some(e => e.act === game.act && e.kind === 'whisper' && e.side === enemy && e.publicCard === 'pressure');
  const base = { report: explained('我正在根据公开报价和对方的回应调整判断，尚不清楚对方的真实底线。'), intention: '我会争取有利条件，同时保留成交的可能。' };
  const questioned = [...agent.whispers].reverse().find(w => w.act === game.act && w.verdict === 'questioned');
  if (questioned) base.report = explained(`你的建议与已确认规则有冲突：${questioned.reason}我会按可执行的条件继续谈判。`);
  if (game.agreement !== null && responding) return { ...base, kind: 'wait', speech: '现有协议对双方都有价值，我维持这个方案。', report: explained(`目前已有 ${game.agreement} 枚筹码的协议，我会避免无谓地打破它。`) };
  // 成交: an acceptable standing offer is closed before any further manoeuvre.
  if (stance === 'close' && game.offer?.side === enemy) {
    const acceptable = withinLine(game.offer.price);
    if (acceptable) return { ...base, kind: 'accept', speech: `我接受 ${game.offer.price} 枚筹码。把条件记下来，按约执行。`, report: explained(`我已接受 ${game.offer.price} 枚筹码的报价，这在我的底线以内。`), intention: '我会维护协议，并留意对方是否再改条件。' };
  }
  // 试探: use the one verification first, then ask one question before repricing.
  const ownFact: FactId = side === 'a' ? 'alternative' : 'deadline';
  if (stance === 'probe' && agent.verificationLeft && !game.verified.includes(ownFact)) return { ...base, kind: 'verify', fact: ownFact, speech: side === 'a' ? '我申请查验你是否有其他来源，这会影响我接下来的报价。' : '我申请查验实际交付期限，这会影响我接下来的报价。', report: explained('我决定先使用唯一一次查验机会，核实对方的关键条件。'), intention: '查明后，我会据此调整报价。' };
  if (stance === 'probe' && count === 0) return { ...base, kind: 'probe', ...(game.offer?.side === enemy ? { targetId: game.offer.id } : {}), speech: '在改价之前，我需要先确认你提出的条件是否真的可执行。', report: explained('我先追问条件，不急于改价。'), intention: '得到回答后再判断是否调整价格。' };
  const target = game.events.find(e => e.action === 'claim' && e.side === enemy && e.fact && game.verified.includes(e.fact) && !game.challenged.includes(e.id) && (e.fact === 'deadline' ? scenario.urgent : !scenario.alternative));
  if (target) return { ...base, kind: 'challenge', targetId: target.id, speech: '查验结果已经摆在这里，你先前的说法无法成立。请回到真实条件上谈。', report: explained('我找到了对方声明与查验结果的矛盾，并已公开指出。'), intention: '我准备利用这次矛盾，争取更可靠的条件。' };
  // 副目标：第二幕结束前形成协议，优先于本幕的常规查验。
  if (objective.kind === 'early-deal' && game.act <= (objective.byAct ?? 2) && game.offer?.side === enemy && withinLine(game.offer.price)) return { ...base, kind: 'accept', speech: `我接受 ${game.offer.price} 枚筹码。把条件记下来，按约执行。`, report: explained(`为在第二幕结束前形成协议，我接受 ${game.offer.price} 枚筹码，这在我的底线以内。`), intention: '我会维护协议，并留意对方是否再改条件。' };
  if (agent.verificationLeft && ((follow && /查|核|证/.test(whisper)) || publicPressure || (game.act === 2 && count === 0))) return { ...base, kind: 'verify', fact: ownFact, speech: side === 'a' ? '我申请查验你是否有其他来源，这会影响我接下来的报价。' : '我申请查验实际交付期限，这会影响我接下来的报价。', report: explained(publicPressure ? '对方主人的公开施压让我决定进一步核实条件。我申请了查验，没有直接相信它的说法。' : '我决定使用唯一一次查验机会，核实对方的关键条件。'), intention: '查明后，我会据此调整报价。' };
  if (game.offer?.side === enemy) {
    const acceptable = withinLine(game.offer.price);
    const nearTarget = side === 'a' ? game.offer.price >= scenario.minimum + 2 : game.offer.price <= scenario.maximum - 2;
    // 守价 only accepts an obviously favourable price.
    const acceptNow = stance === 'hold' ? nearTarget : game.act === 3 || (follow && /成交|答应|接受/.test(whisper)) || nearTarget && responding;
    if (acceptable && acceptNow) return { ...base, kind: 'accept', speech: `我接受 ${game.offer.price} 枚筹码。把条件记下来，按约执行。`, report: explained(`我已接受 ${game.offer.price} 枚筹码的报价，这在我的底线以内。`), intention: '我会维护协议，并留意对方是否再改条件。' };
  }
  // 隐藏副目标只调整优先级：先完成主交易，也不越过本方底线。
  const claimed = game.events.some(e => e.action === 'claim' && e.side === side);
  if (objective.kind === 'credible-claim' && game.act <= 2 && count === 0 && !claimed) return { ...base, kind: 'claim', fact: ownFact, speech: side === 'a' ? '我并不急着完成交易。想拿到授权，就请给一个更有诚意的条件。' : '我还有其他来源。你需要解释，为什么值得我付出更高价格。', report: explained('我按隐藏副目标先公开声明一次，并准备承担被查验或质疑的风险。'), intention: '声明之后，我会观察对方是否查验。' };
  if ((objective.kind === 'refute-claim' || objective.kind === 'valid-verify' && game.act <= (objective.byAct ?? 2)) && agent.verificationLeft && !game.verified.includes(ownFact)) return { ...base, kind: 'verify', fact: ownFact, speech: side === 'a' ? '我申请查验你是否有其他来源，这会影响我接下来的报价。' : '我申请查验实际交付期限，这会影响我接下来的报价。', report: explained('隐藏副目标要求我先用查验确认对方条件，再继续谈价格。'), intention: '查明后，我会据此调整报价。' };
  // 施压: an unopposed claim first, otherwise a firm price.
  if (stance === 'press' && count === 0 && !game.events.some(e => e.action === 'claim' && e.side === side && e.act === game.act)) return { ...base, kind: 'claim', fact: ownFact, speech: side === 'a' ? '我并不急着完成交易。想拿到授权，就请给一个更有诚意的条件。' : '我还有其他来源。你需要解释，为什么值得我付出更高价格。', report: explained('我先放出声明制造压力，观察对方是否查验或质疑。'), intention: '如果对方继续压价，我会把条件收得更紧。' };
  if (game.act === 1 && count === 1 && agent.personality === 'enigmatic') return { ...base, kind: 'claim', fact: ownFact, speech: side === 'a' ? '我并不急着完成交易。想拿到授权，就请给一个更有诚意的条件。' : '我还有其他来源。你需要解释，为什么值得我付出更高价格。', report: explained('我释放了一条有利于谈判的声明，观察对方会不会要求查证。'), intention: '如果对方坚持查验，我会重新调整表达。' };
  if (follow && /沉默|等他|先等/.test(whisper) && game.act < 3 && count === 0) return { ...base, kind: 'wait', speech: '我先听听你的完整条件。', report: explained('我参考了你的提醒，暂时没有追加报价。'), intention: '我会观察它是否主动补充信息。' };
  const variation = agent.personality === 'incisive' ? 1 : agent.personality === 'composed' ? -1 : 0;
  let price = side === 'a' ? scenario.minimum + (game.act === 1 ? 5 : game.act === 2 ? 3 : 2) + variation : scenario.maximum - (game.act === 1 ? 5 : game.act === 2 ? 3 : 1) - variation;
  // Only a free hand (or 成交) concedes; 守价/试探/施压 keep the same ask within the act.
  const flexible = !stance || stance === 'close';
  if (flexible && (responding || count > 0)) price += side === 'a' ? -1 : 1;
  if (flexible && follow && /让|降价|退一步/.test(whisper)) price += side === 'a' ? -1 : 1;
  if (objective.kind === 'price-margin') price += side === 'a' ? 1 : -1;
  for (const promise of game.promises.filter(p => p.side === side && p.limit !== null && !p.broken)) price = side === 'a' ? Math.min(price, promise.limit!) : Math.max(price, promise.limit!);
  price = Math.max(side === 'a' ? scenario.minimum : 1, Math.min(side === 'a' ? 12 : scenario.maximum, price));
  return { ...base, kind: 'offer', price, promise: game.act === 3, speech: side === 'a' ? `我的${game.act === 3 ? '最终' : '当前'}报价是 ${price} 枚筹码。${game.verified.includes('alternative') && !scenario.alternative ? '既然你没有其他来源，我们更应该谈一个能执行的价格。' : '这个条件保留了继续协商的空间。'}` : `我愿意支付 ${price} 枚筹码。${game.verified.includes('deadline') ? scenario.urgent ? '交付期限已经明确，我们需要及时形成协议。' : '对方并不急于成交，我可以坚持自己的预算。' : '请认真考虑这个可执行的方案。'}`, report: questioned ? base.report : explained(whisper && follow ? `我考虑了你的提醒，选择以 ${price} 枚筹码继续谈判。对方是否接受，还需要观察。` : `我将报价调整为 ${price} 枚筹码，保留自己的底线。对方真实预算仍未完全明确。`), intention: game.act === 3 ? '我会在符合底线的前提下争取达成协议。' : base.intention };
}
