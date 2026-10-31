import { useState, type FormEvent } from 'react';
import type { Entry, Scenario } from '../../shared/whisper';
import Theatre from '../components/Theatre';
import Icon from '../components/Icon';

export default function HomePage({ scenarios, connected, enter, request }: { scenarios: Scenario[]; connected: boolean; enter: (entry: Entry) => void; request: <T = void>(event: string, input?: unknown) => Promise<T> }) {
  const [mode, setMode] = useState<'create' | 'join'>('create'), [nickname, setNickname] = useState(''), [code, setCode] = useState('');
  const [scenarioId, setScenarioId] = useState('last-battery'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [invalidName, setInvalidName] = useState(false);
  const selected = scenarios.find(s => s.id === scenarioId);
  const submit = async (practice = false) => {
    if (busy || !connected) return;
    setError('');
    if (!nickname.trim() && !practice) { setInvalidName(true); setError('请先填写你的昵称。'); document.getElementById('nickname')?.focus(); return; }
    if (mode === 'join' && !practice && !/^[A-Z2-9]{6}$/.test(code)) { setError('请输入有效的六位房间码。'); document.getElementById('room-code')?.focus(); return; }
    setBusy(true);
    try { enter(await request<Entry>(mode === 'join' && !practice ? 'room:join' : 'room:create', mode === 'join' && !practice ? { nickname: nickname.trim(), code } : { nickname: nickname.trim() || '幕后访客', scenarioId, practice })); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="home-page">
    <section className="home-story">
      <div className="home-annotation"><span className="small-rule" />双人 · AI 自主智斗</div>
      <h1>一句低语，<br />余下交给它。</h1>
      <p className="home-description">它们在灯光下试探、交锋、作出决断。<br />你坐在幕后，只给自己的代理人一句提醒。</p>
      <div className="home-stage"><Theatre empty /><span className="home-stage-caption">舞台已经准备好，等待两位代理人。</span></div>
      <div className="home-principles"><div><strong>三幕交锋</strong><span>让它自己谋划</span></div><div><strong>十五字耳语</strong><span>影响，由它判断</span></div><div><strong>私密汇报</strong><span>听它如何看局势</span></div></div>
    </section>
    <section className="entry-panel">
      <div className="entry-heading"><h2>留一个幕后席位</h2><p>选择你的代理人，与另一位玩家入局。</p></div>
      <div className="entry-modes" aria-label="进入方式">{(['create', 'join'] as const).map(value => <button key={value} className={mode === value ? 'selected' : ''} aria-pressed={mode === value} onClick={() => { setMode(value); setError(''); }}>{value === 'create' ? '创建房间' : '加入房间'}</button>)}</div>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void submit(); }}>
        <label className="field" htmlFor="nickname"><span>你的昵称</span><input id="nickname" autoComplete="nickname" maxLength={24} placeholder="在幕后，该怎么称呼你？" value={nickname} aria-invalid={invalidName || undefined} aria-describedby={error ? 'entry-error' : undefined} onChange={e => { setNickname(e.target.value); setInvalidName(false); }} /></label>
        {mode === 'create' ? <>
          <label className="field" htmlFor="scenario"><span>本局议题</span><select id="scenario" value={scenarioId} onChange={e => setScenarioId(e.target.value)} disabled={!scenarios.length}>{scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
          <div className="scenario-teaser"><span>{selected?.kind || '正在载入议题'}</span><p>{selected ? `${selected.introduction.split('。').slice(0, 2).join('。')}。` : '连接后即可选择本局的交锋议题。'}</p></div>
        </> : <label className="field" htmlFor="room-code"><span>六位房间码</span><input id="room-code" className="room-code-input" autoComplete="off" spellCheck={false} placeholder="例如：AX7K2M" value={code} maxLength={6} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))} /></label>}
        {error && <p className="inline-error" role="alert" id="entry-error">{error}</p>}
        <button className="button-primary full" disabled={busy || !connected || !scenarios.length}>{busy ? '正在安排席位…' : mode === 'create' ? '创建双人房间' : '加入这场交锋'}<Icon name="arrow" size={18} /></button>
      </form>
      <div className="entry-practice"><span>想先看看它们如何交锋？</span><button className="text-button" onClick={() => void submit(true)} disabled={busy || !connected || !scenarios.length}>独自体验一局<Icon name="chevron" size={16} /></button><p>本地策略代理陪练，无需密钥，不产生模型费用。</p></div>
    </section>
  </div>;
}
