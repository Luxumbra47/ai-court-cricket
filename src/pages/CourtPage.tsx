import { useEffect, useRef, useState } from 'react';
import type { RoomView } from '../../shared/whisper';
import { ACT_NAMES, AGENT_NAMES, PHASE_NAMES, STANCES } from '../../shared/whisper';
import { Portrait } from '../components/Theatre';
import NegotiationStage from '../components/NegotiationStage';
import Drawer from '../components/Drawer';
import WhisperComposer from '../components/WhisperComposer';
import Icon from '../components/Icon';

function BackstageBody({ room, connected, request }: { room: RoomView; connected: boolean; request: <T = void>(event: string, data?: unknown) => Promise<T> }) {
  const report = room.own.reports.at(-1), change = room.own.changes.at(-1);
  const stance = [...room.own.whispers].reverse().find(w => w.act === room.act && w.channel === 'private' && w.stance)?.stance;
  return <>
    <div className="own-agent"><Portrait side={room.you} large /><div><span className="muted">你的代理人</span><h2>{AGENT_NAMES[room.you]}</h2><span className="agent-role">{room.scenario.roles[room.you]}</span></div><span className="agent-online"><i />{room.own.config.provider === 'mock' ? '本地策略' : '模型代理'}</span></div>
    <div className="trust-state"><div><span>对你的信任</span><strong>{room.own.trust}<small> / 100</small></strong>{change && <details className="trust-history"><summary aria-label="查看信任变化原因" className={change.delta < 0 ? 'error-text' : 'success-text'}>{change.delta > 0 ? '+' : ''}{change.delta} · 原因</summary><div className="trust-change-list">{room.own.changes.map(c => <p key={c.id}>{c.delta > 0 ? '+' : ''}{c.delta}：{c.reason}</p>)}</div></details>}</div><p>{room.own.trust >= 70 ? '愿意听取你的建议' : room.own.trust >= 35 ? '开始谨慎核实你的建议' : room.own.trust > 0 ? '对你的判断抱有怀疑' : '已停止代理'}</p></div>
    <div className="stance-state" aria-label="本幕方针"><span>本幕方针：</span><strong>{stance ? STANCES[stance].name : '未设定'}</strong><small>{stance ? STANCES[stance].description : '可在私密耳语中递出方针卡，或直接留白。'}</small></div>
    <div className="report-scroll"><section className="objective-card" aria-label="你的隐藏副目标"><div className="section-heading"><h3>你的隐藏副目标</h3><span className="objective-reward">达成 +{room.own.objective.reward} 心理分</span></div><strong className="objective-title">{room.own.objective.title}</strong><p>{room.own.objective.description}</p><small>仅你可见；公开舞台、公开低语与对端都不会显示这条目标。</small></section><section className="agent-report" key={report?.id || 'initial'}><div className="section-heading"><h3>本轮汇报</h3><span className="report-act">{report?.act ? `第 ${report.act} 幕` : '开局汇报'}</span></div>{report ? <><p className="report-quote">{report.text}</p><div className="report-intention"><span>接下来</span><p>{report.intention}</p></div></> : <p className="muted">代理人正在整理汇报。</p>}</section>
      {room.own.reports.length > 1 && <details className="report-history"><summary>此前的汇报 <span>{room.own.reports.length - 1}</span></summary>{room.own.reports.slice(0, -1).reverse().map(r => <div key={r.id}><span className="muted">{r.act ? `第 ${r.act} 幕` : '开局'}</span><p>{r.text}</p></div>)}</details>}
      <details className="own-information"><summary>我的目标与私密情报</summary><p>{room.own.goal}</p><p>{room.own.secret}</p><p className="muted">剩余查验机会：{room.own.verificationLeft}</p></details>
    </div>
    <WhisperComposer room={room} connected={connected} request={request} />
  </>;
}

export default function CourtPage({ room, connected, request, onReport, targetEvent, reduceMotion, voiceEnabled, onToggleVoice, ambienceEnabled, onToggleAmbience, can3d, onOpenSettings, onRequestLeave, on3dFailed }: { room: RoomView; connected: boolean; request: <T = void>(event: string, data?: unknown) => Promise<T>; onReport: () => void; targetEvent?: string; reduceMotion: boolean; voiceEnabled: boolean; onToggleVoice: () => void; ambienceEnabled: boolean; onToggleAmbience: () => void; can3d: boolean; onOpenSettings: () => void; onRequestLeave: () => void; on3dFailed: () => void }) {
  const [now, setNow] = useState(Date.now()), [backstageOpen, setBackstageOpen] = useState(false);
  const autoKey = useRef('');
  const finished = room.status === 'finished';
  const seconds = room.deadline ? Math.max(0, Math.ceil((room.deadline - now) / 1000)) : null;
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(timer); }, []);
  // The private booth opens by itself for each fresh whisper stage and folds after submission.
  useEffect(() => {
    if (!can3d) { setBackstageOpen(false); return; }
    const open = room.phase === 'whisper' && !room.submitted.private || room.phase === 'public' && !room.submitted.public;
    if (!open) return;
    const key = `${room.act}:${room.phase}`;
    if (autoKey.current === key) return;
    autoKey.current = key;
    setBackstageOpen(true);
  }, [can3d, room.act, room.phase, room.submitted.private, room.submitted.public]);
  useEffect(() => {
    if (!can3d) return;
    if (room.phase === 'whisper' && room.submitted.private || room.phase === 'public' && room.submitted.public || room.phase !== 'whisper' && room.phase !== 'public') setBackstageOpen(false);
  }, [can3d, room.phase, room.submitted.private, room.submitted.public]);
  if (!can3d) return <div className="match-page is-immersive is-unavailable" data-layout="unavailable">
    <section className="unavailable-panel" aria-label="3D 舞台不可用">
      <span className="ornament" aria-hidden="true">◇</span>
      <h1>3D 舞台不可用</h1>
      <p>本版本只提供全屏 3D 第一视角谈判。请使用宽度至少 900px 且支持 WebGL 的桌面浏览器，并确认浏览器未关闭硬件加速。</p>
      <div className="unavailable-meta"><strong>{room.scenario.title}</strong><span>{room.practice ? '本地陪练' : `房间 ${room.code}`}</span><span>{PHASE_NAMES[room.phase]}</span></div>
      <div className="unavailable-actions">{finished && <button className="button-primary" onClick={onReport}>查看赛后复盘<Icon name="arrow" size={16} /></button>}<button className="button-secondary" onClick={onOpenSettings}>窗口设置</button><button className="button-secondary" onClick={onRequestLeave}>离开房间</button></div>
    </section>
  </div>;
  return <div className="match-page is-immersive" data-layout="full">
    <header className="immersive-hud" aria-label="舞台控制">
      <div className="hud-identity"><span className="hud-brand"><span className="hud-mark" aria-hidden="true">◇</span><strong>低语代理人</strong></span><span className="hud-scenario"><strong>{room.scenario.title}</strong><small>{room.scenario.kind}</small></span><span className="hud-code">{room.practice ? '本地陪练' : `房间 ${room.code}`}</span></div>
      <div className="hud-progress">
        <div className="hud-act" aria-label={`第 ${room.act} 幕，共三幕`}>{ACT_NAMES.map((name, index) => <span key={name} title={name} className={index + 1 === room.act ? 'current' : index + 1 < room.act ? 'complete' : ''}><i>{index + 1 < room.act ? <Icon name="check" size={11} /> : index + 1}</i><em>{name}</em></span>)}</div>
        <span className="hud-phase"><i className={`status-light${!connected ? ' disconnected' : ''}`} /><strong>{PHASE_NAMES[room.phase]}</strong>{seconds !== null && !finished && <span className="hud-timer"><Icon name="clock" size={13} />{seconds} 秒</span>}</span>
      </div>
      <div className="hud-actions">
        {finished && <button className="hud-result" onClick={onReport}>赛后复盘<Icon name="arrow" size={14} /></button>}
        <span className={`hud-connection${connected ? ' connected' : ''}`} role="status" title={connected ? '已连接' : '正在重连'}><i /><em>{connected ? '已连接' : '重连中'}</em></span>
        <button aria-label={ambienceEnabled ? '关闭环境音' : '开启环境音'} aria-pressed={ambienceEnabled} className={`ambience-toggle${ambienceEnabled ? ' is-on' : ''}`} title="环境音" onClick={onToggleAmbience}><Icon name={ambienceEnabled ? 'sound' : 'muted'} size={16} /><span>{ambienceEnabled ? '环境音' : '静音'}</span></button>
        <button aria-label="代理人语音" aria-pressed={voiceEnabled} className={voiceEnabled ? 'is-on' : ''} onClick={onToggleVoice}>{voiceEnabled ? '语音开' : '语音关'}</button>
        <button className="icon-button" aria-label="窗口设置" onClick={onOpenSettings}><Icon name="settings" size={18} /></button>
        <button className="icon-button" aria-label="离开房间" onClick={onRequestLeave}><Icon name="exit" size={18} /></button>
      </div>
    </header>
    <div className="match-layout is-immersive">
      <section className="public-stage is-immersive" aria-label="公开交锋">
        <NegotiationStage room={room} connected={connected} request={request} reduceMotion={reduceMotion} targetEvent={targetEvent} voiceEnabled={voiceEnabled} onToggleVoice={onToggleVoice} on3dFailed={on3dFailed} drawerOpen={backstageOpen} ambienceEnabled={ambienceEnabled} />
      </section>
    </div>
    <button className="backstage-toggle" onClick={() => setBackstageOpen(true)} aria-haspopup="dialog" aria-expanded={backstageOpen}><Icon name="lock" size={15} />幕后包厢{(room.phase === 'whisper' && !room.submitted.private || room.phase === 'public' && !room.submitted.public) && <span className="tab-dot" aria-label="可以提交耳语" />}</button>
    {backstageOpen && <Drawer side="right" title="幕后包厢" badge="仅你可见" onClose={() => setBackstageOpen(false)} bodyClassName="backstage-body"><BackstageBody room={room} connected={connected} request={request} /></Drawer>}
  </div>;
}
