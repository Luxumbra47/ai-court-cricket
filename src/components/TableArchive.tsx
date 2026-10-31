import { useEffect, useRef } from 'react';
import type { ActionUnit, RoomView } from '../../shared/whisper';
import { AGENT_NAMES, PUBLIC_CARDS } from '../../shared/whisper';
import { ACTION_LABELS, type TableState } from '../../shared/stage';
import { Portrait } from './Theatre';
import Drawer from './Drawer';
import Icon from './Icon';

export function TranscriptEvents({ room, targetEvent }: { room: RoomView; targetEvent?: string }) {
  return <>
    {room.events.map(event => event.kind === 'system'
      ? <div key={event.id} className="act-divider" id={`event-${event.id}`}><span />{event.text}<span /></div>
      : event.kind === 'action'
        ? <div className={`objective-event${targetEvent === event.id ? ' selected-event' : ''}`} key={event.id} id={`event-${event.id}`} tabIndex={-1}><span className="event-node" /><span>{event.text}</span></div>
        : <article key={event.id} id={`event-${event.id}`} tabIndex={-1} className={`speech speech-${event.side}${event.kind === 'whisper' ? ' public-whisper' : ''}${targetEvent === event.id ? ' selected-event' : ''}`}>
          {event.side && <Portrait side={event.side} />}<div className="speech-body"><div className="speech-heading"><strong>{event.kind === 'whisper' ? `${room.agents.find(a => a.side === event.side)?.nickname || '幕后玩家'}` : event.side ? AGENT_NAMES[event.side] : ''}</strong><span>{event.kind === 'whisper' ? <><Icon name="public" size={13} />{event.publicCard ? `公开${PUBLIC_CARDS[event.publicCard].name}` : '公开低语'}</> : `${event.side === 'a' ? '甲方' : '乙方'}代理人`}</span><time>第 {event.act} 幕</time></div><p>{event.text}</p></div>
        </article>)}
    {room.thinking && <div className="thinking-message" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>{AGENT_NAMES[room.thinking]}正在回应</div>}
  </>;
}

export interface TableArchiveProps {
  room: RoomView;
  table: TableState;
  selected?: ActionUnit;
  active?: ActionUnit;
  step: number;
  units: ActionUnit[];
  review: string | null;
  setReview: (id: string | null) => void;
  staged: boolean;
  outcomeVisible: boolean;
}

/** The exact public table, objective result and reviewable timeline used by the archive drawer. */
export function TableArchive({ room, table, selected, active, step, units, review, setReview, staged, outcomeVisible }: TableArchiveProps) {
  const timeline = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!review) return;
    timeline.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected?.id, review]);
  const target = selected?.target?.id;
  const challenge = selected?.challenge;
  const challengeClaim = table.claims.find(c => c.id === challenge?.claimId);
  const challengeEvidence = table.evidence.find(e => e.id === challenge?.evidenceId);
  return <div className="table-archive">
    <div className="negotiation-table" aria-label="公开谈判桌">
      <div className="table-caption"><span>桌面公开物件</span><small>{staged ? ['行动者入席', '角色行动', '桌面变化', '本步完成'][step] : '仅展示已确认的公开事实'}</small></div>
      <div className="offer-agreement-row">
        <article key={table.offer?.id ?? 'empty'} className={`table-card offer-card${target === table.offer?.id ? ' is-target' : ''}`} data-testid="current-offer"><span className="card-eyebrow">{table.offer ? `${AGENT_NAMES[table.offer.side]}的报价` : '当前报价'}</span><strong>{table.offer ? <>{table.offer.price}<small> 枚筹码</small></> : '等待出价'}</strong><span className="card-status">{table.offer ? table.agreement?.offerId === table.offer.id ? '双方已接受' : '待对方接受' : '尚无报价'}</span>{table.promises.filter(p => !!table.offer && p.conditionId === table.offer.id).map(p => <span className={`promise-seal${p.broken ? ' broken' : ''}`} key={p.id}>◇ {p.text} · {p.broken ? '封签已裂' : '封签'}</span>)}</article>
        <div className="agreement-bridge" aria-hidden="true">◇<span>双方接受</span></div>
        <article key={table.agreement?.id ?? 'none'} className={`table-card agreement-card${table.agreement ? ' has-agreement' : ''}`} data-testid="agreement"><span className="card-eyebrow">有效协议 · 独立保留</span><strong>{table.agreement ? <>{table.agreement.price}<small> 枚筹码</small></> : '尚未合意'}</strong><span className="card-status">{table.agreement ? `甲方交付${room.scenario.object} ⇄ 乙方支付筹码` : '新报价须经对方接受才形成协议'}</span>{table.agreement && <small>第三幕结束执行 · 新报价不会撤销协议</small>}</article>
      </div>
      {challenge && challengeClaim && challengeEvidence && <div className="contradiction-pair" data-upheld={outcomeVisible && challenge.upheld}><article><small>被质疑声明</small><p>{challengeClaim.text}</p></article><div className="evidence-link"><svg viewBox="0 0 100 30" aria-hidden="true"><path d="M0 15H100M45 7l10 8-10 8" /></svg><span>{outcomeVisible ? challenge.upheld ? '矛盾成立' : '质疑未成立' : '核对凭证'}</span></div><article><small>引用凭证</small><p>{challengeEvidence.text}</p></article><p className="contradiction-detail">{outcomeVisible ? challenge.contradiction : '正在并置声明与公开凭证。'}</p></div>}
      <div className="table-materials" aria-label="声明与查验凭证">
        {table.claims.map(claim => <article key={claim.id} className={`material-card claim-card${target === claim.id ? ' is-target' : ''}`} data-status={claim.status} data-current-object={selected?.claim?.id === claim.id}><span className="card-eyebrow">{AGENT_NAMES[claim.side]} · 公开声明</span><p>{claim.text}</p><span className="card-status">{claim.status === 'refuted' ? '已被反证' : table.evidence.some(e => e.fact === claim.fact) ? '已有查验凭证 · 尚未被反证' : '待查证'}</span></article>)}
        {table.evidence.map(evidence => <article key={evidence.id} className="material-card evidence-card" data-current-object={selected?.evidence?.id === evidence.id} data-testid="evidence"><span className="card-eyebrow">已翻开 · 查验凭证</span><p>{evidence.text}</p><span className="card-status">{evidence.fact === 'alternative' ? '替代货源' : '交易期限'} · 公开保留</span></article>)}
        {!table.claims.length && !table.evidence.length && <p className="empty-table">声明与凭证会留在这里，供后续追问和质疑引用。</p>}
      </div>
      {!!selected?.breaches.length && outcomeVisible && <div className="breach-comparison">{selected.breaches.map(id => { const p = table.promises.find(p => p.id === id); return <p key={id}><span className="promise-seal broken">原承诺：{p?.text}（{p?.limit} 枚）</span><span> → 新行动：报价 {selected.offer?.price} 枚 · 已确认违约</span></p>; })}</div>}

      <details className="table-history"><summary>报价历史 {table.offers.length} · 公开承诺 {table.promises.length}</summary>{table.offers.map(offer => <p key={offer.id}>{AGENT_NAMES[offer.side]}：{offer.price} 枚 · {offer.id === table.offer?.id ? '当前报价' : '已收进历史'}</p>)}{table.promises.map(p => <p key={p.id} className={p.broken ? 'broken-text' : ''}>◇ {AGENT_NAMES[p.side]}：{p.text} {p.limit !== null ? `（${p.limit} 枚）` : ''} · {p.broken ? '已违背' : p.limit !== null ? '履行中' : '公开表态'}</p>)}</details>
    </div>
    <div className="objective-result" role="status" data-result={outcomeVisible ? selected?.result : 'pending'}>{selected ? outcomeVisible ? selected.summary : `${AGENT_NAMES[selected.side]} · ${ACTION_LABELS[selected.kind]}` : '双方尚未行动。'}</div>
    <div className="action-timeline" ref={timeline} aria-label="行动时间线，可回看完整对白">{units.length ? units.map((unit, index) => <button key={unit.id} aria-current={selected?.id === unit.id ? 'true' : undefined} onClick={() => setReview(unit.id)}><small>第 {unit.act} 幕 · {index + 1}</small><span>{AGENT_NAMES[unit.side]} · {ACTION_LABELS[unit.kind]}</span><i>{!unit.valid ? '未生效' : unit.result === 'failed' ? '未成立' : unit.kind === 'wait' ? '暂缓' : '已记录'}</i></button>) : <p className="muted">行动时间线 · 交锋开始后可逐次回看</p>}</div>
  </div>;
}

/** Left drawer: full table, timeline, briefing and transcript without duplicating markup. */
export function ArchiveDrawer({ room, table, selected, active, step, units, review, setReview, staged, outcomeVisible, targetEvent, onClose }: TableArchiveProps & { targetEvent?: string; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current; if (box) box.scrollTop = box.scrollHeight;
  }, [room.events.length]);
  useEffect(() => {
    if (!targetEvent) return;
    const timer = requestAnimationFrame(() => document.getElementById(`event-${targetEvent}`)?.scrollIntoView({ block: 'center', inline: 'nearest' }));
    return () => cancelAnimationFrame(timer);
  }, [targetEvent]);
  return <Drawer side="left" title="桌面档案" badge="公开物件 · 仅公开信息" onClose={onClose} bodyClassName="archive-body">
    <details className="archive-briefing">
      <summary><span>议题资料 · {room.scenario.title}</span><small>{room.scenario.kind}</small></summary>
      <p>{room.scenario.introduction}</p>
      <ul>{room.scenario.publicFacts.map(fact => <li key={fact}>{fact}</li>)}</ul>
    </details>
    <TableArchive room={room} table={table} selected={selected} active={active} step={step} units={units} review={review} setReview={setReview} staged={staged} outcomeVisible={outcomeVisible} />
    <section className="archive-transcript" aria-label="完整文字实录">
      <div className="transcript-heading"><h2>完整文字实录</h2><span className="muted">{room.events.length} 条记录</span></div>
      <div className="transcript" ref={scroller} tabIndex={0} aria-label="公开交锋记录，可滚动回看">
        <TranscriptEvents room={room} targetEvent={targetEvent} />
      </div>
    </section>
  </Drawer>;
}
