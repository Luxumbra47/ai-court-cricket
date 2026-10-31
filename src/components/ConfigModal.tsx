import { useState, type FormEvent } from 'react';
import type { AgentConfig, Personality, RoomView } from '../../shared/whisper';
import { PERSONALITIES } from '../../shared/whisper';
import type { ProviderPreset } from '../../shared/providers';
import Icon from './Icon';
import Modal from './Modal';

export default function ConfigModal({ room, providers, request, onClose }: { room: RoomView; providers: ProviderPreset[]; request: <T = void>(event: string, data?: unknown) => Promise<T>; onClose: () => void }) {
  const [config, setConfig] = useState<AgentConfig>({ ...room.own.config, apiKey: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const preset = providers.find(p => p.id === config.provider), secure = window.location.protocol === 'https:';
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await request('ai:configure', config); setConfig(c => ({ ...c, apiKey: '' })); onClose(); }
    catch (err) { setError((err as Error).message); setConfig(c => ({ ...c, apiKey: '' })); }
    finally { setBusy(false); }
  };
  return <Modal title="配置我的代理人" onClose={onClose}><form className="config-form" onSubmit={submit}>
    <label className="field" htmlFor="provider"><span>思考方式</span><select id="provider" value={config.provider} onChange={e => { const next = providers.find(p => p.id === e.target.value)!; setConfig(c => ({ ...c, provider: next.id, model: next.defaultModel, baseUrl: next.baseUrl, apiKey: '' })); }}>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <p className="fine-print">{preset?.description}</p>
    {config.provider !== 'mock' && <>
      {!secure && <p className="inline-error"><Icon name="lock" size={17} />真实模型需要 HTTPS 连接。本地可用 npm run dev:https 启动，也可以先用免费代理。</p>}
      <label className="field" htmlFor="model"><span>模型 ID</span><input id="model" value={config.model} maxLength={120} placeholder={preset?.modelPlaceholder || '填写控制台中可用的模型 ID'} onChange={e => setConfig(c => ({ ...c, model: e.target.value }))} required autoComplete="off" spellCheck={false} /></label>
      <label className="field" htmlFor="base-url"><span>接口地址</span><input id="base-url" type="url" value={config.baseUrl} onChange={e => setConfig(c => ({ ...c, baseUrl: e.target.value }))} required spellCheck={false} /></label>
      <label className="field" htmlFor="api-key"><span>{preset?.keyLabel || 'API Key'}</span><input id="api-key" type="password" value={config.apiKey} onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))} placeholder={room.own.config.provider === config.provider ? '已有密钥可留空复用' : '仅用于本局的模型调用'} autoComplete="off" maxLength={512} /></label>
      <p className="fine-print">密钥只保存在服务器当前房间内存中，对局结束或中止时清除，不展示给对方。开始后整局共 12 次 AI 行动；按席位轮转，最多一方 7 次、另一方 5 次模型调用，会产生服务商费用。</p>
    </>}
    <fieldset className="personality-picker"><legend>交锋风格</legend>{Object.entries(PERSONALITIES).map(([id, p]) => <label key={id} className={config.personality === id ? 'selected' : ''}><input type="radio" name="personality" value={id} checked={config.personality === id} onChange={() => setConfig(c => ({ ...c, personality: id as Personality }))} /><span><strong>{p.name}</strong><small>{p.description}</small></span></label>)}</fieldset>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="button-secondary" type="button" onClick={onClose}>取消</button><button className="button-primary" disabled={busy || config.provider !== 'mock' && !secure}>{busy ? '正在保存…' : '保存配置'}<Icon name="check" size={17} /></button></div>
  </form></Modal>;
}
