import { useEffect, useRef, useState } from 'react';
import type { Channel, PublicCard, RoomView, Stance } from '../../shared/whisper';
import { AGENT_NAMES, PUBLIC_CARDS, STANCES, countCharacters } from '../../shared/whisper';
import Icon from './Icon';

export default function WhisperComposer({ room, connected, request }: { room: RoomView; connected: boolean; request: <T = void>(event: string, data?: unknown) => Promise<T> }) {
  const [channel, setChannel] = useState<Channel>('private');
  const [drafts, setDrafts] = useState<Record<Channel, string>>({ private: '', public: '' });
  const [stance, setStance] = useState<Stance | null>(null), [publicCard, setPublicCard] = useState<PublicCard | null>(null);
  const [sending, setSending] = useState(false), [error, setError] = useState(''), [delivered, setDelivered] = useState('');
  const lock = useRef(false);
  const storageKey = `whisper-drafts:${room.code}:${room.you}`;
  useEffect(() => {
    try { const saved = sessionStorage.getItem(storageKey); if (saved) { const parsed = JSON.parse(saved); setDrafts({ private: typeof parsed.private === 'string' ? parsed.private : '', public: typeof parsed.public === 'string' ? parsed.public : '' }); } } catch { /* Drafts remain in memory. */ }
  }, [storageKey]);
  useEffect(() => { if (room.phase === 'public') setChannel('public'); if (room.phase === 'whisper') setChannel('private'); setStance(null); setPublicCard(null); setError(''); setDelivered(''); }, [room.phase, room.act]);
  const limit = channel === 'private' ? 15 : 10, text = drafts[channel], count = countCharacters(text);
  const active = room.status === 'playing' && room.phase === (channel === 'private' ? 'whisper' : 'public');
  const submitted = room.submitted[channel];
  const canSend = active && !submitted && !sending && connected;
  const card = channel === 'private' ? (stance ? STANCES[stance] : null) : (publicCard ? PUBLIC_CARDS[publicCard] : null);
  const ready = channel === 'private' ? !!stance || !!text.trim() : !!publicCard;
  const ownOffer = room.offer?.side === room.you ? room.offer : null;
  const update = (value: string, mode = channel) => setDrafts(current => {
    const next = { ...current, [mode]: value };
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Optional persistence. */ }
    return next;
  });
  const send = async (skip = false) => {
    if (!canSend || lock.current || !skip && (!ready || count > limit)) return;
    lock.current = true; setSending(true); setError('');
    const sentChannel = channel, sentStance = skip ? null : stance, sentCard = skip ? null : publicCard;
    try {
      await request('game:whisper', {
        channel: sentChannel, act: room.act, text: skip ? '' : text.trim(),
        ...(sentChannel === 'private' && sentStance ? { stance: sentStance } : {}),
        ...(sentChannel === 'public' && sentCard ? { publicCard: sentCard } : {}),
      });
      update('', sentChannel); setStance(null); setPublicCard(null);
      setDelivered(skip ? '本次留白，交给代理人判断。'
        : sentChannel === 'private' ? sentStance ? `「${STANCES[sentStance].name}」方针已送达${AGENT_NAMES[room.you]}。` : `耳语已送达${AGENT_NAMES[room.you]}。`
        : sentCard ? `公开${PUBLIC_CARDS[sentCard].name}已送达双方。` : '公开低语已送达双方。');
    } catch (err) { setError((err as Error).message); }
    finally { lock.current = false; setSending(false); }
  };
  const next = room.status !== 'playing' ? '本局已结束，耳语窗口已关闭。' : submitted ? '本次已提交，等待阶段继续。' : channel === 'public' ? '本幕交锋结束后开放。' : room.act < 3 ? `第 ${room.act + 1} 幕开始时再次开放。` : '本局没有下一次私密耳语。';
  return <section className={`composer composer-${channel}${delivered ? ' is-delivered' : ''}`} aria-label="耳语窗口">
    <div className="composer-topbar"><div className="composer-modes" aria-label="耳语发送范围">{(['private', 'public'] as const).map(mode => <button key={mode} aria-pressed={channel === mode} className={channel === mode ? 'selected' : ''} onClick={() => { setChannel(mode); setError(''); }}><Icon name={mode === 'private' ? 'lock' : 'public'} size={16} />{mode === 'private' ? '私密耳语' : '公开低语'}</button>)}</div><span className="composer-audience">{channel === 'private' ? `仅${AGENT_NAMES[room.you]}可见` : '双方可见'}</span></div>
    <div className="composer-cards" role="group" aria-label={channel === 'private' ? '本幕私密方针' : '公开卡'}>
      {channel === 'private'
        ? (Object.keys(STANCES) as Stance[]).map(key => <button key={key} aria-pressed={stance === key} className={stance === key ? 'selected' : ''} onClick={() => setStance(stance === key ? null : key)} disabled={submitted || room.status !== 'playing'}>{STANCES[key].name}</button>)
        : (Object.keys(PUBLIC_CARDS) as PublicCard[]).map(key => <button key={key} aria-pressed={publicCard === key} className={publicCard === key ? 'selected' : ''} onClick={() => setPublicCard(publicCard === key ? null : key)} disabled={submitted || room.status !== 'playing'}>{PUBLIC_CARDS[key].name}</button>)}
    </div>
    <p className="composer-card-note" aria-live="polite">{!card ? (channel === 'private' ? '可选一张方针卡，备注可留白。' : '选择一张公开卡，备注可留白。') : card.description}{channel === 'public' && publicCard === 'promise' && (ownOffer ? ` 将绑定本方当前报价 ${ownOffer.price} 枚。` : ' 当前没有本方报价，本次只作为公开表态。')}</p>
    <label className="sr-only" htmlFor="whisper-input">{channel === 'private' ? '私密备注' : '公开备注'}</label>
    <textarea id="whisper-input" value={text} onChange={e => update(e.target.value)} placeholder={channel === 'private' ? '可选备注，15 字内。' : '可选备注，10 字内。'} rows={2} maxLength={120} aria-describedby="whisper-count whisper-availability" aria-invalid={count > limit || undefined} readOnly={submitted || room.status !== 'playing'} />
    <div className="composer-bottom"><span id="whisper-count" className={count > limit ? 'error-text' : 'muted'}>{count} / {limit} 字</span><p className="composer-availability" id="whisper-availability" role="status">{delivered || (active && !submitted ? (channel === 'private' ? '也可直接留白，让它自行判断。' : '也可直接留白，不发表公开卡。') : next)}</p></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="composer-actions"><button className="button-secondary" onClick={() => void send(true)} disabled={!canSend}>{submitted ? '已提交' : '本次留白'}</button><button className="button-primary" onClick={() => void send()} disabled={!canSend || !ready || count > limit}>{sending ? '正在送达' : channel === 'private' ? '递出方针' : '公开发言'}<Icon name="arrow" size={17} /></button></div>
  </section>;
}
