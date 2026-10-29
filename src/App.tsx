import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import type { AiConfig, OwnAiSettings } from '../shared/types';
import { PROVIDER_PRESETS } from '../shared/providers';
import { sameModelSettings, saveModelPreferences, saveLoadoutPreferences } from './preferences';
import { Dialog, Rules } from './components/ui';
import { newConfig, type Route, type View } from './frontend';
import { useCourtSession } from './hooks/useCourtSession';
import { useWorkspaceNavigation } from './hooks/useWorkspaceNavigation';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import ConfigPage from './pages/ConfigPage';
import CourtPage from './pages/CourtPage';
import ReportPage from './pages/ReportPage';

const tabs: { view: View; label: string }[] = [
  { view: 'room', label: '房间准备' }, { view: 'config', label: 'AI 配置' },
  { view: 'court', label: '庭审实录' }, { view: 'report', label: '赛后报告' },
];

export default function App() {
  const session = useCourtSession();
  const { room, catalog, connected, connection, booting, error, setError, request } = session;
  const [config, setConfig] = useState<AiConfig>(newConfig);
  const savedConfig = useRef<AiConfig>(newConfig());
  const hydratedRoom = useRef<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const previousStatus = useRef<string | null>(null);
  const you = room?.players.find(p => p.id === room.you);
  const modelDirty = !!room && (!!config.apiKey || !room.ownAiSettings || !sameModelSettings(config, room.ownAiSettings));
  const loadoutDirty = !!you && (config.identity !== you.loadout.identity || [...config.items].sort().join(',') !== [...you.loadout.items].sort().join(','));
  const dirty = modelDirty || loadoutDirty;
  const modelChanged = !!config.apiKey || !sameModelSettings(config, savedConfig.current);
  const nav = useWorkspaceNavigation(room, booting, modelChanged, setNotice);
  const busyRef = useRef(false);
  const restoring = room?.status === 'playing' && !you?.configured;
  const darkView = nav.route.view !== 'config';
  const [arrival, setArrival] = useState(0);

  useLayoutEffect(() => {
    if (darkView) document.documentElement.dataset.courtTheme = 'dark';
    else delete document.documentElement.dataset.courtTheme;
    return () => { delete document.documentElement.dataset.courtTheme; };
  }, [darkView]);
  useEffect(() => {
    if (!arrival) return;
    const timer = window.setTimeout(() => setArrival(0), 420);
    return () => window.clearTimeout(timer);
  }, [arrival]);

  useEffect(() => {
    if (!room) { setConfig(newConfig()); savedConfig.current = newConfig(); hydratedRoom.current = null; previousStatus.current = null; return; }
    const isNewRoom = hydratedRoom.current !== room.code;
    hydratedRoom.current = room.code;
    if (!isNewRoom && dirty && room.status === 'waiting') {
      setConfig(current => ({ ...current, apiKey: '' })); return;
    }
    const me = room.players.find(p => p.id === room.you);
    setConfig(current => {
      const base = isNewRoom ? newConfig() : current;
      const equipment = room.status === 'waiting' && !room.ownAiSettings ? { identity: base.identity, items: base.items } : me?.loadout;
      const next: AiConfig = { ...base, ...room.ownAiSettings, ...equipment, apiKey: '' };
      savedConfig.current = structuredClone(next); return next;
    });
  }, [room?.code, session.restoredVersion]);

  useEffect(() => { setConfig(c => ({ ...c, apiKey: '' })); savedConfig.current.apiKey = ''; }, [session.disconnectVersion]);
  useEffect(() => {
    if (!room) return;
    const before = previousStatus.current;
    previousStatus.current = room.status;
    if (room.status === 'playing' && before === 'waiting') { nav.navigate({ view: 'court' }, false, true); }
    if (room.status === 'finished' || room.status === 'cancelled') { setConfig(c => ({ ...c, apiKey: '' })); savedConfig.current.apiKey = ''; }
  }, [room?.status]);
  useEffect(() => {
    if (!modelChanged || nav.route.view !== 'config') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [modelChanged, nav.route.view]);
  useLayoutEffect(() => {
    if (!booting) { window.scrollTo({ top: 0, behavior: 'instant' }); main.current?.focus({ preventScroll: true }); }
  }, [nav.route.view, booting]);
  useEffect(() => {
    document.title = `${tabs.find(t => t.view === nav.route.view)?.label || '双人 AI 竞技'} · AI 法庭`;
  }, [nav.route.view]);

  const updateConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => {
    const next = { ...config, [key]: value }; setConfig(next);
    if ((key === 'identity' || key === 'items') && !saveLoadoutPreferences(next)) setError('浏览器未允许保存装备偏好，本次选择仍可使用。');
  };
  const switchProvider = (provider: AiConfig['provider']) => {
    const preset = PROVIDER_PRESETS.find(p => p.id === provider)!;
    setConfig(c => ({ ...c, provider, apiKey: '', baseUrl: preset.baseUrl, model: preset.defaultModel, inputPricePerMillion: undefined, outputPricePerMillion: undefined }));
  };
  const run = async (name: string, work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(name); setError(''); setNotice('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { busyRef.current = false; setBusy(''); }
  };
  const save = async () => {
    const canonical = await request<OwnAiSettings>('ai:configure', config);
    const next = { ...config, ...canonical, apiKey: '' };
    setConfig(next); savedConfig.current = structuredClone(next);
    const stored = saveModelPreferences(canonical);
    setNotice(restoring ? '密钥已提交，等待双方连接就绪后继续庭审。' : `AI 配置已保存，本标签页重建或加入房间时会自动沿用，无需重填密钥。${stored ? '' : '浏览器未允许保存模型偏好。'}`);
    if (restoring) nav.navigate({ view: 'court' }, false, true);
  };
  const saveEquipment = async () => {
    if (loadoutDirty) await request('player:loadout', { identity: config.identity, items: config.items });
    setNotice('装备已保存。模型与密钥不受影响。');
    nav.navigate({ view: 'room' }, false, true);
  };
  const forgetRoomLocally = (expired = false) => {
    session.forget(); setConfig(newConfig()); savedConfig.current = newConfig();
    setLeaveOpen(false); nav.cancelNavigation(); setError('');
    if (expired) setNotice('房间已过期或清理，已返回首页。');
    if (expired) requestAnimationFrame(() => window.location.replace(`${window.location.pathname}#home`));
    else requestAnimationFrame(() => nav.navigate({ view: 'home' }, true, true));
  };
  const leave = async () => {
    await run('leave', async () => {
      try { await request('room:leave'); }
      catch (e) {
        if (!/(?:会话失效|重连会话失效)|房间(?:已清理|已取消|不存在|已过期)/.test((e as Error).message)) throw e;
        forgetRoomLocally(true); return;
      }
      forgetRoomLocally();
    });
  };
  const go = (route: Route) => { setError(''); setNotice(''); nav.navigate(route); };
  const link = (e: MouseEvent<HTMLAnchorElement>, route: Route) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); go(route);
  };

  return <div className={`app-shell${darkView ? ' theme-court-dark' : ''}${nav.route.view === 'court' && room?.game ? ' court-session' : ''}`}>
    <a className="skip-link" href="#workspace" onClick={e => { e.preventDefault(); main.current?.focus(); }}>跳到主要内容</a>
    <header className="topbar"><a className="brand" href={room ? '#room' : '#home'} onClick={e => link(e, { view: room ? 'room' : 'home' })}><span className="brand-seal" aria-hidden="true">衡</span><span><strong>AI 法庭</strong><small>电子斗蛐蛐</small></span></a><div className="topbar-right"><span className={`network-state ${connected ? 'online' : ''}`} role="status"><i aria-hidden="true" />{connection}</span><button className="text-button rules-button" onClick={() => setRulesOpen(true)}>庭审规则</button></div></header>
    {room && <div className="workspace-bar"><nav className="workspace-nav" aria-label="工作区页面">{tabs.map(tab => {
      const disabled = (tab.view === 'court' && !room.game) || (tab.view === 'report' && (room.status !== 'finished' || !room.game?.verdict)) || (tab.view === 'config' && room.status !== 'waiting' && !restoring);
      return disabled ? <span key={tab.view} aria-disabled="true" className="nav-unavailable">{tab.label}</span> : <a key={tab.view} href={`#${tab.view}`} aria-current={nav.route.view === tab.view ? 'page' : undefined} onClick={e => link(e, { view: tab.view })}>{tab.label}</a>;
    })}</nav><button className="text-button leave-button" disabled={!!busy} onClick={() => {
      if (room.status === 'playing' || dirty) setLeaveOpen(true); else void leave();
    }}>{room.status === 'playing' ? '退出对局' : '离开房间'}</button></div>}
    <main id="workspace" ref={main} tabIndex={-1}>
      {error && <div className="feedback error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
      {notice && <div className="feedback info" role="status"><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
      {room?.notice && nav.route.view !== 'court' && <div className="feedback warning" role="status">{room.notice}</div>}
      {!connected && room && ['playing', 'waiting'].includes(room.status) && nav.route.view !== 'court' && <div className="feedback error" role="status">连接已断开，请等待恢复或重新连接。服务器重启后需要新建房间。<button onClick={session.reconnect}>重新连接</button></div>}
      {restoring && connected && nav.route.view !== 'config' && nav.route.view !== 'court' && <div className="feedback warning recovery-notice"><span>真实模型连接尚未恢复，请重新提交原配置的密钥。双方恢复后，由当前玩家主动确认行动。</span><button className="secondary" onClick={() => go({ view: 'config' })}>重新提交密钥</button></div>}
      {booting ? <section className="panel loading-panel"><h1>正在恢复工作区…</h1><p>{connection}。恢复访客会话后将打开对应页面。</p></section> : <>
        {!room && nav.route.view === 'home' && <HomePage catalog={catalog} connected={connected} busy={!!busy} request={request} onJoin={(joined, created) => { setError(''); setNotice(joined.room.ownAiSettings ? '已自动沿用你上次保存的 AI 配置和装备，确认后即可准备。' : ''); session.acceptJoin(joined); if (created) setArrival(Date.now()); }} />}
        {room && nav.route.view === 'room' && <RoomPage room={room} catalog={catalog} connected={connected} busy={!!busy} pendingConfig={dirty} request={request} run={run} onConfigure={() => go({ view: 'config' })} onCourt={() => go({ view: 'court' })} onReport={() => go({ view: 'report' })} />}
        {room && nav.route.view === 'config' && <ConfigPage room={room} catalog={catalog} config={config} dirty={dirty} connected={connected} section={nav.route.section} onChange={updateConfig} onProvider={switchProvider} onSave={save} onSaveEquipment={saveEquipment} onEquipment={() => go({ view: 'config', section: 'equipment' })} request={request} />}
        {room?.game && nav.route.view === 'court' && <CourtPage room={room} connected={connected} request={request} catalog={catalog} eventId={nav.route.event} onReport={() => go({ view: 'report' })} onReconnect={session.reconnect} onConfigure={() => go({ view: 'config' })} onLeave={() => room.status === 'playing' ? setLeaveOpen(true) : void leave()} />}
        {room?.game?.verdict && nav.route.view === 'report' && <ReportPage room={room} onCourt={() => go({ view: 'court' })} onEvent={event => go({ view: 'court', event })} onNewMatch={() => void leave()} />}
      </>}
    </main>
    <footer className="site-footer"><span>AI 法庭 <span className="muted">/ 电子斗蛐蛐</span></span><span>发言可以离谱，证据必须靠谱。</span><span>V1.3 案件与对抗体验</span></footer>
    {!!arrival && <div className="dossier-transfer" aria-hidden="true" key={arrival}><i /><i /></div>}
    {rulesOpen && <Dialog title="庭审规则" onClose={() => setRulesOpen(false)}><Rules catalog={catalog} /></Dialog>}
    {nav.pending && <Dialog title="有尚未保存的模型配置" onClose={nav.cancelNavigation} actions={<><button className="secondary" onClick={nav.cancelNavigation}>继续编辑</button><button className="primary" onClick={() => { setConfig(c => ({ ...savedConfig.current, identity: c.identity, items: c.items, apiKey: '' })); nav.discardAndNavigate(); }}>放弃修改</button></>}><p>离开将放弃本次模型修改，身份与道具偏好仍会保留。</p></Dialog>}
    {leaveOpen && <Dialog title={room?.status === 'playing' ? '退出并终止对局？' : '放弃修改并离开房间？'} onClose={() => setLeaveOpen(false)} actions={<><button className="secondary" onClick={() => setLeaveOpen(false)}>继续留在房间</button><button className="danger-button" disabled={!!busy} onClick={() => void leave()}>{busy ? '正在退出…' : '确认退出'}</button></>}><p>{room?.status === 'playing' ? '退出会终止双方当前对局，不会生成判决。对方也需要重新创建房间。' : '未保存的配置将丢弃，当前房间将取消。'}</p></Dialog>}
  </div>;
}
