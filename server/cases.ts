import type { ActionType, CaseSummary, CaseTemplate, Catalog, Evidence } from '../shared/types.js';

const actions: ActionType[] = ['challenge_evidence', 'timeline_analysis', 'counter_argument', 'present_evidence', 'cross_examination', 'closing_statement', 'use_item', 'review_evidence'];
const READABLE: Record<string, [string, string, string]> = {
  P01: ['走廊监控画面', '监控拍到一名戴红帽的人抱着披萨盒，脸被盆栽挡住。', '有人拿走了披萨盒，但画面没有拍清是谁，显示时间也需要核对。'],
  P02: ['披萨订单', '事务所在 17:50 收到了庆功会用的披萨。', '说明披萨属于事务所，能帮助确认送达时间；订单没有说明谁可以取走。'],
  P03: ['同事的帽子证词', '同事凭红帽认定那人是阿团，但办公室有十二顶同款帽子。', '证人提供了身份线索，同款帽子也让这条线索存在其他解释。'],
  P04: ['保温箱开箱记录', '同一次开箱动作，保温箱记为 17:47，走廊监控却显示 17:55。', '两份记录的时间相差八分钟，不能直接用监控时间判断阿团何时取件。'],
  P05: ['阿团的取件签名', '阿团签收了三块披萨，但用途栏没有填写。', '说明阿团确实取过披萨；是否得到许可，还需要其他材料。'],
  P06: ['老板的送餐许可', '老板在 17:40 留言，请阿团把三块披萨送给维修工。', '这份已签名的许可可以解释阿团为什么取走披萨。'],
  P07: ['维修工收条', '维修工确认收到了阿团送来的三块披萨。', '能够说明披萨的去向，不能单独说明老板有没有提前许可。'],
  D01: ['钻石转移记录', '20:02，虚拟钻石从游乐园的公共账户转到了一个单独保管的账户。', '说明转移确实发生；记录本身没有说明是谁操作，也没有说明是否得到许可。'],
  D02: ['管理员登录记录', '20:00，小闪的管理员账号登录了多人共用的电脑，没有再次核验本人身份。', '账号登录发生在转移之前，但使用这个账号的人是否就是小闪，还需要确认。'],
  D03: ['排行榜截图', '一张截图把这颗虚拟钻石的价值显示为一百万，右下角被表情贴纸遮住。', '这张图被用来说明钻石的价值，但被遮住的内容使它无法完整说明资产情况。'],
  D04: ['自动操作计划', '演练计划规定：20:01，电脑会借用当前登录的账号自动转移测试钻石。', '这为转移提供了另一种解释：登录账号之后，操作也可能由预设程序完成。'],
  D05: ['接收账户权限记录', '经过核验，小闪拥有钻石接收账户的维护权限。', '小闪能够管理接收账户，支持他可能控制钻石去向的说法；有权限并不等于本次未经许可。'],
  D06: ['演练许可单', '19:30，游乐园批准转移测试钻石，接收账户与本案相同。', '这份事先签发的许可能够帮助判断转移是否属于获准的演练。'],
  D07: ['钻石标签错误报告', '事后的检查发现，界面把测试钻石标成了正式钻石。', '屏幕上的“正式钻石”标签可能出错，不能只凭界面标签认定资产性质。'],
  R01: ['休假修改记录', '08:01，R-17 的机器人账号把老板的年假余额写成了 11 天。', '说明机器人执行了修改，但还不能说明这次修改有没有得到批准。'],
  R02: ['老板的手机截图', '08:00，手机仍显示 12 天年假，页面注明数据可能延迟五分钟。', '手机显示与修改记录不同，也可能是更新延迟造成的。'],
  R03: ['走廊传闻', '同事转述机器人说过“老板终于要少休一天了”，没有原始录音。', '这是一条间接转述，无法核对原话和说话情境。'],
  R04: ['年假结转规则', '已确认的规则在 08:00 生效：过期年假扣一天，机器人负责更新余额。', '规则能够解释余额为什么从 12 天变为 11 天。'],
  R05: ['机器人操作权限', 'R-17 有权限直接修改年假余额，但清单没有写这次任务的批准原因。', '说明机器人有能力修改，是否越权仍要看本次任务的许可。'],
  R06: ['老板的批准记录', '老板在前一天 18:00 批准了结转规则和执行时间。', '这份批准记录能帮助说明机器人是否在执行获准的工作。'],
  R07: ['更新完成回执', '任务回执显示 R-17 已成功更新余额，并能与修改记录核对。', '再次确认机器人完成了写入，是否擅自修改还要结合规则与批准记录。'],
};
const GUIDANCE: Record<string, [string, string]> = {
  P01: ['有人抱走了披萨盒，红帽可以作为寻找取件人的线索。', '脸被挡住，画面不能单独确认那个人就是阿团，记录时间也未校准。'],
  P02: ['事务所订购的披萨已经送达，原本用于庆功会。', '订单没有写谁后来取件，也没有列出取件许可。'],
  P03: ['证人记得取件人戴着红帽。', '办公室有多顶同款帽子，不能仅凭帽子确定身份。'],
  P04: ['同一开箱动作的两份记录相差八分钟，监控时间需要重新核对。', '时间差不能单独证明谁拿走了披萨，也没有说明取件是否获准。'],
  P05: ['阿团确实签收过三块披萨。', '用途栏为空，签收不能单独说明是否得到许可或之后送给谁。'],
  P06: ['老板事先要求阿团把三块披萨送给维修工。', '许可本身不能单独证明披萨最终已经送到。'],
  P07: ['维修工收到了阿团送来的三块披萨。', '收条不说明老板是否提前同意这次送餐。'],
  D01: ['虚拟钻石确实在记录时间从公共账户转出。', '转移记录不说明具体操作人，也不说明转移是否获准。'],
  D02: ['小闪的账号在钻石转移前登录了共用电脑。', '账号登录不等于本人操作，这份记录没有再次核验操作者。'],
  D03: ['截图中的界面显示了较高的资产数值。', '截图有遮挡，不能完整确认资产环境，更不能凭价值确定谁操作。'],
  D04: ['演练程序可以借用已登录账号，自动执行测试钻石转移。', '计划表不能单独证明这次实际执行了什么，也不能证明转移已获许可。'],
  D05: ['小闪拥有维护接收账户的权限，有能力管理该账户。', '有权限不等于亲自发起了本次转移，也不等于转移未经许可。'],
  D06: ['游乐园事先批准向本案接收账户转移测试钻石。', '许可单不能单独确定是谁发起了实际转移。'],
  D07: ['事后检查发现，测试钻石可能被界面标成正式钻石。', '标签错误报告不能单独确认操作者，也不能替代转移许可。'],
  R01: ['R-17 的服务账号执行了余额写入。', '写入成功不等于擅自修改，记录没有独立说明授权情况。'],
  R02: ['手机在当时仍显示旧的年假余额。', '页面注明可能延迟更新，截图不能单独证明实际余额未改变。'],
  R03: ['同事提供了一条关于机器人说法的间接线索。', '没有原始录音，不能确认原话和情境，更不能单独证明越权。'],
  R04: ['生效的结转规则要求扣除一天过期年假并同步余额。', '规则本身不能单独证明这次任务已经获准或正确执行。'],
  R05: ['R-17 有直接修改余额的能力。', '能力清单不说明本次操作是否得到许可。'],
  R06: ['老板事先批准了结转规则和执行时间。', '批准记录不能单独证明这次写入完全按规则完成。'],
  R07: ['R-17 完成了写入，回执能与修改记录核对。', '完成回执不说明任务是否越权，需要结合规则和授权判断。'],
};
const evidence = (id: string, title: string, description: string, visibility: Evidence['visibility'], strength: number, reliability: number, technical = false, flaw: string | null = null, linkedIds: string[] = []): Evidence => ({
  id, title: READABLE[id]?.[0] ?? title, description: READABLE[id]?.[1] ?? description,
  explanation: READABLE[id]?.[2], supports: GUIDANCE[id]?.[0], limitations: GUIDANCE[id]?.[1], details: description, visibility, strength, reliability, technical, flaw, linkedIds,
});

export const IDENTITY_CATALOG: Catalog['identities'] = [
  { id: 'civilian', name: '贫民', description: '调查次数 2（基础 1 + 额外 1）。资源用于质询、复核或放大镜。' },
  { id: 'tycoon', name: '富豪', description: '调查次数 3（基础 1 + 额外 2）。钱能买调查，买不了判决。' },
  { id: 'scientist', name: '科学家', description: '调查次数 1；每局首次技术复核或放大镜免调查消耗，共用一次免费技能。' },
];
export const ITEM_CATALOG: Catalog['items'] = [
  { id: 'magnifier', name: '放大镜', description: '仔细检查一份可调查的材料，消耗 1 次调查并结束本回合。发现问题会削弱证明力，核验通过则会加强证明力，还可能发现你的新情报。科学家首次检查技术记录免调查。' },
  { id: 'coffee', name: '清醒咖啡', description: '一次。稳定度低于 100 时恢复 25（上限 100）；恢复不能追回失去的回合。' },
  { id: 'archive', name: '神秘档案', description: '一次。解锁案件预置的下一条己方情报；仍须另行举证才能得分，全部已知时不可使用。' },
  { id: 'interrogate', name: '紧急质询', description: '本回合做好追问准备，下次追问免调查，并加强 2 点效果。使用后结束本回合，不增加行动次数。' },
  { id: 'firewall', name: '逻辑防火墙', description: '一次。抵消下一次最多 15 点稳定度损失，触发后消耗；不能阻止分数变化。' },
  { id: 'extension', name: '时间扩展', description: '用本回合整理思路，下次组合证据成功时额外加强 2 点效果；对方成功追问会打断准备。' },
];

export const CASES: CaseTemplate[] = [
  {
    id: 'pizza-001', version: 4, experienceVersion: 1, engineVersion: 2, timelineRules: [{ evidenceIds: ['P01', 'P04'], delta: -8 }, { evidenceIds: ['P04', 'P06'], delta: -8 }, { evidenceIds: ['P02', 'P05'], delta: 8 }], title: '消失的披萨', subtitle: '一块菠萝，引发办公室悬案',
    background: '周五 18:00，月面事务所的庆功披萨在茶水间离奇消失。穿红帽的实习生阿团被指控擅自取走最后三块披萨。控方必须证明“未经许可取走”，辩方可以质疑身份、时间与授权。',
    dispute: '阿团是否未经许可取走了三块披萨？取件人的身份、时间和许可都需要证据说明。',
    truth: '阿团取走了披萨，但老板通过机器人授权将它送给维修工。走廊摄像头比真实时间快了 8 分钟。',
    review: '行为真实不等于构成擅自取走。授权记录、摄像头时差和保温箱日志共同解释了披萨去向。判决只依据庭审中被程序认可的证据效果。',
    initialScore: 42, threshold: 60,
    rules: { presentMultiplier: 1, challengeBonus: 4, timelineBonus: 8, counterBonus: 5, crossBonus: 4 },
    allowedActions: actions,
    evidence: [
      evidence('P01', '走廊红帽影像', '17:55 的影像里有人抱着披萨盒。脸部被盆栽遮挡，摄像头时间未校准。', 'public', 16, 0.55, true, '遮挡与时钟误差导致身份和时间不能独立成立', ['P02', 'P04']),
      evidence('P02', '披萨订单', '订单显示 17:50 已送达，购买人为事务所，盒上注明“庆功会”。', 'public', 10, 0.95, false, null, ['P01', 'P04']),
      evidence('P03', '同事的帽子证词', '证人说“红帽肯定是阿团”，但承认办公室一共发过十二顶同款帽子。', 'public', 8, 0.4, false, '同款帽子不能唯一识别人', ['P01']),
      evidence('P04', '保温箱温度日志', '保温箱在 17:47 开启，时间由楼宇服务器校准；摄像头显示 17:55 的同一动作。', 'defense', -16, 0.95, true, null, ['P01', 'P02', 'P06']),
      evidence('P05', '阿团的取件签名', '阿团在取件单上签字，数量为三块；单据上用途栏为空。', 'prosecution', 19, 0.9, false, null, ['P02', 'P07']),
      evidence('P06', '老板的机器人授权', '17:40 的签名消息写明“请阿团将三块披萨交给维修工”。该记录来源可核验。', 'defense', -23, 0.95, true, null, ['P04']),
      evidence('P07', '维修工收条', '维修工确认收到阿团送来的三块披萨。收条不能证明老板是否事先授权。', 'prosecution', 9, 0.8, false, '收条只能证明交付而不能证明未经许可', ['P05']),
    ],
  },
  {
    id: 'diamond-002', version: 4, experienceVersion: 1, engineVersion: 2, timelineRules: [{ evidenceIds: ['D01', 'D04'], delta: -7 }, { evidenceIds: ['D04', 'D06'], delta: -7 }, { evidenceIds: ['D01', 'D05'], delta: 7 }], title: '被偷走的虚拟钻石', subtitle: '钻石只是游戏道具，转移也要问清缘由',
    background: '云端游乐园里，一颗限量虚拟钻石（游戏道具，并非实体珠宝）从公共账户转到了另一个保管账户。转移前，小闪的管理员账号曾在共用电脑登录。控方认为小闪私自转走钻石；辩方需要说明，账号登录是否等于本人操作，以及转移是否得到许可。双方围绕“谁操作、有没有许可”展开辩论。',
    dispute: '虚拟钻石确实转出了公共账户；需要查清是谁操作，以及这次转移有没有得到许可。',
    truth: '小闪按演练指令转移了测试钻石。钱包界面把测试资产显示成正式资产，公用终端另有自动脚本。',
    review: '链上转账证明转移发生，但账号登录和资产标签不自动等于个人违法控制。测试授权只能在依法公开后影响庭审分数。',
    initialScore: 48, threshold: 64,
    rules: { presentMultiplier: 1, challengeBonus: 5, timelineBonus: 7, counterBonus: 6, crossBonus: 4 },
    allowedActions: actions,
    evidence: [
      evidence('D01', '链上转账哈希', '20:02，钻石从公用钱包转至隔离钱包；哈希和区块时间一致。', 'public', 18, 0.98, true, null, ['D02', 'D04']),
      evidence('D02', '管理员登录记录', '20:00 小闪账号登录公用终端，但终端未启用人脸或双因素确认。', 'public', 15, 0.6, true, '账号共享且没有二次身份验证', ['D01', 'D04']),
      evidence('D03', '排行榜截图', '截图显示资产值“1000000”，截图右下角被表情贴纸覆盖。', 'public', 9, 0.35, false, '截图缺少资产环境标签', ['D01']),
      evidence('D04', '自动脚本计划表', '20:01 的演练脚本会用登录用户的会话自动转移测试资产。', 'defense', -17, 0.9, true, null, ['D01', 'D02', 'D06']),
      evidence('D05', '隔离钱包控制记录', '小闪拥有隔离钱包的维护权限；权限签名已核验。', 'prosecution', 20, 0.9, true, null, ['D01', 'D07']),
      evidence('D06', '演练授权单', '游乐园在 19:30 签发了测试资产转移许可，隔离钱包地址与案涉地址相同。', 'defense', -24, 0.98, true, null, ['D04']),
      evidence('D07', '界面标签错误报告', '报告确认测试资产标签被渲染成正式钻石；报告提交于事发后。', 'prosecution', -10, 0.85, true, null, ['D05']),
    ],
  },
  {
    id: 'robot-003', version: 4, experienceVersion: 1, engineVersion: 2, timelineRules: [{ evidenceIds: ['R01', 'R04'], delta: -9 }, { evidenceIds: ['R04', 'R06'], delta: -9 }, { evidenceIds: ['R01', 'R05'], delta: 9 }, { evidenceIds: ['R01', 'R07'], delta: 9 }], title: '机器人与休假记录', subtitle: '老板少放一天假，是谁按的回车',
    background: '机器人 R-17 被指控擅自把老板的年假从 12 天改成 11 天。机器人坚称自己只在执行系统同步。控方需证明越权修改，辩方可以举证同步规则、审批及人工操作。',
    dispute: '机器人把年假改成了 11 天，但这次写入究竟是越权修改，还是获准的工作？',
    truth: 'R-17 的确写入了 11 天，但执行的是老板已批准的结转规则。人事界面错误展示了旧余额；R-17 的签名没有被冒用。',
    review: '写入行为与擅自修改是两件事。同步规则与审批可以解释合法性，而可信日志也不能单独证明越权动机。',
    initialScore: 45, threshold: 62,
    rules: { presentMultiplier: 1, challengeBonus: 4, timelineBonus: 9, counterBonus: 5, crossBonus: 5 },
    allowedActions: actions,
    evidence: [
      evidence('R01', '数据库审计日志', '08:01，R-17 的服务账号把余额写成 11；记录有服务端签名。', 'public', 21, 0.98, true, null, ['R02', 'R04']),
      evidence('R02', '老板的手机截图', '08:00 截图仍显示 12 天；页面标注“数据可能延迟五分钟”。', 'public', 12, 0.5, true, '客户端缓存存在明确延迟', ['R01', 'R04']),
      evidence('R03', '走廊传闻', '同事听见机器人说“老板终于要少休一天了”，原始录音不存在。', 'public', 8, 0.3, false, '二手转述没有原始录音', ['R01']),
      evidence('R04', '结转规则版本', '已签名的规则在 08:00 生效：过期年假扣除 1 天，服务账号应同步余额。', 'defense', -19, 0.95, true, null, ['R01', 'R02', 'R06']),
      evidence('R05', '机器人权限清单', 'R-17 具有直接写入余额的能力，但清单不记录本次任务的授权原因。', 'prosecution', 18, 0.9, true, null, ['R01', 'R07']),
      evidence('R06', '老板的电子审批', '前一天 18:00，老板签名批准了规则版本及执行时间。', 'defense', -24, 0.99, true, null, ['R04']),
      evidence('R07', '同步任务回执', '任务回执确认写入成功，执行者为 R-17；任务编号可与审计日志核对。', 'prosecution', 12, 0.92, true, null, ['R01', 'R05']),
    ],
  },
];

export function validateCases(templates: readonly CaseTemplate[]) {
  const caseIds = new Set<string>(), allEvidenceIds = new Set<string>();
  for (const t of templates) {
    const invalid = () => { throw new Error(`案件模板校验失败：${t.id}`); };
    if (!t.id || caseIds.has(t.id) || !Number.isSafeInteger(t.version) || t.version < 1 || !t.dispute?.trim() || !t.title || !t.background || !t.truth) invalid();
    caseIds.add(t.id);
    if (![t.initialScore, t.threshold].every(n => Number.isFinite(n) && n >= 0 && n <= 100) || !Object.values(t.rules).every(n => Number.isFinite(n) && n > 0)) invalid();
    const ids = new Set(t.evidence.map(e => e.id));
    if (ids.size !== t.evidence.length || !t.allowedActions.length || t.allowedActions.some(a => !actions.includes(a))) invalid();
    for (const e of t.evidence) {
      if (!e.id || allEvidenceIds.has(e.id) || !e.title || !e.description || !e.supports || !e.limitations || !['public', 'defense', 'prosecution'].includes(e.visibility) ||
        !Number.isFinite(e.strength) || !Number.isFinite(e.reliability) || e.reliability < 0 || e.reliability > 1 || e.linkedIds.some(id => !ids.has(id))) invalid();
      allEvidenceIds.add(e.id);
    }
    if (['public', 'defense', 'prosecution'].some(side => !t.evidence.some(e => e.visibility === side))) invalid();
    for (const relation of t.timelineRules ?? []) if (relation.evidenceIds.length !== 2 || relation.evidenceIds[0] === relation.evidenceIds[1] || relation.evidenceIds.some(id => !ids.has(id)) || !Number.isFinite(relation.delta)) invalid();
  }
}
validateCases(CASES);
// Case objects are internal constants. Clients receive only publicCase and authorized evidence.
for (const template of CASES) {
  for (const entry of template.evidence) { Object.freeze(entry.linkedIds); Object.freeze(entry); }
  for (const relation of template.timelineRules ?? []) { Object.freeze(relation.evidenceIds); Object.freeze(relation); }
  Object.freeze(template.timelineRules); Object.freeze(template.evidence); Object.freeze(template.rules); Object.freeze(template.allowedActions); Object.freeze(template);
}
Object.freeze(CASES);
export function getCase(id: string): CaseTemplate {
  const result = CASES.find(entry => entry.id === id);
  if (!result) throw new Error('案件不存在');
  return result;
}
export function publicCase(template: CaseTemplate): CaseSummary {
  const { id, version, dispute, title, subtitle, background, threshold, initialScore } = template;
  return { id, version, dispute, title, subtitle, background, threshold, initialScore };
}
