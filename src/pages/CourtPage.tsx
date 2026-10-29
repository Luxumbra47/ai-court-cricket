import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Catalog, EvidenceView, GameEvent, RoomView } from '../../shared/types';
import { DIFFICULTIES, SIDE_NAMES, STAGE_NAMES, TACTICS } from '../../shared/types';
import { playerText, presentEvent } from '../../shared/presentation';
import { Badge, PlayerCard } from '../components/ui';
import { ACTIONS, actionEvents, signed } from '../frontend';
import { courtState, eligibleEvidenceIds, type ActionFocus } from '../courtState';
import ActionPanel from '../components/ActionPanel';

export function EvidenceStatus({ evidence }: { evidence: EvidenceView }) {
  const s = evidence.state;
  return <div className="evidence-badges"><span>{s.disclosure === 'private' ? '仅你可见' : '双方可见'}</span><span>{s.submitted ? '已出示' : '未出示'}</span>{s.challenged && <span>曾被质疑</span>}{s.reviewed && <span>已复核</span>}</div>;
}
export function EventCard({ event, selected, onEvidence, evidence }: { event: GameEvent; selected: boolean; onEvidence: (id: string) => void; evidence: EvidenceView[] }) {
  if (event.kind !== 'action') return <p className={`system-event ${event.kind === 'verdict' ? 'final-event' : ''}`}>{playerText(event.text)}</p>;
  const outcome = event.presentation ?? presentEvent(event).presentation!;
  return <article className={`argument ${selected ? 'highlighted' : ''}`} id={`event-${event.id}`} tabIndex={-1}>
    <div className="argument-heading">{event.side && <Badge side={event.side} />}<h3>{ACTIONS[event.action?.action_type || ''] || '法庭辩论'}</h3>{event.command && <span className="muted event-order">{TACTICS[event.command.tactic]}</span>}</div>
    <p className="speech">{playerText(event.text)}</p>
    {!!event.action?.cited_evidence_ids.length && <div className="citations">{event.action.cited_evidence_ids.map(id => { const e = evidence.find(x => x.id === id); return e && <button className="evidence-link" key={id} onClick={() => onEvidence(id)}>{e.title}<span aria-hidden="true">↗</span></button>; })}</div>}
    <div className="action-outcome"><strong>{outcome.title}</strong><p>{outcome.explanation}</p><div className="outcome-numbers"><span>{event.scoreDelta ? `控方证据强度 ${signed(event.scoreDelta)}` : '证据强度不变'}</span>{event.settlement ? (['defense', 'prosecution'] as const).map(side => <span key={side}>{SIDE_NAMES[side]}冷静值 {signed(event.settlement!.calmChanges[side])}</span>) : !!event.stabilityDelta && <span>本方冷静值 {signed(event.stabilityDelta)}</span>}</div>{event.settlement && <><p className="field-hint">{event.successful ? '本次行动已生效。' : '本次未取得有利收益。'}{event.settlement.costs.join('；')}。</p><p className="field-hint">{event.settlement.impact} {event.settlement.nextSide ? `接下来轮到${SIDE_NAMES[event.settlement.nextSide]}。` : '庭审结束，请查看判决。'}</p></>}<details><summary>查看详细判定与预览说明</summary>{outcome.detailLines.map((line, i) => <p key={i}>{line}</p>)}</details></div>
  </article>;
}
function EvidenceDetails({ evidence, available }: { evidence: EvidenceView; available: boolean }) {
  return <section className="evidence-detail"><h3 tabIndex={-1} id="evidence-detail-heading">{evidence.title}</h3><EvidenceStatus evidence={evidence} /><h4>发生了什么</h4><p>{evidence.description}</p><h4>能说明什么</h4><p>{evidence.supports || evidence.explanation || evidence.description}</p><h4>不能说明什么</h4><p>{evidence.limitations || '单独一份材料不能解释整件事，需要与庭上其他证据相互核对。'}</p><p className="evidence-availability">{available ? '可用于当前行动，请在行动面板中选择。' : '当前仅供阅读；可用材料由本回合行动决定。'}</p>{!evidence.state.submitted && evidence.state.disclosure === 'public' && <p className="muted">双方已经知道这份材料，但还没有正式出示；符合条件时仍可首次出示。</p>}<details className="technical-details"><summary>查看详细资料</summary><p>资料编号：{evidence.id}</p><p>{evidence.details || evidence.description}</p></details></section>;
}
interface Props { room: RoomView; eventId?: string; onReport: () => void; onReconnect: () => void; onConfigure: () => void; onLeave: () => void; connected: boolean; catalog: Catalog | null; request: <T>(event: string, payload?: unknown) => Promise<T> }
export default function CourtPage({ room, eventId, onReport, onReconnect, onConfigure, onLeave, connected, request, catalog }: Props) {
  const game = room.game!, you = room.players.find(p => p.id === room.you)!, ui = courtState(room, connected);
  const actions = actionEvents(room.events), allEvidence = [...room.publicEvidence, ...room.privateEvidence];
  const [mobileTab, setMobileTab] = useState<'court' | 'evidence' | 'status'>('court');
  const [following, setFollowing] = useState(!eventId), [unread, setUnread] = useState(0);
  const followingRef = useRef(!eventId);
  const [tab, setTab] = useState<'public' | 'private'>('public'), [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<ActionFocus>({ optionId: '', targetId: '' });
  const [guide, setGuide] = useState(() => { try { return localStorage.getItem('court-quick-guide-v1.1') !== 'seen'; } catch { return true; } });
  const scroller = useRef<HTMLDivElement>(null), lastCount = useRef(actions.length);
  const evidence = tab === 'public' ? room.publicEvidence : room.privateEvidence;
  const chosenAction = room.actionOptions.find(o => o.id === focus.optionId), materialIds = eligibleEvidenceIds(room, chosenAction, focus.targetId);
  const available = (e: EvidenceView) => chosenAction ? ui.canAct && materialIds.includes(e.id) : ui.canAct && e.state.targetable;
  useEffect(() => { setSelectedId(null); setTab('public'); setMobileTab('court'); followingRef.current = true; setFollowing(true); setUnread(0); lastCount.current = 0; }, [room.code, room.case.id, room.case.version]);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (followingRef.current && box && box.clientHeight > 0) { box.scrollTop = box.scrollHeight; setUnread(0); }
    else if (actions.length > lastCount.current) setUnread(n => n + actions.length - lastCount.current);
    lastCount.current = actions.length;
  }, [actions.length, room.events.length, mobileTab]);
  useEffect(() => {
    if (!eventId) return;
    const target = document.getElementById(`event-${eventId}`), box = scroller.current;
    if (target && box) { followingRef.current = false; setFollowing(false); box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - 12; target.focus({ preventScroll: true }); }
  }, [eventId]);
  const openEvidence = (id: string) => {
    if (!allEvidence.some(e => e.id === id)) return;
    setMobileTab('evidence'); setTab(room.publicEvidence.some(e => e.id === id) ? 'public' : 'private'); setSelectedId(id);
    requestAnimationFrame(() => document.getElementById('evidence-detail-heading')?.focus({ preventScroll: true }));
  };
  const jumpToLatest = () => { followingRef.current = true; setFollowing(true); setUnread(0); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; };
  return <div className="court-workspace">
    <div className="page-heading court-heading"><div><span className="section-label">房间 {room.code} · 你是{SIDE_NAMES[you.side]}{room.difficulty ? ` · ${DIFFICULTIES[room.difficulty]}` : ''}</span><h1>{room.case.title}</h1><p className="case-dispute">{room.case.dispute || room.case.background.split('。')[0] + '。'}</p></div><div className="court-progress"><span className="status-tag">{ui.terminal ? ui.title : game.stage ? STAGE_NAMES[game.stage] : game.phase === 'closing' ? '最终陈词' : `第 ${game.round} / 3 轮`}</span><span className="muted">{game.rulesVersion === 3 ? `机会 ${game.opportunities ?? 0}/12 · 出招 ${actions.length}` : `已完成 ${actions.length} / 8`}</span><button className="text-button" onClick={() => setGuide(!guide)}>玩法提示</button></div></div>
    <div className={`court-state state-${ui.kind}`} role="status"><div><strong>{ui.title}</strong><span>{ui.message}</span></div><div className="court-state-actions">{ui.kind === 'disconnected' && <button className="secondary" onClick={onReconnect}>重新连接</button>}{ui.kind === 'model_missing' && !you.configured && <button className="secondary" onClick={onConfigure}>恢复模型连接</button>}{ui.kind === 'finished' && <button className="primary" onClick={onReport}>查看判决</button>}{ui.terminal && <button className="secondary" onClick={onLeave}>返回大厅</button>}</div></div>
    {room.notice && ['your_turn', 'opponent_turn'].includes(ui.kind) && <p className="court-notice">{playerText(room.notice)}</p>}
    {guide && <div className="quick-guide"><p>读案件 → 看证据 → 选行动与战术 → 确认出招 → 看结果，等对手反击。</p><button className="text-button" onClick={() => { setGuide(false); try { localStorage.setItem('court-quick-guide-v1.1', 'seen'); } catch { /* optional preference */ } }}>明白了</button></div>}
    <section className="score-banner" aria-label="控方证据强度"><span>控方证据强度 <strong>{game.score}</strong><small> / 100</small></span><div className="score-track"><span style={{ width: `${game.score}%` }} /><i style={{ left: `${room.case.threshold}%` }} /></div><span className="muted">达到 {room.case.threshold} 控方胜</span><details className="score-help"><summary>什么意思？</summary><p>现有证据对指控的支持程度，不是被告有罪的概率。最终达到 {room.case.threshold}，控方胜；否则辩方胜。</p></details></section>
    <div className="court-mobile-tabs segmented" aria-label="对局面板">{(['court', 'evidence', 'status'] as const).map(t => <button key={t} className={mobileTab === t ? 'active' : ''} aria-pressed={mobileTab === t} onClick={() => setMobileTab(t)}>{t === 'court' ? '庭审与行动' : t === 'evidence' ? '案件证据' : '双方状态'}</button>)}</div>
    <div className={'turn-layout mobile-' + mobileTab}>
      <aside className="panel turn-evidence"><h2>案件证据</h2>{room.guide ? <details className="case-background case-guide" open={actions.length === 0 || undefined}><summary>案件导览与时间线</summary><h4>发生了什么</h4><p>{room.guide.happened}</p><h4>双方争议</h4><p>{room.guide.dispute}</p><h4>你的目标</h4><p>{room.guide.objective}</p>{room.guide.directions.map(line => <p key={line}>{line}</p>)}<h4>你已掌握的时间线</h4><ol>{room.guide.timeline.map((node, i) => <li key={i}><strong>{node.time}</strong> {node.text}</li>)}</ol><p className="field-hint">时间线只包括你已知的材料；更多节点可通过调查或公开举证补齐。</p></details> : <details className="case-background"><summary>完整案情</summary><p>{room.case.background}</p></details>}<div className="segmented" aria-label="证据范围"><button aria-pressed={tab === 'public'} className={tab === 'public' ? 'active' : ''} onClick={() => { setTab('public'); setSelectedId(null); }}>双方可见 {room.publicEvidence.length}</button><button aria-pressed={tab === 'private'} className={tab === 'private' ? 'active' : ''} onClick={() => { setTab('private'); setSelectedId(null); }}>私人情报 {room.privateEvidence.length}</button></div>
        {tab === 'private' && <p className="private-note">仅你可见；选中使用后才会公开，未选材料不会交给本次 AI。</p>}
        <div className="evidence-list" aria-label="证据列表">{evidence.map(e => <div key={e.id}><button className={`evidence-list-item ${selectedId === e.id ? 'selected' : ''}`} aria-pressed={selectedId === e.id} onClick={() => setSelectedId(selectedId === e.id ? null : e.id)}><strong>{e.title}</strong><small>{e.description}</small><EvidenceStatus evidence={e} />{available(e) && <small className="material-available">可用于{chosenAction ? '当前行动' : '本回合行动'}</small>}</button>{selectedId === e.id && <EvidenceDetails evidence={e} available={available(e)} />}</div>)}</div>{!evidence.length && <p className="empty-message">暂无未公开的私人材料。</p>}
      </aside>
      <div className={`turn-center${ui.canAct ? ' action-active' : ''}`}><section className="panel transcript-panel"><div className="transcript-header"><h2>法庭辩论</h2><span className="muted">{following ? '正在查看最新' : '正在阅读历史'}</span></div><div className="transcript" ref={scroller} tabIndex={0} role="region" aria-label="可滚动的庭审实录" onScroll={e => { const n = e.currentTarget, near = n.scrollHeight - n.scrollTop - n.clientHeight < 48; followingRef.current = near; setFollowing(near); if (near) setUnread(0); }}>
        {room.events.map(event => <EventCard key={event.id} event={event} selected={event.id === eventId} onEvidence={openEvidence} evidence={allEvidence} />)}
        {!actions.length && <p className="empty-message">庭审已经开始。双方确认行动后，律师发言和法庭结算会依次出现在这里。</p>}
      </div><div className="transcript-footer"><span className="muted">律师负责辩论，法庭按证据结算。</span><button className={unread ? 'primary' : 'text-button'} onClick={jumpToLatest}>{unread ? `${unread} 条新发言 · 回到最新` : '回到最新发言'}</button></div></section><ActionPanel room={room} connected={connected} request={request} onFocusChange={setFocus} /></div>
      <aside className="turn-status"><h2>双方状态</h2>{room.players.map(p => <PlayerCard key={p.id} player={p} own={p.id === room.you} compact catalog={catalog} actionStatus={ui.terminal ? ui.title : !p.connected ? '暂时离线' : game.turn === p.side ? ui.kind === 'generating' ? '正在组织辩论' : ui.kind === 'resolving' ? '行动结算中' : '本方行动' : '等待对方行动'} />)}<details className="status-help"><summary>AI 冷静值是什么？</summary><p>某些行动或受到有效反击会降低冷静值，进而限制部分行动；它不代表模型真实智力。</p></details></aside>
    </div>
    {mobileTab !== 'court' && <button className="mobile-back-action secondary" onClick={() => setMobileTab('court')}>返回庭审与行动{unread ? ` · ${unread} 条新发言` : ''}</button>}
  </div>;
}
