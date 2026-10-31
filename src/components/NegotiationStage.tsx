import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RoomView } from '../../shared/whisper';
import { ACT_NAMES, AGENT_NAMES, PHASE_NAMES } from '../../shared/whisper';
import { ACTION_LABELS } from '../../shared/stage';
import { useStagePlayback } from '../hooks/useStagePlayback';
import Icon from './Icon';
import { ArchiveDrawer } from './TableArchive';

const Stage3D = lazy(() => import('../scene/Stage3D'));

class StageGuard extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  componentDidCatch() { this.setState({ failed: true }); this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function NegotiationStage({ room, connected, request, reduceMotion, targetEvent, voiceEnabled = true, onToggleVoice = () => {}, on3dFailed = () => {}, drawerOpen = false, ambienceEnabled = true }: { room: RoomView; connected: boolean; request: <T = void>(event: string, data?: unknown) => Promise<T>; reduceMotion: boolean; targetEvent?: string; voiceEnabled?: boolean; onToggleVoice?: () => void; on3dFailed?: () => void; drawerOpen?: boolean; ambienceEnabled?: boolean }) {
  const [archiveOpen, setArchiveOpen] = useState(false), [actNotice, setActNotice] = useState<number | null>(null);
  // Both drawers pause the automatic confirmation; closing them resumes unless the user paused.
  const player = useStagePlayback(room, connected, reduceMotion, request, voiceEnabled, drawerOpen || archiveOpen);
  const { units, table, selected, active, step, review, setReview, speed, setSpeed, reduced, skip, voice, advance, gate, paused, togglePause } = player;
  const seenAct = useRef(room.act);
  // A short act card on the public stage only; refreshing or reduced motion enters the act silently.
  useEffect(() => {
    if (seenAct.current === room.act) return;
    seenAct.current = room.act;
    if (reduced || room.status !== 'playing') { setActNotice(null); return; }
    setActNotice(room.act);
    const timer = window.setTimeout(() => setActNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [room.act, reduced, room.status]);
  useEffect(() => { if (targetEvent) setArchiveOpen(true); }, [targetEvent]);
  useEffect(() => {
    if (!targetEvent) return;
    const event = room.events.find(e => e.id === targetEvent);
    if (event?.actionId) setReview(event.actionId);
  }, [targetEvent]);
  const staged = !review && !!active;
  const outcomeVisible = !staged || step >= 3;
  return <div className={`negotiation-stage${staged ? ' is-performing' : ''} is-3d-stage is-full-layout`} data-action-id={selected?.id} data-playing-id={active?.id} data-action={selected?.valid ? selected.kind : 'wait'} data-step={staged ? step : 'settled'} data-reduced={reduced} data-layout="full" style={{ '--play-speed': speed } as React.CSSProperties}>
    {voiceEnabled && voice.ready && !voice.supported && <p className="voice-hint" role="status">没有可用语音：本机服务端与浏览器都没有中文语音，交锋将按正常阅读语速无声推进。可在 Windows“语音”设置中安装中文语音后重启游戏。</p>}
    {review && <div className="history-notice" role="status">正在回看第 {selected?.act} 幕 · 实时已进入第 {room.act} 幕「{PHASE_NAMES[room.phase]}」，回看不会自动推进对局。<button onClick={() => setReview(null)}>返回实时</button></div>}
    <div className="negotiation-scene is-3d is-full" data-3d="true" data-full="true">
      <StageGuard onError={on3dFailed}><Suspense fallback={<div className="stage-3d-loading" role="status"><span className="ornament">◇</span><p>正在布置 3D 谈判桌…</p></div>}>
        <Stage3D room={room} table={table} active={active} selected={selected} step={step} review={review} speaking={review ? null : voice.speaking} reduced={reduced} ambienceEnabled={ambienceEnabled} />
      </Suspense></StageGuard>
      {actNotice !== null && !review && <div className="act-interstitial" key={actNotice} role="status" aria-live="polite"><small>第 {actNotice} 幕</small><strong>{ACT_NAMES[actNotice - 1]}</strong></div>}
      <div className={`scene-dialogue dialogue-${selected?.side ?? 'a'}`} key={selected?.id ?? 'waiting'}><span>{selected ? `${AGENT_NAMES[selected.side]} · ${ACTION_LABELS[selected.kind]}` : room.thinking ? `${AGENT_NAMES[room.thinking]}正在思考` : '帷幕已启 · 等待双方交锋'}</span><p>{selected?.speech ?? '一句低语，余下交给它。'}</p>{selected && <details><summary>完整对白</summary><p>{selected.speech}</p></details>}</div>
    </div>
    {gate.visible && <div className={`step-gate${gate.ready ? ' is-ready' : ''} is-hud`} role="group" aria-label="演出推进">
      <div><strong>{gate.title}</strong><small>{gate.hint}</small>{gate.error && <small className="error-text" role="alert">{gate.error}</small>}</div>
      <div className="gate-controls"><button aria-label="加速播放" aria-pressed={speed === 2} onClick={() => setSpeed(speed === 1 ? 2 : 1)}>{speed}×</button><button aria-label={paused ? '恢复演出' : '暂停演出'} aria-pressed={paused} onClick={togglePause}>{paused ? '恢复演出' : '暂停演出'}</button><button onClick={skip} disabled={!review && (!active || step >= 3)}>{review ? '返回实时' : '跳过演出'}</button></div>
      <button className="button-primary" disabled={!gate.ready} onClick={() => void advance()}>{gate.submitting ? '正在提交…' : gate.waitingPeer ? '等待对方继续' : gate.peerDone || gate.advancing ? '正在推进…' : gate.ready ? gate.stateLabel : '演出中…'}</button>
    </div>}
    <button className="archive-toggle" onClick={() => setArchiveOpen(true)} aria-haspopup="dialog" aria-expanded={archiveOpen}><Icon name="book" size={16} />桌面档案<small>{units.length} 次行动</small></button>
    {archiveOpen && <ArchiveDrawer room={room} table={table} selected={selected} active={active} step={step} units={units} review={review} setReview={setReview} staged={staged} outcomeVisible={outcomeVisible} targetEvent={targetEvent} onClose={() => setArchiveOpen(false)} />}
  </div>;
}
