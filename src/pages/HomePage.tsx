import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Catalog, Difficulty, MatchMode } from '../../shared/types';
import { DIFFICULTIES, MATCH_MODES } from '../../shared/types';
import { recentCases, trialSettings, saveTrialSettings } from '../trialPreferences';
import { Field, fieldProps } from '../components/ui';
import CaseSelectionDialog from '../components/CaseSelectionDialog';
import CourtroomBackdrop from '../components/CourtroomBackdrop';
import { focusError, validateEntry, validateNickname, type FieldErrors } from '../frontend';
import type { Joined } from '../hooks/useCourtSession';

interface Props { catalog: Catalog | null; connected: boolean; busy: boolean; request: <T>(event: string, payload?: unknown) => Promise<T>; onJoin: (joined: Joined, created?: boolean) => void }
export default function HomePage({ catalog, connected, busy: parentBusy, request, onJoin }: Props) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [caseId, setCaseId] = useState('');
  const [matchMode, setMatchMode] = useState<MatchMode>(() => trialSettings().mode);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => trialSettings().difficulty);
  const [selection, setSelection] = useState<'auto' | 'manual'>(() => trialSettings().selection);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const submitting = useRef(false);
  const busy = saving || parentBusy;
  const filteredCatalog = catalog ? { ...catalog, cases: catalog.cases.filter(c => !c.difficulty || c.difficulty === difficulty) } : null;
  useEffect(() => { if (filteredCatalog && !filteredCatalog.cases.some(c => c.id === caseId)) setCaseId(filteredCatalog.cases[0]?.id || ''); }, [catalog, caseId, difficulty]);
  useEffect(() => { saveTrialSettings({ difficulty, mode: matchMode, selection }); }, [difficulty, matchMode, selection]);
  const selected = filteredCatalog?.cases.find(c => c.id === caseId);

  const openCaseSelection = () => {
    setServerError('');
    const next = validateNickname(nickname);
    setErrors(next);
    if (Object.keys(next).length) { focusError(next); return; }
    if (!catalog?.cases.length) { setServerError('案件目录暂不可用，请稍后重试。'); return; }
    setSelectionOpen(true);
  };

  const joinRoom = async () => {
    if (busy) return;
    setServerError('');
    const next = validateEntry(nickname, 'join', code, '');
    setErrors(next);
    if (Object.keys(next).length) { focusError(next); return; }
    setSaving(true);
    try { onJoin(await request<Joined>('room:join', { nickname: nickname.trim(), code: code.trim(), recentCaseIds: recentCases() })); }
    catch (err) { setServerError((err as Error).message); }
    finally { setSaving(false); }
  };

  const createRoom = async () => {
    if (!selected || busy || submitting.current || !connected) return;
    const next = validateNickname(nickname);
    if (Object.keys(next).length) { setErrors(next); focusError(next); return; }
    submitting.current = true;
    setSaving(true);
    setServerError('');
    try {
      const joined = await request<Joined>('room:create', { nickname: nickname.trim(), ...(selection === 'manual' ? { caseId: selected.id } : {}), mode: matchMode, difficulty, selection, recentCaseIds: recentCases() });
      setSelectionOpen(false);
      onJoin(joined, true);
    } catch (err) { setServerError((err as Error).message); }
    finally { submitting.current = false; setSaving(false); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'create') { if (selection === 'auto') void createRoom(); else openCaseSelection(); }
    else void joinRoom();
  };

  return <div className="home-scene-page">
    <CourtroomBackdrop paused={selectionOpen} />
    <div className="home-layout">
      <section className="home-intro"><span className="section-label">双人 AI 文字竞技</span><h1>让你的 AI，<br />用证据说话。</h1><p className="intro-copy">配置 AI 律师，邀请朋友加入。选择行动指挥 AI，与朋友轮流举证和反驳，由程序规则判决。</p>
        <ol className="steps"><li><span>1</span><div><strong>选择案件难度，邀请朋友</strong><p>十二份独立卷宗，自动回避近期案件。</p></div></li><li><span>2</span><div><strong>选择模型与装备</strong><p>可以免费试玩，也可以使用自己的模型。</p></div></li><li><span>3</span><div><strong>调查、交锋，再作陈词</strong><p>每人六个行动机会，每次确认才出招。</p></div></li></ol>
        <div className="intro-footnote"><span className="small-mark" aria-hidden="true">衡</span><p>玩家决定行动，AI 表达，程序裁决。<br /><span className="muted">无需注册，预设模式不产生模型费用。</span></p></div>
      </section>
      <section className="panel entry-panel"><div className="section-heading"><h2>进入法庭</h2><span className="subtle-tag">访客模式 · 2 人</span></div>
        <div className="segmented" aria-label="进入方式">{(['create', 'join'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} className={mode === value ? 'active' : ''} onClick={() => { setMode(value); setErrors({}); setServerError(''); }}>{value === 'create' ? '创建房间' : '加入房间'}</button>)}</div>
        <form onSubmit={submit} noValidate aria-label={mode === 'create' ? '创建房间' : '加入房间'}>
          <Field name="nickname" label="你的昵称" error={errors.nickname}><input {...fieldProps('nickname', errors.nickname)} value={nickname} onChange={e => { const value = e.target.value; setNickname(value); if (errors.nickname) setErrors(old => ({ ...old, nickname: validateNickname(value).nickname })); }} onBlur={() => { if (nickname) setErrors(old => ({ ...old, nickname: validateNickname(nickname).nickname })); }} placeholder="例如：披萨辩护人…" maxLength={24} autoComplete="nickname" /></Field>
          {mode === 'join' && <Field name="code" label="六位房间码" error={errors.code} hint="向房主获取房间码，包含字母和数字 2–9。"><input {...fieldProps('code', errors.code, true)} className="code-input" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} onBlur={() => { if (code || errors.code) setErrors(old => ({ ...old, code: validateEntry(nickname, 'join', code, '').code })); }} maxLength={6} placeholder="例如：AB2C3D…" spellCheck={false} autoComplete="off" /></Field>}
          {mode === 'create' && <><div className="trial-settings"><label className="field">案件难度<select aria-label="案件难度" value={difficulty} onChange={e => setDifficulty(e.target.value as Difficulty)}>{Object.entries(DIFFICULTIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="field">提示模式<select aria-label="提示模式" value={matchMode} onChange={e => setMatchMode(e.target.value as MatchMode)}>{Object.entries(MATCH_MODES).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}</select></label></div><p className="field-hint">{MATCH_MODES[matchMode].description}</p><label className="field">选案方式<select aria-label="选案方式" value={selection} onChange={e => setSelection(e.target.value as 'auto' | 'manual')}><option value="auto">自动选案 · 避开双方近期案件</option><option value="manual">手动挑选卷宗</option></select></label></>}
          {serverError && <p className="feedback error" role="alert">{serverError}</p>}
          <button className="primary full" type="submit" disabled={!connected || busy}>{saving ? '正在处理…' : mode === 'create' ? selection === 'auto' ? '自动选案并创建' : '选择案件' : '加入房间'}<span aria-hidden="true">→</span></button>
          <p className="entry-note">{connected ? (mode === 'create' ? selection === 'auto' ? '按双方近期记录自动选案，开庭前仍可更换。' : '下一步打开案件卷宗；确认后才会创建房间。' : '每位玩家独立配置自己的 AI') : '等待服务器连接后即可进入'}</p>
        </form>
      </section>
    </div>
    {selectionOpen && filteredCatalog && selected && <CaseSelectionDialog catalog={filteredCatalog} selected={selected} busy={busy} canConfirm={connected} error={serverError || (recentCases().includes(selected.id) ? '你最近玩过这个案件；仍可手动选择，线索路线会重新安排。' : '')} onSelect={setCaseId} onClose={() => { if (busy) return; setSelectionOpen(false); setServerError(''); }} onConfirm={() => void createRoom()} />}
  </div>;
}
