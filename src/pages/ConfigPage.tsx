import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiConfig, Catalog, RoomView } from '../../shared/types';
import { PERSONALITIES, SIDE_NAMES, STRATEGIES } from '../../shared/types';
import { PROVIDER_PRESETS } from '../../shared/providers';
import { normalizedEndpoint } from '../preferences';
import { Field, fieldProps } from '../components/ui';
import { focusError, PROVIDERS, validateConfig, type FieldErrors } from '../frontend';

interface Props { room: RoomView; catalog: Catalog | null; config: AiConfig; dirty: boolean; connected: boolean; section?: string; onChange: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void; onProvider: (provider: AiConfig['provider']) => void; onSave: () => Promise<void>; onSaveEquipment: () => Promise<void>; onEquipment: () => void; request: <T>(event: string, payload?: unknown) => Promise<T> }
export default function ConfigPage({ room, catalog, config, dirty, connected, section, onChange, onProvider, onSave, onSaveEquipment, onEquipment, request }: Props) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const [testedSignature, setTestedSignature] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const locked = room.status === 'playing';
  const you = room.players.find(p => p.id === room.you)!;
  const real = config.provider !== 'mock';
  const insecure = real && window.location.protocol !== 'https:';
  const preset = PROVIDER_PRESETS.find(p => p.id === config.provider)!;
  const canReuseKey = you.configured && room.ownAiSettings?.provider === config.provider && normalizedEndpoint(room.ownAiSettings.baseUrl) === normalizedEndpoint(config.baseUrl);
  // Test identity excludes the secret. Changing any connection input resets the status below.
  useEffect(() => { setTestStatus(''); setTestedSignature(null); }, [config.provider, config.baseUrl, config.model, config.apiKey]);
  useEffect(() => { if (section === 'equipment') document.getElementById('equipment')?.scrollIntoView({ block: 'start' }); }, [section]);
  const validate = () => { const next = validateConfig(config, !insecure, canReuseKey); setErrors(next); if (Object.keys(next).length) focusError(next); return !Object.keys(next).length; };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busyRef.current) return; setServerError('');
    if (!validate()) return;
    busyRef.current = true; setBusy('save');
    try { await onSave(); }
    catch (err) { setServerError((err as Error).message); requestAnimationFrame(() => errorRef.current?.focus()); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const test = async () => {
    if (busyRef.current) return; setServerError(''); if (!validate()) return; busyRef.current = true; setBusy('test'); setTestStatus('');
    try { const result = await request<{ message: string }>('ai:test', config); setTestStatus(result.message); setTestedSignature(config.model); }
    catch (err) { setServerError((err as Error).message); requestAnimationFrame(() => errorRef.current?.focus()); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const saveEquipment = async () => {
    if (busyRef.current) return; busyRef.current = true; setBusy('equipment'); setServerError('');
    try { await onSaveEquipment(); }
    catch (err) { setServerError((err as Error).message); requestAnimationFrame(() => errorRef.current?.focus()); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const forgetSaved = async () => {
    if (busyRef.current) return; busyRef.current = true; setBusy('forget'); setServerError('');
    try { await request('preferences:forget'); setTestStatus('已清除自动沿用；当前房间的配置仍可使用。再次保存 AI 配置后会重新记住。'); setTestedSignature(null); }
    catch (err) { setServerError((err as Error).message); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const blur = (name: keyof AiConfig) => { if (errors[name]) setErrors(old => ({ ...old, [name]: validateConfig(config, !insecure, canReuseKey)[name] })); };
  return <>
    <div className="page-heading"><div><span className="section-label">{SIDE_NAMES[you.side]}配置</span><h1>{locked ? '恢复你的模型连接' : '配置你的 AI 律师'}</h1><p className="muted">{locked ? '模型、风格和装备已锁定，只需重新填写原配置的密钥。' : '保存一次，本标签页重建或加入房间时自动沿用模型、密钥、风格和已保存的装备。'}</p></div><span className={`status-tag ${dirty ? 'warning' : ''}`}>{dirty ? '有未提交的配置' : you.configured ? '配置已保存' : '尚未提交'}</span></div>
    <form className="config-layout" onSubmit={submit} noValidate aria-label="AI 配置">
      <div className="stack config-sections"><section className="panel"><div className="section-heading"><h2>模型连接</h2><span className="muted">双方使用各自的配置</span></div>
        <Field name="provider" label="国内 AI 服务商"><select {...fieldProps('provider')} value={config.provider} disabled={locked || !!busy} onChange={e => { onProvider(e.target.value as AiConfig['provider']); setErrors({}); setServerError(''); }}>{PROVIDER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <div className="provider-info"><strong>{preset.name}</strong><p>{preset.description}</p>{preset.documentationUrl && <a href={preset.documentationUrl} target="_blank" rel="noreferrer">查看厂商接入说明 ↗</a>}</div>
        {!real ? <p className="callout">玩家确认行动后，预设表达器生成该指令的固定台词，不调用实时大模型，不产生 API 费用。</p> : <>
          {insecure && <div className="feedback warning"><strong>HTTP 页面可填写 Key，但不会传输真实密钥。</strong><p>当前输入只暂存在此页面内存中；切到 HTTPS 后需重新填写，才能测试或保存。本机请使用 <code>npm run dev:https</code> 并打开 <a href="https://localhost:5173">HTTPS 开发地址</a>；部署时请使用可信 HTTPS 站点。</p></div>}
          <details className="settings-details"><summary>API 地址（高级设置）</summary><Field name="baseUrl" label="API Base URL" error={errors.baseUrl} hint="已使用厂商官方地址，仅支持该服务商已核实的官方端点。"><input {...fieldProps('baseUrl', errors.baseUrl, true)} type="url" value={config.baseUrl} disabled={locked || !!busy} onChange={e => onChange('baseUrl', e.target.value)} onBlur={() => blur('baseUrl')} autoComplete="off" spellCheck={false} /></Field></details>
          <Field name="apiKey" label={preset.keyLabel || 'API Key'} error={errors.apiKey} hint={insecure ? '仅暂存于此页面内存，不会保存或发送。切换到 HTTPS 后需重新输入。' : canReuseKey ? '服务器已有你的密钥，留空即可；本标签页重建房间也会自动沿用。' : '保存后由服务器临时记住，本标签页重建房间无需重填，输入框会清空。'}><input {...fieldProps('apiKey', errors.apiKey, true)} type="password" value={config.apiKey} disabled={!!busy} onChange={e => onChange('apiKey', e.target.value)} onBlur={() => blur('apiKey')} placeholder={insecure ? '可以填写；切到 HTTPS 后请重新输入' : canReuseKey ? '已保存密钥，留空即可复用' : `填写你的 ${preset.keyLabel || 'API Key'}…`} autoComplete="off" spellCheck={false} maxLength={512} /></Field>{preset.keyHelp && <p className="field-hint">{preset.keyHelp}</p>}
        </>}
        <Field name="model" label="模型 ID" error={errors.model} hint={real ? `按服务商控制台填写，可用性通过连接测试确认。${preset.modelExamples.length ? `参考：${preset.modelExamples.join('、')}` : ''}` : '预设模式的公开模型标签，可自行命名。'}><input {...fieldProps('model', errors.model, true)} value={config.model} disabled={locked || !!busy} onChange={e => onChange('model', e.target.value)} onBlur={() => blur('model')} placeholder={preset.modelPlaceholder || '填写模型 ID…'} maxLength={120} autoComplete="off" spellCheck={false} /></Field>
        {real && <details className="settings-details"><summary>费用估算设置（可选）</summary><p className="muted">人民币 / 百万 Token。不填单价或未报告用量时，费用显示未知，以服务商账单为准。</p><div className="two-columns">{(['inputPricePerMillion', 'outputPricePerMillion'] as const).map(name => <Field key={name} name={name} label={name === 'inputPricePerMillion' ? '输入 Token 单价' : '输出 Token 单价'} error={errors[name]}><input {...fieldProps(name, errors[name])} type="number" min="0" max="10000" step="0.01" value={config[name] ?? ''} disabled={locked || !!busy} onChange={e => onChange(name, e.target.value === '' ? undefined : e.target.valueAsNumber)} placeholder="未配置…" /></Field>)}</div></details>}
        <div className="test-row"><button className="secondary" type="button" disabled={!connected || !!busy || insecure} onClick={() => void test()}>{busy === 'test' ? '正在测试…' : '测试连接'}</button><p role="status" className={testedSignature ? 'success-text' : 'muted'}>{testStatus || (real ? '测试会产生一次服务商调用。' : '预设模式无需外部连接。')}</p></div>
      </section>
      <section className="panel"><h2>辩论风格</h2><div className="two-columns"><Field name="personality" label="AI 性格"><select {...fieldProps('personality')} value={config.personality} disabled={locked || !!busy} onChange={e => onChange('personality', e.target.value as AiConfig['personality'])}>{Object.entries(PERSONALITIES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field><Field name="strategy" label="默认策略"><select {...fieldProps('strategy')} value={config.strategy} disabled={locked || !!busy} onChange={e => onChange('strategy', e.target.value as AiConfig['strategy'])}>{Object.entries(STRATEGIES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field></div><p className="muted">性格与策略只改变行动偏好，所有模型使用同一套判决规则。</p></section>
      <section className="panel" id="equipment"><h2>身份与道具</h2><fieldset disabled={locked || !!busy}><legend>选择身份</legend><div className="identity-options">{catalog?.identities.map(identity => <label key={identity.id} className={`option-card ${config.identity === identity.id ? 'selected' : ''}`}><input type="radio" name="identity" value={identity.id} checked={config.identity === identity.id} onChange={() => onChange('identity', identity.id)} /><span><strong>{identity.name}</strong><small>{identity.description}</small></span></label>)}</div></fieldset>
        <fieldset disabled={locked || !!busy}><legend>携带道具 <span className="muted">已选 {config.items.length} / 3，每种每局一次</span></legend><div className="item-options">{catalog?.items.map(item => { const checked = config.items.includes(item.id); return <label key={item.id} className={`option-card ${checked ? 'selected' : ''} ${!checked && config.items.length >= 3 ? 'unavailable' : ''}`}><input type="checkbox" name={`item-${item.id}`} checked={checked} disabled={!checked && config.items.length >= 3} onChange={() => onChange('items', checked ? config.items.filter(id => id !== item.id) : [...config.items, item.id])} /><span><strong>{item.name}</strong><small>{item.description}</small></span></label>; })}</div></fieldset>
        <p className="field-hint">选择自动记忆；点击下方按钮后应用到当前房间，不影响已保存的模型和密钥。</p>{!locked && <button className="primary full equipment-save" type="button" disabled={!connected || !!busy} onClick={() => void saveEquipment()}>{busy === 'equipment' ? '正在保存装备…' : '保存装备，返回房间'}<span aria-hidden="true">→</span></button>}
      </section></div>
      <aside className="panel config-summary"><span className="section-label">提交前确认</span><h2>你的出庭配置</h2><dl className="summary-list"><div><dt>服务商</dt><dd>{PROVIDERS[config.provider]}</dd></div><div><dt>模型</dt><dd>{config.model || '尚未填写'}</dd></div><div><dt>风格</dt><dd>{PERSONALITIES[config.personality]} / {STRATEGIES[config.strategy]}</dd></div><div><dt>身份</dt><dd>{catalog?.identities.find(i => i.id === config.identity)?.name || '正在读取…'}</dd></div><div><dt>道具</dt><dd>{config.items.length ? catalog?.items.filter(i => config.items.includes(i.id)).map(i => i.name).join('、') : '未携带'}</dd></div></dl>
        <p className="callout">{real ? '真实调用由服务器代理，费用由你的服务商账户承担。请确认你信任此游戏服务器。' : '预设台词试玩：无需 API Key，外部调用与费用均为零。'}</p>
        {serverError && <div ref={errorRef} tabIndex={-1} className="feedback error" role="alert">{serverError}<p>草稿已保留，请检查配置后重新提交。</p></div>}
        <button className="primary full" type="submit" disabled={!connected || !!busy || insecure}>{busy === 'save' ? '正在保存…' : locked ? '提交密钥并返回庭审' : '保存 AI 配置'}<span aria-hidden="true">✓</span></button>
        {!locked && <button className="secondary full equipment-next" type="button" disabled={!!busy} onClick={onEquipment}>下一步：身份与道具<span aria-hidden="true">→</span></button>}
        <p className="field-hint">{locked ? '仅恢复原配置的连接，不更换模型或装备。' : '同一标签页刷新、重连和重建房间会恢复已保存配置；双方仍需手动准备。'}</p>
        <details className="settings-details"><summary>自动沿用与密钥使用说明</summary><p>密钥只通过你的 HTTPS 私有连接提交，临时保留在服务器内存，不写入数据库、网址、浏览器存储、对局记录或普通日志。对手无法读取。</p><p>本标签页保存独立的配置会话凭据，不保存 API Key。房间结束后可继续沿用；连续 12 小时未使用、关闭标签页或服务器重启后，需要重新填写密钥。服务商、模型及装备偏好仍会保留。</p><button className="secondary" type="button" disabled={!connected || !!busy} onClick={() => void forgetSaved()}>{busy === 'forget' ? '正在清除…' : '清除自动沿用'}</button><p className="field-hint">清除后，当前房间仍可使用已提交的配置；下个房间不再自动提交。再次保存 AI 配置会重新记住。</p></details>
      </aside>
    </form>
  </>;
}
