import { useEffect, useRef, useState } from 'react';
import type { Catalog, RoomView } from '../../shared/types';
import { DIFFICULTIES, MATCH_MODES } from '../../shared/types';
import WaitingSeat from '../components/WaitingSeat';

interface Props { room: RoomView; catalog: Catalog | null; connected: boolean; busy: boolean; pendingConfig: boolean; onConfigure: () => void; onCourt: () => void; onReport: () => void; run: (name: string, work: () => Promise<void>) => Promise<void>; request: <T>(event: string, payload?: unknown) => Promise<T> }
export default function RoomPage({ room, catalog, connected, busy, pendingConfig, onConfigure, onCourt, onReport, run, request }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [seatMotion, setSeatMotion] = useState({ defenseEntry: 0, prosecutionEntry: 0, defenseReady: 0, prosecutionReady: 0, startPulse: 0 });
  const sequence = useRef(0);
  const previous = useRef<{ code: string; players: Record<string, { side: string; connected: boolean; ready: boolean; configured: boolean }>; canStart: boolean } | null>(null);
  const you = room.players.find(p => p.id === room.you)!;
  const host = room.hostId === room.you;
  const waiting = room.status === 'waiting';
  const ready = room.players.length === 2 && room.players.every(p => p.ready && p.connected && p.configured);
  useEffect(() => {
    if (!seatMotion.startPulse) return;
    const token = seatMotion.startPulse;
    const timer = window.setTimeout(() => setSeatMotion(current => current.startPulse === token ? { ...current, startPulse: 0 } : current), 900);
    return () => window.clearTimeout(timer);
  }, [seatMotion.startPulse]);
  useEffect(() => {
    const players = Object.fromEntries(room.players.map(p => [p.id, { side: p.side, connected: p.connected, ready: p.ready, configured: p.configured }]));
    const canStart = room.players.length === 2 && room.players.every(p => p.ready && p.connected && p.configured);
    const before = previous.current;
    previous.current = { code: room.code, players, canStart };
    if (!before || before.code !== room.code) { setSeatMotion({ defenseEntry: 0, prosecutionEntry: 0, defenseReady: 0, prosecutionReady: 0, startPulse: 0 }); return; }
    const next = { ...seatMotion };
    let changed = false;
    for (const player of room.players) {
      const old = before.players[player.id];
      const entry = !old || (!old.connected && player.connected);
      const prepared = !!old && !old.ready && player.ready;
      if (entry) { next[player.side === 'defense' ? 'defenseEntry' : 'prosecutionEntry'] = ++sequence.current; changed = true; }
      if (prepared) { next[player.side === 'defense' ? 'defenseReady' : 'prosecutionReady'] = ++sequence.current; changed = true; }
    }
    if (!before.canStart && canStart && room.hostId === room.you) { next.startPulse = ++sequence.current; changed = true; }
    if (!canStart && next.startPulse) { next.startPulse = 0; changed = true; }
    if (changed) setSeatMotion(next);
  // State transitions are compared by room data, not object references.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.code, room.players, ready, room.hostId, room.you]);
  const blocker = room.status === 'cancelled' ? '房间已取消，请离开后新建房间。' : room.status === 'finished' ? '本次庭审已结束，可以查看报告或重看实录。' : room.status === 'playing' ? '庭审进行中，请前往庭审实录。' : !connected ? '连接已断开，等待重连。' : pendingConfig ? '模型或装备尚未提交，请进入 AI 配置确认保存。' : !you.configured ? '请先完成并保存你的 AI 配置。' : room.players.length < 2 ? '等待朋友加入，分享右侧的房间码。' : !room.players.every(p => p.connected) ? '等待对方重新连接。' : !you.ready ? '你的配置已保存，确认后点击“我已准备”。' : !room.players.every(p => p.configured) ? '等待对方完成 AI 配置。' : !ready ? '你已准备，等待对方准备。' : host ? '双方已准备，可以开始对局。' : '双方已准备，等待房主开始对局。';
  const copy = async () => {
    try { await navigator.clipboard.writeText(room.code); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };
  return <>
    <div className="page-heading"><div><span className="section-label">房间准备</span><h1>{room.case.title}</h1><p className="muted">房主担任辩方，加入者担任控方。完成配置后，双方准备开庭。</p></div><div className="room-code"><span>邀请朋友加入</span><strong data-testid="room-code">{room.code}</strong><button className="secondary" onClick={copy}>{copied ? '已复制房间码' : '复制房间码'}</button>{copyFailed && <span role="status">请选中上方房间码手动复制。</span>}</div></div>
    <div className="room-layout"><div className="stack"><div className="section-heading"><h2>双方席位</h2><span className="muted">{room.players.length} / 2 位玩家</span></div><div className="players-grid waiting-seats">
      {(['defense', 'prosecution'] as const).map(side => {
        const player = room.players.find(p => p.side === side);
        return <WaitingSeat key={side} side={side} player={player} own={player?.id === room.you} catalog={catalog} entranceToken={seatMotion[side === 'defense' ? 'defenseEntry' : 'prosecutionEntry']} readyToken={seatMotion[side === 'defense' ? 'defenseReady' : 'prosecutionReady']} />;
      })}</div>
      <section className="panel case-panel"><div className="section-heading"><h2>案件与规则</h2><span className="subtle-tag">{waiting ? '开庭前可更换' : '案件已锁定'}</span></div>
        {host && waiting && room.case.difficulty && <label className="case-select">案件难度<select aria-label="更换案件难度" value={room.difficulty} disabled={busy} onChange={e => void run('difficulty', async () => { await request('room:difficulty', { difficulty: e.target.value, selection: 'auto' }); })}>{Object.entries(DIFFICULTIES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><small>每档四个独立案件；更换难度后自动选案，双方重新准备。</small></label>}
        {!host && room.difficulty && <p className="muted">{DIFFICULTIES[room.difficulty]} · {room.selection === 'auto' ? '自动选案，回避近期重复' : '房主手动选案'}</p>}
        {host && waiting ? <label className="case-select">提示模式<select aria-label="更换提示模式" value={room.mode ?? 'standard'} disabled={busy} onChange={e => void run('mode', async () => { await request('room:mode', { mode: e.target.value }); })}>{Object.entries(MATCH_MODES).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}</select><span className="muted">{MATCH_MODES[room.mode ?? 'standard'].description} 更换后双方需重新准备。</span></label> : <p>{MATCH_MODES[room.mode ?? 'standard'].label} · {MATCH_MODES[room.mode ?? 'standard'].description}</p>}
        {host && waiting && <label className="case-select">本次案件<select aria-label="更换案件" value={room.case.id} disabled={busy} onChange={e => void run('case', async () => { await request('room:case', { caseId: e.target.value }); })}>{catalog?.cases.filter(c => !c.difficulty || c.difficulty === room.difficulty).map(c => <option value={c.id} key={c.id}>{c.title}</option>)}</select><span className="muted">更换案件视为手动选案，双方需要重新准备。{room.players.length === 2 && room.recentCaseIds?.includes(room.case.id) ? ' 你最近玩过这个案件。' : ''}</span></label>}
        <p className="case-background">{room.case.background}</p><div className="rule-metrics"><div><span>初始证据强度</span><strong>{room.case.initialScore}</strong></div><div><span>定罪阈值</span><strong>{room.case.threshold}</strong></div><div><span>行动机会</span><strong>{room.case.difficulty ? 12 : 8} <small>次</small></strong></div></div>
        <p className="callout">控方最终证据强度达到 {room.case.threshold}，控方胜；否则辩方胜。证据强度不是胜率。</p>
        <p className="muted">{room.case.difficulty ? '辩方先手：调查准备各2次、完整交锋各3次、陈词各1次。没有合法行动才跳过机会；不会因中途达到阈值提前结束。初始冷静值90，0点时辩论有70%失控，调查与恢复不受这项惩罚。' : '辩方先行动，双方各三次正式行动及一次最终陈词。'}道具占主要行动，私人情报仅本人可见。</p>
      </section></div>
      <aside className="panel room-readiness"><span className="section-label">开庭检查</span><h2>准备好，再开庭</h2><ul className="checklist"><li><span className={room.players.length === 2 ? 'check done' : 'check'} aria-hidden="true">{room.players.length === 2 ? '✓' : '1'}</span><span>双方已加入房间</span></li><li><span className={you.configured ? 'check done' : 'check'} aria-hidden="true">{you.configured ? '✓' : '2'}</span><span>你的配置已保存</span></li><li><span className={ready ? 'check done' : 'check'} aria-hidden="true">{ready ? '✓' : '3'}</span><span>双方在线并准备</span></li></ul>
        <p className="readiness-message" role="status">{blocker}</p>
        {waiting ? <div className="stack actions"><button className={you.configured ? 'secondary full' : 'primary full'} onClick={onConfigure}>{you.configured ? '修改 AI 配置' : '配置我的 AI'}<span aria-hidden="true">→</span></button><button className={you.ready ? 'secondary full' : 'primary full'} disabled={busy || !connected || !you.configured || pendingConfig} onClick={() => void run('ready', async () => { await request('room:ready', { ready: !you.ready }); })}>{you.ready ? '取消准备' : '我已准备'}</button>{host && <button className={`primary full${seatMotion.startPulse ? ' start-prompt' : ''}`} disabled={!ready || busy || !connected || pendingConfig} onClick={() => void run('start', async () => { await request('game:start'); })}>开始对局<span aria-hidden="true">→</span></button>}</div> : <div className="stack">{room.game && <button className="primary full" onClick={onCourt}>查看庭审实录</button>}{room.status === 'finished' && <button className="secondary full" onClick={onReport}>查看赛后报告</button>}</div>}
        <p className="field-hint persistence-note">{room.persistence === 'mysql' ? '已启用战绩保存。' : '内存试玩：服务器重启后不保留本局战绩。'}</p>
      </aside>
    </div>
  </>;
}
