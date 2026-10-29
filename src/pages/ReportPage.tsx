import type { RoomView } from '../../shared/types';
import { SIDE_NAMES, TACTICS } from '../../shared/types';
import { Badge } from '../components/ui';
import { playerText } from '../../shared/presentation';
import { ACTIONS, actionEvents, modelName, playerCost, signed } from '../frontend';

export default function ReportPage({ room, onEvent, onCourt, onNewMatch }: { room: RoomView; onEvent: (id: string) => void; onCourt: () => void; onNewMatch: () => void }) {
  const verdict = room.game!.verdict!;
  const actions = actionEvents(room.events);
  const turningPoints = new Set([...actions].sort((a, b) => Math.abs(b.scoreDelta ?? 0) - Math.abs(a.scoreDelta ?? 0)).slice(0, 3).filter(e => e.scoreDelta).map(e => e.id));
  const scores = [room.case.initialScore, ...actions.map(e => e.scoreAfter)];
  const x = (i: number) => 48 + i * (740 / Math.max(1, scores.length - 1));
  const y = (score: number) => 210 - score * 1.7;
  const points = scores.map((score, i) => `${x(i)},${y(score)}`).join(' ');
  const players = [...room.players].sort((a, b) => a.side === b.side ? 0 : a.side === 'prosecution' ? -1 : 1);
  const metrics = [
    { name: '实际出招 / 跳过机会', value: (p: typeof players[number]) => `${actions.filter(e => e.side === p.side).length} / ${room.events.filter(e => e.kind === 'skip' && e.side === p.side).length}` },
    { name: '严重失控 / 正常思维', value: (p: typeof players[number]) => `${actions.filter(e => e.side === p.side && e.meltdown?.occurred).length} / ${actions.filter(e => e.side === p.side && e.meltdown && !e.meltdown.occurred).length}` },
    { name: '成功出示 / 质疑', value: (p: typeof players[number]) => ['present_evidence', 'challenge_evidence'].map(type => actions.filter(e => e.side === p.side && e.action?.action_type === type && e.successful).length).join(' / ') },
    { name: '冒险成功 / 尝试', value: (p: typeof players[number]) => `${actions.filter(e => e.side === p.side && e.random?.succeeded).length} / ${actions.filter(e => e.side === p.side && e.random).length}` },
    { name: '消耗调查 / 道具', value: (p: typeof players[number]) => `${actions.filter(e => e.side === p.side).reduce((n, e) => n + Math.max(0, (e.resources?.investigationBefore ?? 0) - (e.resources?.investigationAfter ?? 0)), 0)} / ${p.state?.usedItems.length ?? 0}` },
    { name: '身份技能', value: (p: typeof players[number]) => p.state?.identity === 'tycoon' ? p.state.tycoonInvestigationUsed ? '并行调查已用' : '并行调查未用' : p.state?.identity === 'civilian' && room.game?.rulesVersion === 3 ? p.state.civilianRecoveryUsed ? '首次整理加成已用' : '首次整理加成未用' : p.state?.identity === 'scientist' ? p.state.scientificAnalysisUsed ? '免费检查已用' : '免费检查未用' : '额外调查资源' },
    { name: '最终冷静值', value: (p: typeof players[number]) => `${p.state?.stability ?? 100} / 100` },
    { name: '模型请求 / 重试', value: (p: typeof players[number]) => `${p.usage.calls} / ${p.usage.retries}` },
    { name: '调用失败 / 预设降级', value: (p: typeof players[number]) => `${p.usage.failures} / ${p.usage.fallback}` },
    { name: '输入 / 输出 Token', value: (p: typeof players[number]) => p.config?.provider !== 'mock' && p.usage.inputTokens === 0 && p.usage.outputTokens === 0 ? '0 / 0（未报告或未调用）' : `${p.usage.inputTokens.toLocaleString('zh-CN')} / ${p.usage.outputTokens.toLocaleString('zh-CN')}` },
    { name: '模型费用估算', value: playerCost },
  ];
  return <>
    <div className="page-heading"><div><span className="section-label">赛后报告 · {room.case.title}</span><h1>{SIDE_NAMES[verdict.winner]}胜诉</h1><p className="muted">{verdict.convicted ? '证据强度达到定罪阈值。' : '证据强度未达到定罪阈值。'}结果由固定案件规则计算。</p></div><button className="secondary" onClick={onCourt}>重看庭审实录</button></div>
    <section className="panel verdict-summary"><div><Badge side={verdict.winner} /><h2>{verdict.convicted ? '证据成立，有罪判决' : '证据不足，无罪判决'}</h2><p>{verdict.explanation}</p></div><div className="verdict-value"><span>最终证据强度</span><strong className="numeric">{verdict.score}<small> / {verdict.threshold}</small></strong><span className="muted">右侧数字为定罪阈值</span></div></section>
    <section className="panel score-history"><div className="section-heading"><div><h2>证据强度变化</h2><p className="muted">从开庭到最终陈词，查看每次行动的影响。</p></div><span className="chart-legend"><i aria-hidden="true" />控方证据强度<span className="threshold-legend" aria-hidden="true" />定罪阈值 {verdict.threshold}</span></div>
      <svg className="score-chart" viewBox="0 0 840 252" role="img" aria-labelledby="chart-title chart-description"><title id="chart-title">{actions.length}次实际行动的控方证据强度变化</title><desc id="chart-description">初始 {scores[0]}，最终 {verdict.score}，定罪阈值 {verdict.threshold}。完整数值见下方行动数据表。</desc>
        {[0, 25, 50, 75, 100].map(score => <g key={score}><line x1="48" x2="788" y1={y(score)} y2={y(score)} className="chart-grid" /><text x="32" y={y(score) + 5} textAnchor="end">{score}</text></g>)}
        <polygon points={`48,210 ${points} ${x(scores.length - 1)},210`} className="chart-area" />
        <line x1="48" x2="788" y1={y(verdict.threshold)} y2={y(verdict.threshold)} className="chart-threshold" />
        <polyline points={points} className="chart-line" />{scores.map((score, i) => <g key={i}><circle cx={x(i)} cy={y(score)} r="4" className="chart-dot" /><text x={x(i)} y={y(score) - 12} textAnchor="middle" className="chart-value">{score}</text><text x={x(i)} y="240" textAnchor="middle">{i === 0 ? '开庭' : `行动 ${i}`}</text></g>)}
      </svg>
      <details className="chart-data"><summary>查看逐次行动数据与实录</summary><div className="table-wrap"><table><caption className="sr-only">逐次行动证据强度</caption><thead><tr><th>行动</th><th>阵营</th><th>类型</th><th>分数变化</th><th>行动后强度</th><th>实录</th></tr></thead><tbody><tr><th>开庭</th><td>—</td><td>初始状态</td><td>—</td><td>{room.case.initialScore}</td><td>—</td></tr>{actions.map((e, i) => <tr key={e.id}><th>{i + 1}</th><td>{e.side ? SIDE_NAMES[e.side] : '系统'}</td><td>{ACTIONS[e.action?.action_type || '']}</td><td>{signed(e.scoreDelta ?? 0)}</td><td>{e.scoreAfter}</td><td><button className="text-button" onClick={() => onEvent(e.id)}>定位发言</button></td></tr>)}</tbody></table></div></details>
    </section>
    <section className="panel comparison"><div className="section-heading"><h2>双方表现</h2><span className="muted">按同一口径对照</span></div><div className="table-wrap"><table><caption className="sr-only">双方冷静值、模型调用与费用比较</caption><thead><tr><th>指标</th>{players.map(p => <th key={p.id}><div className="comparison-player"><Badge side={p.side} /><strong>{p.nickname}{p.id === room.you ? '（你）' : ''}</strong>{p.side === verdict.winner && <span className="winner-label">胜诉</span>}</div><p className="model-name">{modelName(p)}</p></th>)}</tr></thead><tbody>{metrics.map(metric => <tr key={metric.name}><th scope="row">{metric.name}</th>{players.map(p => <td className="numeric" key={p.id}>{metric.value(p)}</td>)}</tr>)}</tbody></table></div><p className="table-note">预设模式无外部调用。真实模型 Token 为 0 可能表示服务商未报告用量或未发起调用，不代表免费。费用按已报告用量与填写单价估算，缺少信息时显示未知，最终以服务商账单为准。</p></section>
    <section className="panel"><div className="section-heading"><h2>判决中的主要转折</h2><span className="muted">实际分数变化最大的三次行动</span></div>{actions.filter(e => turningPoints.has(e.id)).map(e => <p key={e.id}>{e.side ? SIDE_NAMES[e.side] : ''} · {ACTIONS[e.action!.action_type]} · {signed(e.scoreDelta ?? 0)}：{e.action!.cited_evidence_ids.map(id => [...room.publicEvidence, ...room.privateEvidence].find(x => x.id === id)?.title).filter(Boolean).join('、') || '战术或状态效果'}。{playerText(e.settlement?.explanation || e.reason || '')}</p>)}{room.events.filter(e => e.kind === 'case_event').map(e => <p key={e.id}>{e.text}</p>)}</section>
    <section className="panel"><div className="section-heading"><h2>关键行动</h2><span className="muted">点击返回对应发言</span></div><div className="key-actions">{actions.map((event, i) => <button key={event.id} onClick={() => onEvent(event.id)}><span className="action-number">{i + 1}</span>{event.side && <Badge side={event.side} />}<span className="key-action-description"><strong>{ACTIONS[event.action?.action_type || '']}</strong><span>{event.command ? TACTICS[event.command.tactic] + ' · ' : ''}{event.meltdown ? event.meltdown.occurred ? '严重失控 · ' : '低谷中正常发挥 · ' : ''}{event.random ? `冒险${event.random.succeeded ? '成功' : '失败'} · ` : ''}{turningPoints.has(event.id) ? '关键转折 · ' : ''}{playerText(event.presentation?.explanation || event.reason || (event.accepted ? '已听取' : '未获支持'))}</span></span><strong className="numeric">{signed(event.scoreDelta ?? 0)}</strong><span aria-hidden="true">↗</span></button>)}</div></section>
    <div className="report-bottom"><p className="muted">{room.persistence === 'mysql' ? '本局结果已保存。' : '本局为内存试玩，服务器重启后不保留。'}<br />本局密钥已从服务器房间配置清除。</p><button className="primary" onClick={onNewMatch}>返回首页，新开一局<span aria-hidden="true">→</span></button></div>
  </>;
}
