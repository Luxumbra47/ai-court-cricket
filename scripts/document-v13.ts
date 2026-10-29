// Offline release documentation. Never starts a server, queries a DB or calls an LLM.
import { writeFileSync } from 'node:fs';
import { CASES_V3, instantiateCase } from '../server/cases-v3.js';
const difficulty = { beginner: '新手', standard: '标准', complex: '复杂' };
const lines = ['# V1.3 案件差异与变体目录', '', '十二案共108份材料；每档四案。以下只列公开设定，不列案件真相、缺陷权重及隐藏关联答案。内部编号供源码审计，普通玩家界面优先显示名称。', '', '| 难度 | 案件 ID / 名称 | 主要争议 | 材料数 | 初始 / 阈值 |', '| --- | --- | --- | --- | --- |'];
for (const t of CASES_V3) lines.push(`| ${difficulty[t.difficulty!]} | ${t.id} · ${t.title} | ${t.dispute} | ${t.evidence.length} | ${t.initialScore} / ${t.threshold} |`);
lines.push('', '## 调查路线与固定事实', '', '每案route-a与route-b的真实事件、证据全集、数值关系相同；各阵营最初获得的两份私人材料交换，后续调查沿不同前置记录逐步解锁。标准和复杂案件有更长的线索链；富豪可一次消耗两份调查资源连续调查两步。科学家可优先检查技术记录，档案和放大镜也是有限的私证获取路径。', '', '服务器生成种子并冻结最终快照，保存variant.id、seed、initialPrivateIds、leads以及规则参数。所有12案×2路线均测试前置可达、完整12机会及严格事件复盘。两方可胜路线使用作者构造的选择验证其存在，不表示双方等概率胜利。', '', '## 各案公开导览', '');
for (const t of CASES_V3) {
  const a = instantiateCase(t.id, 'docs', 'route-a'), b = instantiateCase(t.id, 'docs', 'route-b');
  lines.push(`### ${t.title}`, '', t.background, '', `控方任务：${t.charge}`, '', `辩方任务：${t.defenseGoal}`, '', `调查结构：每阵营route-a / route-b分别有 ${a.leads!.filter(l => l.side === 'defense').length} / ${b.leads!.filter(l => l.side === 'defense').length} 条后续调查线索。本人时间线只在对应材料已公开或已掌握时显示。`, '', `公开初始材料：${t.evidence.filter(e => e.visibility === 'public').map(e => e.title).join('、')}。`, '', '专属事件：一项调查发现事件和一项公开证据链矛盾事件；分支引用本案自己的材料和关系，按阵营一次性触发。发现不自动加分，矛盾须回应对方真实提出的论点。', '');
}
writeFileSync('docs/V1.3-CASES.md', lines.join('\n'));
console.log(`Documented ${CASES_V3.length} cases / ${CASES_V3.reduce((n,t) => n+t.evidence.length,0)} evidence records.`);
