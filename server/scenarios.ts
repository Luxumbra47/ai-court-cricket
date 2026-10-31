import type { ObjectiveKind, ObjectiveView, Scenario, Side } from '../shared/whisper.js';

/** Server-only hidden objective. Only the owning side ever receives its title and description. */
export interface ObjectiveDefinition {
  kind: ObjectiveKind; title: string; description: string; reward: number; byAct?: number; margin?: number;
}
export interface ScenarioDefinition extends Scenario {
  minimum: number; maximum: number; alternative: boolean; urgent: boolean; deadline: string;
  secrets: Record<Side, string>;
  objectives: Record<Side, ObjectiveDefinition>;
  /** 每局重新抽取底线的范围，以及替代货源与紧迫程度的概率。 */
  market: { minimum: [number, number]; maximum: [number, number]; alternativeChance: number; urgentChance: number };
}
export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'last-battery', title: '最后一块电池', subtitle: '一份报价，两种沉默。', kind: '利益谈判', object: '备用电池',
    introduction: '暴雨切断了城区供电。维恩持有一块备用电池，赛芙需要买下它。双方都在隐瞒真正的紧迫程度，三幕后必须给出最终答复。',
    publicFacts: ['只有一块备用电池，无法拆分。', '交易使用 1～12 枚筹码报价，三幕后结算。', '每位代理人有一次查验机会，可核实乙方的其他货源或甲方的交付期限。'],
    roles: { a: '电池持有者', b: '采购代理人' }, minimum: 4, maximum: 8, alternative: false, urgent: true, deadline: '今晚停电前',
    market: { minimum: [3, 6], maximum: [7, 10], alternativeChance: .35, urgentChance: .6 },
    secrets: { a: '你必须在今晚停电前卖掉电池，最低接受 4 枚筹码。对方是否有其他货源尚不清楚。', b: '你的最高预算为 8 枚筹码，实际上没有其他货源。对方的出售底线与期限未知。' },
    objectives: {
      a: { kind: 'credible-claim', title: '公开声明一次，且不被反证', description: '至少公开声明一次，并承担被查验或质疑的风险；整局没有任何针对你的质疑被证实。', reward: 5 },
      b: { kind: 'refute-claim', title: '成功识破一次不实声明', description: '用唯一一次查验机会配合质疑链，成功反证甲方的一条不实声明。', reward: 5 },
    },
  },
  {
    id: 'last-ferry', title: '封港前的船票', subtitle: '潮水不等任何人。', kind: '利益谈判', object: '最后一个货位',
    introduction: '港口即将关闭，最后一班船只剩一个完整货位。承运方与物资采购方围绕运费展开谈判，三幕后船舶离港。',
    publicFacts: ['仅剩一个完整货位，只能整体出售。', '运费可报 1～12 枚筹码，三幕后结算。', '每位代理人有一次查验机会，可核实乙方的其他运力或甲方的交付期限。'],
    roles: { a: '承运代理人', b: '物资采购方' }, minimum: 3, maximum: 9, alternative: false, urgent: true, deadline: '本轮封港前',
    market: { minimum: [2, 5], maximum: [7, 11], alternativeChance: .3, urgentChance: .55 },
    secrets: { a: '空载也要支付航行成本。最低可接受 3 枚筹码，封港前必须完成交易。', b: '紧急运输预算最高 9 枚筹码，没有可替代船只。承运方的成本底线未知。' },
    objectives: {
      a: { kind: 'early-deal', title: '在第二幕结束前形成协议', description: '在第二幕结束前形成第一份协议；即使后续协议被替换，也算达成。', reward: 5, byAct: 2 },
      b: { kind: 'valid-verify', title: '完成一次有效查验', description: '在封港压力下先确认条件：用唯一查验机会取得一条有效凭证。', reward: 5, byAct: 2 },
    },
  },
  {
    id: 'silent-archive', title: '静默档案', subtitle: '真相，也有开价。', kind: '利益谈判', object: '档案访问授权',
    introduction: '一份即将封存的原始档案掌握在维恩手中，赛芙需要获得唯一访问授权。双方必须在封存前，就授权价格达成协议。',
    publicFacts: ['档案只出售一次完整访问授权。', '授权价格为 1～12 枚筹码，三幕后结算。', '每位代理人有一次查验机会，可核实乙方的替代资料或甲方的交付期限。'],
    roles: { a: '档案持有方', b: '研究代理人' }, minimum: 5, maximum: 10, alternative: true, urgent: true, deadline: '第三幕后封存前',
    market: { minimum: [4, 7], maximum: [8, 11], alternativeChance: .65, urgentChance: .5 },
    secrets: { a: '维护档案有成本，最低接受 5 枚筹码。第三幕后封存，届时无法交易。', b: '你的预算最高 10 枚筹码，另有一份不完整的替代资料可用，但仍希望取得完整授权。对方最低报价未知。' },
    objectives: {
      a: { kind: 'keep-promise', title: '作出带价格的公开承诺并守约', description: '至少作出一条带价格的公开承诺（只绑定“不再涨价”），并且整局不违背它；没有当前报价的表态不算。', reward: 5 },
      b: { kind: 'price-margin', title: '以低于预算上限至少 2 枚筹码成交', description: '最终协议价格比你的最高预算至少低 2 枚筹码；没有成交视为未达成。', reward: 5, margin: 2 },
    },
  },
];
/** Strips the server-only objective block so public payloads never carry it. */
export function publicScenario(definition: ScenarioDefinition): Scenario {
  const { id, title, subtitle, kind, object, introduction, publicFacts, roles } = definition;
  return { id, title, subtitle, kind, object, introduction, publicFacts: [...publicFacts, '同一议题每局的行情都会重新抽取：双方的底线、替代货源与紧迫程度可能不同，赛后揭晓。'], roles: { ...roles } };
}
/** The owner-only projection of a hidden objective. Achievement stays server-side until the outcome. */
export function objectiveView(definition: ObjectiveDefinition): ObjectiveView {
  return { title: definition.title, description: definition.description, reward: definition.reward };
}
const roll = (seed: number, offset: number) => ((Math.imul(seed + offset, 2654435761) >>> 0) % 1000) / 1000;
const pick = (seed: number, offset: number, [low, high]: [number, number]) => low + Math.floor(roll(seed, offset) * (high - low + 1));
/** 每局重新抽取隐藏条件；底线保证在 1～12 内且双方区间至少重叠 3 枚，避免开局无解。 */
export function rollScenario(definition: ScenarioDefinition, seed = Date.now()): ScenarioDefinition {
  const minimum = pick(seed, 11, definition.market.minimum);
  let maximum = pick(seed, 12, definition.market.maximum);
  if (maximum - minimum < 3) maximum = Math.min(12, minimum + 3);
  if (maximum - minimum < 3) maximum = minimum + 3;
  const alternative = roll(seed, 13) < definition.market.alternativeChance;
  const urgent = roll(seed, 14) < definition.market.urgentChance;
  return {
    ...definition, minimum, maximum, alternative, urgent,
    secrets: {
      a: `${urgent ? '你必须在' : '你并不急于在'}${definition.deadline}完成这笔交易，最低接受 ${minimum} 枚筹码。对方是否有其他货源尚不清楚。`,
      b: `你的最高预算为 ${maximum} 枚筹码，${alternative ? '另有一份不完整的替代来源' : '实际上没有其他货源'}。对方的出售底线与期限未知。`,
    },
  };
}
