import { useEffect, useRef, useState } from 'react';
import type { ActionCommand, ActionDraft, ActionOption, ActionPreview as Preview, ActionReceipt, RoomView, Tactic } from '../../shared/types';
import { MATCH_MODES, SIDE_NAMES } from '../../shared/types';
import { situation } from '../../shared/situation';
import PreviewView from './ActionPreview';
import { Dialog } from './ui';
import { playerText } from '../../shared/presentation';
import { newActionId } from '../frontend';
import { courtState, eligibleEvidenceIds, type ActionFocus } from '../courtState';

interface Props { room: RoomView; connected: boolean; request: <T>(event: string, payload?: unknown) => Promise<T>; onFocusChange?: (focus: ActionFocus) => void }
export default function ActionPanel({ room, connected, request, onFocusChange }: Props) {
  const game = room.game!, ui = courtState(room, connected);
  const [choiceId, setChoiceId] = useState(''), [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [leadIds, setLeadIds] = useState<string[]>([]);
  const [showSuggestion, setShowSuggestion] = useState(() => { try { return localStorage.getItem('court-context-guide-v13') !== 'off'; } catch { return true; } });
  const [targetId, setTargetId] = useState(''), [tactic, setTactic] = useState<Tactic>('steady');
  const [resources, setResources] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ key: string; value: Preview } | null>(null);
  const [previewError, setPreviewError] = useState(''), [confirming, setConfirming] = useState(false), [previewRetry, setPreviewRetry] = useState(0);
  const submitting = useRef(false), pending = useRef<ActionCommand | null>(null);
  const context = useRef({ code: room.code, turnId: game.turnId, active: true });
  context.current.code = room.code; context.current.turnId = game.turnId;
  useEffect(() => { context.current.active = true; return () => { context.current.active = false; }; }, []);
  const choice = room.actionOptions.find(o => o.id === choiceId), canAct = ui.canAct && !busy && !uncertain;
  const materialIds = eligibleEvidenceIds(room, choice, targetId);
  const validLeads = !choice?.leads || leadIds.length >= (choice.minLeads ?? 0) && leadIds.length <= (choice.maxLeads ?? 0) && leadIds.every(id => choice.leads!.some(l => l.id === id));
  const draft: ActionDraft | null = choice && validLeads && evidenceIds.length >= choice.minEvidence && evidenceIds.length <= choice.maxEvidence && evidenceIds.every(id => materialIds.includes(id)) && (!choice.targetRequired || targetId) ?
    { turnId: game.turnId, optionId: choice.id, evidenceIds, ...(choice.leads ? { leadIds } : {}), targetArgumentId: choice.targetRequired ? targetId : null, itemId: choice.itemId, tactic } : null;
  const draftKey = draft ? JSON.stringify([room.code, room.mode, draft]) : '';
  const preview = previewResult?.key === draftKey ? previewResult.value : null;
  useEffect(() => {
    setPreviewResult(null); setPreviewError(''); setConfirming(false);
    if (!draft || !canAct) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void request<Preview>('game:preview_action', draft).then(value => { if (active) setPreviewResult({ key: draftKey, value }); })
        .catch(e => { if (active) setPreviewError(playerText((e as Error).message)); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  // draftKey serializes every selected field; no model request is made here.
  }, [draftKey, canAct, connected, previewRetry]);
  useEffect(() => {
    setChoiceId(''); setEvidenceIds([]); setLeadIds([]); setTargetId(''); setTactic('steady'); setResources(false); setError(''); setBusy(false); setUncertain(false);
    pending.current = null; submitting.current = false;
  }, [room.code, game.turnId]);
  useEffect(() => { onFocusChange?.({ optionId: choiceId, targetId }); }, [choiceId, targetId, game.turnId, onFocusChange]);
  useEffect(() => {
    if (room.ownAction && pending.current?.actionId === room.ownAction.actionId) {
      setUncertain(false); setBusy(false);
      if (room.ownAction.status === 'settled' || room.ownAction.status === 'aborted') { pending.current = null; submitting.current = false; }
    }
  }, [room.ownAction?.actionId, room.ownAction?.status]);
  const select = (option: ActionOption) => { setChoiceId(option.id); setEvidenceIds([]); setLeadIds([]); setTargetId(''); setTactic(option.styles[0].id); setError(''); };
  const send = async () => {
    if (submitting.current || (!pending.current && !canAct)) return;
    if (!pending.current) {
      if (!choice || evidenceIds.length < choice.minEvidence || evidenceIds.length > choice.maxEvidence || evidenceIds.some(id => !materialIds.includes(id)) || (choice.targetRequired && !targetId)) { setError('请完成本次行动的目标和材料选择。'); return; }
      if (!preview) { setError('请等待最新预览，再确认出招。'); return; }
      pending.current = { actionId: newActionId(), turnId: game.turnId, optionId: choice.id, evidenceIds: [...evidenceIds], ...(choice.leads ? { leadIds: [...leadIds] } : {}), targetArgumentId: choice.targetRequired ? targetId : null, itemId: choice.itemId, tactic, previewId: preview.previewId };
    }
    const command = pending.current, code = room.code;
    const current = () => context.current.active && context.current.code === code && context.current.turnId === command.turnId && pending.current?.actionId === command.actionId;
    submitting.current = true; setBusy(true); setError('');
    try { await request<ActionReceipt>('game:submit_action', command); if (current()) setUncertain(false); }
    catch (e) {
      if (!current()) return;
      const message = (e as Error).message, unknown = /超时|连接已断开/.test(message);
      setUncertain(unknown); setError(unknown ? '结果尚未确认。重连后会恢复，也可以安全重试原行动。' : playerText(message));
      if (!unknown) pending.current = null;
    } finally { if (context.current.active && context.current.code === code && context.current.turnId === command.turnId) { submitting.current = false; setBusy(false); } }
  };
  const allEvidence = [...room.publicEvidence, ...room.privateEvidence], chosenPrivate = room.privateEvidence.filter(e => evidenceIds.includes(e.id));
  const style = choice?.styles.find(s => s.id === tactic), target = room.events.find(e => e.id === targetId);
  const mainOptions = room.actionOptions.filter(o => o.group === 'main' && o.enabled), hasResources = room.actionOptions.some(o => o.group === 'resource' && o.enabled);
  const materials = [...evidenceIds.map(id => allEvidence.find(e => e.id === id)?.title), ...(choice?.leads ?? []).filter(l => leadIds.includes(l.id)).map(l => l.label)].filter(Boolean).join('、');
  const summary = choice ? `你将${choice.itemId ? '使用' : choice.actionType === 'closing_statement' ? '作' : ''}${choice.label}${materials ? `，使用「${materials}」` : ''}${target ? `，回应“${target.text.slice(0, 24)}…”` : ''}${choice.actionType === 'closing_statement' ? '' : `，采用${style?.label ?? '稳健论证'}`}。` : '先选择一个行动，再指定材料和战术。';
  const you = room.players.find(p => p.id === room.you)!;
  const position = situation(game.score, room.case.threshold, game.turn, you.side);
  return <section id="player-action-panel" className={`panel action-panel${ui.canAct ? ' your-turn' : ''}`} aria-label="玩家行动面板" data-testid="action-panel">
    <div className="section-heading"><h2>{ui.canAct ? '指挥你的 AI' : ui.terminal ? ui.title : '等待庭审继续'}</h2>{ui.canAct && <span className="subtle-tag">选择 → 确认 → 辩论</span>}</div>
    <p className="turn-message">{ui.canAct ? '每次确认占用一个回合。先看清材料，再出招。' : ui.message}</p>
    <div className="situation-summary" aria-label="当前局势"><strong>{MATCH_MODES[room.mode ?? 'standard'].label}</strong><span>证据强度 {position.score} / 胜诉阈值 {position.threshold} · {ui.terminal ? ui.title : `轮到${SIDE_NAMES[position.turn]}`}</span><p>{ui.terminal ? game.verdict?.explanation ?? ui.message : position.text}</p></div>
    {ui.kind === 'your_turn' && <>
      <div className="command-scroll"><fieldset disabled={!canAct} className="command-fields"><legend className="sr-only">选择本回合行动</legend>
        {showSuggestion && room.guide?.suggestion && <div className="context-suggestion"><p>{room.guide.suggestion.text}</p><button type="button" className="text-button" onClick={() => { setShowSuggestion(false); try { localStorage.setItem('court-context-guide-v13', 'off'); } catch { /* optional */ } }}>关闭建议</button></div>}
        {choice && <div className="selected-action"><strong>{choice.label}</strong><button type="button" className="text-button" onClick={() => { setChoiceId(''); setEvidenceIds([]); setTargetId(''); setResources(false); }}>更换行动</button></div>}
        {!choice && <div className="action-options">{mainOptions.slice(0, 4).map(o => <button key={o.id} type="button" className="action-choice" onClick={() => { setResources(false); select(o); }}><strong>{o.label}</strong><small>{playerText(o.description)}</small>{o.cost.includes('调查') && <small>{playerText(o.cost.replace('使用后结束本回合。', '').trim())}</small>}</button>)}
          {hasResources && <button type="button" className={`action-choice${resources ? ' selected' : ''}`} aria-expanded={resources} onClick={() => setResources(!resources)}><strong>使用特殊能力</strong><small>调查、整理思路、身份能力与道具；使用后结束本回合。</small></button>}
        </div>}
        {!choice && room.actionOptions.some(o => !o.enabled) && <details className="unavailable-actions"><summary>暂时不能使用的行动</summary>{room.actionOptions.filter(o => !o.enabled).map(o => <p key={o.id}>{o.label}：{playerText(o.reason || '当前条件不满足')}</p>)}</details>}
        {resources && <div className="resource-options">{room.actionOptions.filter(o => o.group === 'resource' && o.enabled).map(o => <button key={o.id} type="button" className="action-choice" onClick={() => { select(o); setResources(false); }}><strong>{o.label}</strong><small>{playerText(o.description)}</small></button>)}</div>}
        {choice && <div className="command-details">
          {choice.leads && <fieldset className="target-evidence"><legend>选择{choice.minLeads === choice.maxLeads ? choice.minLeads : `${choice.minLeads}～${choice.maxLeads}`}条调查线索</legend>{choice.leads.map(l => <label key={l.id} className="evidence-target"><input type="checkbox" checked={leadIds.includes(l.id)} disabled={!leadIds.includes(l.id) && leadIds.length >= choice.maxLeads!} onChange={() => setLeadIds(old => old.includes(l.id) ? old.filter(id => id !== l.id) : [...old, l.id])} /><span><strong>{l.label}</strong><small>{l.description}</small></span></label>)}</fieldset>}
          {choice.targetRequired && <label className="field">回应哪次发言<select aria-label="回应哪次发言" value={targetId} onChange={e => { setTargetId(e.target.value); setEvidenceIds([]); }}><option value="">请选择对方的一次说法</option>{choice.targetIds.map(id => <option key={id} value={id}>{room.events.find(e => e.id === id)?.text.slice(0, 80)}</option>)}</select></label>}
          {choice.minEvidence > 0 && (!choice.targetRequired || targetId) && <fieldset className="target-evidence"><legend>选择 {choice.minEvidence === choice.maxEvidence ? choice.minEvidence : `${choice.minEvidence}～${choice.maxEvidence}`} 份材料</legend>{materialIds.map(id => { const e = allEvidence.find(x => x.id === id)!, checked = evidenceIds.includes(id); return <label key={id} className={`evidence-target${checked ? ' selected' : ''}`}><input type="checkbox" checked={checked} disabled={!checked && (evidenceIds.length >= choice.maxEvidence || !!choice.evidencePairs && evidenceIds.length === 1 && !choice.evidencePairs.some(pair => pair.includes(evidenceIds[0]) && pair.includes(id)))} onChange={() => setEvidenceIds(old => checked ? old.filter(x => x !== id) : [...old, id])} /><span><strong>{e.title}</strong><small>{e.state.disclosure === 'private' ? '仅你可见 · 使用后公开' : e.state.submitted ? '双方可见 · 已出示' : choice.actionType === 'present_evidence' ? '双方可见 · 可首次出示' : '双方可见 · 尚未出示'}</small></span></label>; })}</fieldset>}
          <label className="field">战术风格{choice.styles.length === 1 ? <span className="fixed-style">{style?.label}</span> : <select aria-label="战术风格" value={tactic} onChange={e => setTactic(e.target.value as Tactic)}>{choice.styles.map(s => <option key={s.id} value={s.id} disabled={!s.enabled}>{s.label}{s.enabled ? '' : ` · ${playerText(s.reason || '当前不可用')}`}</option>)}</select>}</label>
          <div className="command-preview"><p>{playerText(style?.description ?? '')}</p>{preview ? <PreviewView preview={preview} /> : draft && <p role="status">{previewError || '正在核对本次行动…'}{previewError && <button className="text-button" onClick={() => setPreviewRetry(n => n + 1)}>重新获取预览</button>}</p>}</div>
        </div>}
      </fieldset></div>
      {!!chosenPrivate.length && <p className="private-disclosure confirmation-disclosure">本次会公开「{chosenPrivate.map(e => e.title).join('、')}」，论证失败也不会收回。</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="command-confirm"><span>{uncertain ? '重试使用原来的行动，不会重复出招。' : summary}</span><button className="primary" disabled={busy || !connected || (!uncertain && (!canAct || !preview))} onClick={() => uncertain ? void send() : setConfirming(true)}>{busy ? '正在提交…' : uncertain ? '重试原行动' : '查看确认摘要'}</button></div>
      {confirming && preview && canAct && <Dialog title="确认本次出招" onClose={() => setConfirming(false)} actions={<><button className="secondary" onClick={() => setConfirming(false)}>返回修改</button><button className="primary" onClick={() => { setConfirming(false); void send(); }}>确认出招</button></>}><p>{summary}</p><PreviewView preview={preview} /><p className="field-hint">确认后才会调用你的 AI 生成发言，并结算本次行动。</p></Dialog>}
    </>}
  </section>;
}
