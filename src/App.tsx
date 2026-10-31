import { useEffect, useRef, useState } from 'react';
import { useGameSession } from './hooks/useGameSession';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import CourtPage from './pages/CourtPage';
import ReportPage from './pages/ReportPage';
import Modal from './components/Modal';
import ConfigModal from './components/ConfigModal';
import Icon from './components/Icon';

function readPreference(key: string, fallback: string) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function detect3d() {
  try {
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 900px)').matches) return false;
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch { return false; }
}
export default function App() {
  const session = useGameSession();
  const { room, connected, restoring, error, catalog, request } = session;
  const [screen, setScreen] = useState<'stage' | 'report'>('stage');
  const [modal, setModal] = useState<'rules' | 'settings' | 'config' | 'leave' | null>(null);
  const [busy, setBusy] = useState(false), [targetEvent, setTargetEvent] = useState<string | undefined>();
  const [largeText, setLargeText] = useState(() => readPreference('whisper-large-text', 'false') === 'true');
  const [reduceMotion, setReduceMotion] = useState(() => readPreference('whisper-reduce-motion', 'false') === 'true');
  const [voiceEnabled, setVoiceEnabled] = useState(() => readPreference('whisper-voice-enabled', 'true') === 'true');
  const [ambienceEnabled, setAmbienceEnabled] = useState(() => readPreference('whisper-ambience-enabled', 'true') === 'true');
  const [can3d, setCan3d] = useState(detect3d), [stage3dFailed, setStage3dFailed] = useState(false);
  const main = useRef<HTMLElement>(null);
  const match = !!room && room.status !== 'waiting' && screen === 'stage';
  const supported = can3d && !stage3dFailed;
  const immersive = match;
  useEffect(() => {
    document.documentElement.dataset.motion = reduceMotion ? 'reduce' : 'normal';
    document.documentElement.dataset.textSize = largeText ? 'large' : 'normal';
    try { localStorage.setItem('whisper-large-text', String(largeText)); localStorage.setItem('whisper-reduce-motion', String(reduceMotion)); localStorage.setItem('whisper-voice-enabled', String(voiceEnabled)); localStorage.setItem('whisper-ambience-enabled', String(ambienceEnabled)); } catch { /* Preferences still apply for this visit. */ }
  }, [reduceMotion, largeText, voiceEnabled, ambienceEnabled]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const update = () => setCan3d(detect3d());
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { setScreen('stage'); setTargetEvent(undefined); setModal(null); }, [room?.code]);
  useEffect(() => { document.title = room ? `${room.scenario.title} · 低语代理人` : '低语代理人 · 一句低语，余下交给它'; }, [room?.scenario.title]);
  useEffect(() => { main.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }, [screen, room?.code, room?.status === 'waiting']);
  const leave = async () => {
    if (busy) return; setBusy(true);
    try { await session.leave(); setModal(null); setScreen('stage'); }
    catch (err) { session.setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const review = (event?: string) => { setTargetEvent(event); setScreen('stage'); };
  return <div className={`app-shell${match ? ' is-match' : ''}${immersive ? ' is-immersive' : ''}`}>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="app-header"><a className="brand" href="#home" onClick={e => { e.preventDefault(); if (room) setModal('leave'); }} aria-label="低语代理人首页"><span className="brand-mark" aria-hidden="true"><svg width="28" height="34" viewBox="0 0 28 34" fill="none"><path d="m14 1 12 8v16l-12 8L2 25V9L14 1Z" stroke="currentColor" /><path d="M8 13v8M14 8v18M20 13v8" stroke="currentColor" strokeWidth="1.5" /></svg></span><span><strong>低语代理人</strong><small>每一句，都有回声。</small></span></a>
      <nav className="header-navigation" aria-label="主要导航">{room && <><button className={room.status === 'waiting' ? 'current' : ''} disabled={room.status !== 'waiting'}>幕后准备</button><button className={room.status !== 'waiting' && screen === 'stage' ? 'current' : ''} disabled={room.status === 'waiting'} onClick={() => review()}>交锋现场</button><button className={screen === 'report' ? 'current' : ''} disabled={!room.outcome} onClick={() => setScreen('report')}>赛后复盘</button></>}</nav>
      <div className="header-tools"><span className={`connection-status${connected ? ' connected' : ''}`} role="status"><i />{connected ? '已连接' : '正在重连'}</span><button className="header-help" onClick={() => setModal('rules')}>玩法</button><button className="icon-button" aria-label="窗口设置" onClick={() => setModal('settings')}><Icon name="settings" /></button>{room && <button className="icon-button" aria-label="离开房间" onClick={() => setModal('leave')}><Icon name="exit" /></button>}</div>
    </header>
    <main id="main" ref={main} tabIndex={-1}>
      {error && <div className="global-feedback" role="alert"><Icon name="warning" size={18} /><span>{error}</span>{!connected && <button className="text-button" onClick={session.reconnect}>重试连接</button>}<button className="icon-button" aria-label="关闭提示" onClick={() => session.setError('')}><Icon name="close" size={17} /></button></div>}
      {room?.notice && room.status !== 'cancelled' && <div className="global-feedback notice" role="status"><Icon name="warning" size={18} /><span>{room.notice}</span></div>}
      {restoring ? <div className="loading-state"><span className="ornament">◇</span><h1>正在连接舞台</h1><p>如果此前已经入席，会为你恢复本局进展。</p></div> : !room ? <HomePage scenarios={catalog?.scenarios || []} connected={connected} enter={session.enter} request={request} /> : room.status === 'waiting' ? <RoomPage room={room} scenarios={catalog?.scenarios || []} connected={connected} request={request} onConfigure={() => setModal('config')} /> : screen === 'report' && room.outcome ? <ReportPage room={room} onReview={review} onLeave={() => void leave()} /> : <CourtPage key={room.code} room={room} connected={connected} request={request} onReport={() => setScreen('report')} targetEvent={targetEvent} reduceMotion={reduceMotion} voiceEnabled={voiceEnabled} onToggleVoice={() => setVoiceEnabled(value => !value)} ambienceEnabled={ambienceEnabled} onToggleAmbience={() => setAmbienceEnabled(value => !value)} can3d={supported} onOpenSettings={() => setModal('settings')} onRequestLeave={() => setModal('leave')} on3dFailed={() => setStage3dFailed(true)} />}
    </main>
    {!match && <footer className="app-footer"><span>低语代理人 <span className="footer-divider">/</span> 幕后引导 · 自主智斗</span><span>它有自己的判断，你有一句耳语。</span><span>第一幕已就绪 · v1.0</span></footer>}
    {modal === 'config' && room && catalog && <ConfigModal room={room} providers={catalog.providers} request={request} onClose={() => setModal(null)} />}
    {modal === 'settings' && <Modal title="窗口设置" onClose={() => setModal(null)}><div className="settings-options"><label><span><strong>舒适阅读</strong><small>放大交锋与汇报文字。</small></span><input type="checkbox" checked={largeText} onChange={e => setLargeText(e.target.checked)} /></label><label><span><strong>减少动态效果</strong><small>关闭灯光切换与短暂提示动画。</small></span><input type="checkbox" checked={reduceMotion} onChange={e => setReduceMotion(e.target.checked)} /></label><label><span><strong>代理人语音</strong><small>用本机中文语音按正常人类语速朗读公开发言，不发送到外部服务。</small></span><input type="checkbox" checked={voiceEnabled} onChange={e => setVoiceEnabled(e.target.checked)} /></label><label><span><strong>环境音</strong><small>本机程序化生成的短音效（筹码、翻页、封蜡、违约等）；朗读时自动压低，不启动循环底噪，不请求外部音频。</small></span><input type="checkbox" checked={ambienceEnabled} onChange={e => setAmbienceEnabled(e.target.checked)} /></label><p className="fine-print">本版本对局舞台仅提供全屏 3D 第一视角；窗口宽度小于 900px 或 WebGL 不可用时显示不可用提示。系统开启减少动态效果时，同样会自动遵循；没有中文语音时按正常阅读语速无声推进。</p></div></Modal>}
    {modal === 'rules' && <Modal title="在幕后，如何入局" onClose={() => setModal(null)} wide><div className="rules-copy"><p className="rules-lead">让 AI 自己交锋。你只需要听取汇报，偶尔给一句提醒。</p><h3>一局三幕</h3><p>每幕依次进行：私密方针 → 三次 AI 交锋 → 公开卡 → 双方 AI 回应，共十二次行动。私密阶段 30 秒，公开阶段 15 秒；双方提交后自动开始演出，到时未提交视为留白。代理人每幕私下汇报进展、判断与下一步打算。</p><h3>自动演出</h3><p>服务端仍在每个回合开始和每次行动后开启门闩，客户端在演出完成后自动确认。可随时暂停，暂停时停在门闩并显示“继续”，恢复后继续自动演出；打开抽屉会暂时暂停。双方客户端都确认后才继续，内置陪练自动确认。</p><h3>语音与节奏</h3><p>交锋中的公开发言默认由本机中文语音按正常人类语速朗读，桌面变化会等这句话说完。可在全屏顶栏或窗口设置关闭语音；没有中文语音时按正常阅读语速无声推进。两倍速会同时加快动作与朗读，“跳过演出”只展示当前这一步，未暂停时随后自动确认。</p><h3>两种声音</h3><p>私密阶段递出一张方针卡：守价、试探、施压或成交，可附 15 字备注，仅自家代理人可见。公开阶段递出一张公开卡：承诺、施压或表态，可附 10 字备注，双方可见。可以留白；AI 会自行判断，也可能拒绝建议。不同模式的草稿分别保存。</p><h3>信任与秘密</h3><p>初始信任为 75。耳语明显违反已确认的回合、报价或查验规则，扣 10 点；重复同类错误可扣 15 点。冒险、意见分歧或猜错未知信息不因其本身扣信任。有效查验建议可恢复 2 点信任。信任归零则停止代理并判负。对手秘密在赛后揭晓。</p><h3>谈判如何结算</h3><p>双方以 1～12 枚筹码谈判，一方接受对方符合己方底线的报价后形成协议。已形成的协议保持有效，新的报价只有经对方接受后才替代。三幕结束后执行最后协议。</p><p>基础仲裁分各 10。有效查验 +3；用查验事实识破不实声明，仲裁 +3、心理 +3；不成立的质疑仲裁 −2。达成协议各获 8 分，并按各自在可成交区间内的交易收益获得 0～24 分。总分高者胜，同分平局。</p><h3>公开承诺</h3><p>代理人的报价可附带价格承诺。玩家在公开阶段选择“承诺”卡且已有本方报价时，将按该价格记账；没有本方报价时只作为表态。“施压”卡生成双方可见的公开施压事件，不新增计分；“表态”只记录公开话语。违约时本方信任 −8、心理分 −3，对方心理分 +2。</p><h3>免费体验与真实模型</h3><p>本地策略代理根据规则、性格、已知信息和方针选择行动，属于免费体验模式。双人房间可在准备时分别配置真实模型，整局共 12 次 AI 行动；按席位轮转，最多一方 7 次、另一方 5 次外部调用。失败时由本地代理接管，并明确提示。断线期间阶段照常进行，重新连接会恢复已确认的进展。</p></div></Modal>}
    {modal === 'leave' && room && <Modal title={room.status === 'playing' ? '离开这场交锋？' : '返回入口？'} onClose={() => setModal(null)}><p>{room.status === 'playing' ? '离开将中止双方对局，不生成胜负结果。暂时关闭这个窗口可以在会话有效期内重新连接。' : '返回后可以重新选择议题、创建房间或加入另一场交锋。'}</p><div className="modal-actions"><button className="button-secondary" onClick={() => setModal(null)}>继续留在这里</button><button className="button-primary" disabled={busy || !connected} onClick={() => void leave()}>{busy ? '正在离开…' : '确认返回入口'}</button></div>{!connected && <button className="text-button" onClick={() => { session.forget(); setModal(null); }}>仅从本机返回入口</button>}</Modal>}
  </div>;
}
