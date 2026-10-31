import { useState } from 'react';
import type { RoomView, Scenario } from '../../shared/whisper';
import { PERSONALITIES } from '../../shared/whisper';
import Theatre, { Portrait } from '../components/Theatre';
import Icon from '../components/Icon';

export default function RoomPage({ room, scenarios, connected, request, onConfigure }: { room: RoomView; scenarios: Scenario[]; connected: boolean; request: <T = void>(event: string, input?: unknown) => Promise<T>; onConfigure: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const own = room.agents.find(a => a.side === room.you)!;
  const ready = room.agents.length === 2 && room.agents.every(a => a.ready && a.online);
  const run = async (event: string, input?: unknown) => { if (busy) return; setBusy(true); setError(''); try { await request(event, input); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(room.code); setCopied(true); } catch { setError('复制未完成，请选中房间码手动复制。'); } };
  return <div className="preparation-page">
    <div className="page-heading"><div><p className="eyebrow">开幕之前</p><h1>席位已留，等待开幕。</h1></div><div className="invite-code"><span>邀请另一位幕后玩家</span><div><strong data-testid="room-code">{room.code}</strong><button className="icon-button" aria-label={copied ? '已复制房间码' : '复制房间码'} onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} /></button></div>{copied && <span role="status">房间码已复制</span>}</div></div>
    <Theatre agents={room.agents} own={room.you} />
    <div className="preparation-seats">{(['a', 'b'] as const).map(side => {
      const agent = room.agents.find(a => a.side === side);
      return <section key={side} className={`preparation-seat seat-${side}`}><Portrait side={side} /><div><span className="muted">{room.scenario.roles[side]}{side === room.you ? ' · 你的代理人' : ''}</span><h2>{agent?.name || (side === 'a' ? '维恩' : '赛芙')}</h2><p>{agent ? `${agent.nickname}在幕后${agent.online ? '' : '（暂时离线）'}` : '等待另一位玩家加入'}</p></div><span className={`seat-status${agent?.ready ? ' is-ready' : ''}`}>{agent?.ready ? '已准备' : agent ? '准备中' : '空席'}</span></section>;
    })}</div>
    <div className="preparation-bottom"><section className="briefing"><div className="section-heading"><h2>本局议题</h2><span className="muted">三幕 · 利益谈判</span></div>{room.host === room.you ? <label className="field"><span className="sr-only">更换议题</span><select aria-label="更换议题" value={room.scenario.id} disabled={busy} onChange={e => void run('room:scenario', { id: e.target.value })}>{scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label> : <h3>{room.scenario.title}</h3>}<p>{room.scenario.introduction}</p><ul>{room.scenario.publicFacts.map(fact => <li key={fact}>{fact}</li>)}</ul></section>
      <aside className="readiness"><h2>你的代理人已就位</h2><p>{room.own.config.provider === 'mock' ? '本地策略代理 · 免费体验' : room.own.config.model}<br /><span className="muted">{PERSONALITIES[room.own.config.personality].name}风格</span></p><button className="button-secondary full" onClick={onConfigure}><Icon name="settings" size={17} />配置我的代理人</button><button className={own.ready ? 'button-secondary full' : 'button-primary full'} disabled={!connected || busy} onClick={() => void run('room:ready', { ready: !own.ready })}>{own.ready ? '取消准备' : '我已准备'}<Icon name="check" size={18} /></button>{room.host === room.you && <button className="button-primary full" disabled={!ready || !connected || busy} onClick={() => void run('game:start')}>拉开帷幕<Icon name="arrow" size={18} /></button>}<p className="readiness-status" role="status">{!connected ? '连接恢复后即可继续。' : room.agents.length < 2 ? '分享房间码，等待另一位玩家入席。' : ready ? room.host === room.you ? '双方已准备，可以开始。' : '等待房主拉开帷幕。' : own.ready ? '你已准备，等待对方。' : '确认配置后，点击“我已准备”。'}</p>{error && <p className="inline-error" role="alert">{error}</p>}<p className="fine-print">开始后，代理人将自动交锋。真实模型每方每局最多 9 次调用，使用各自配置的密钥；无自动重试。</p></aside>
    </div>
  </div>;
}
