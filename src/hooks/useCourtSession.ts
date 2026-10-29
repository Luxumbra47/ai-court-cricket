import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Ack, Catalog, RoomView, Session } from '../../shared/types';
import { rememberTrial } from '../trialPreferences';

export type Joined = { session: Session; room: RoomView };
const SESSION_KEY = 'ai-court-session-v1';
const PREFERENCE_SESSION_KEY = 'ai-court-config-session-v1';
function readPreferenceToken(): string | null {
  try { const token = sessionStorage.getItem(PREFERENCE_SESSION_KEY); return token && /^[a-f0-9]{64}$/.test(token) ? token : null; }
  catch { return null; }
}
function readSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return s && typeof s.playerId === 'string' && typeof s.token === 'string' && typeof s.roomCode === 'string' ? s : null;
  } catch { return null; }
}
function persistSession(session: Session | null) {
  try { if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); else sessionStorage.removeItem(SESSION_KEY); } catch { /* Guests can play without browser storage. */ }
}

export function useCourtSession() {
  const socket = useMemo(() => io({ autoConnect: false, reconnection: true }), []);
  const sessionRef = useRef<Session | null>(readSession());
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState('正在连接服务器…');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState('');
  const [disconnectVersion, setDisconnectVersion] = useState(0);
  const [restoredVersion, setRestoredVersion] = useState(0);

  const request = useCallback(<T,>(event: string, payload: unknown = {}): Promise<T> => new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('连接已断开，请等待重连后重试。'));
    socket.timeout(20000).emit(event, payload, (err: Error | null, response: Ack<T>) => {
      if (err) return reject(new Error('服务器响应超时，请稍后重试。'));
      if (!response?.ok) return reject(new Error(response?.error || '操作未完成，请重试。'));
      resolve(response.data as T);
    });
  }), [socket]);
  const acceptJoin = useCallback((joined: Joined) => {
    sessionRef.current = joined.session; persistSession(joined.session); rememberTrial(joined.room); setRoom(joined.room);
  }, []);
  const forget = useCallback(() => { sessionRef.current = null; persistSession(null); setRoom(null); }, []);
  const reconnect = useCallback(() => { setConnection('正在重新连接…'); socket.connect(); }, [socket]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (active && !socket.connected) { setConnection('连接较慢，正在重试'); if (!readSession()) setBooting(false); }
    }, 8000);
    fetch('/api/catalog', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: Catalog) => { if (active) setCatalog(data); })
      .catch(() => { if (active) setError('无法读取案件目录，请确认服务运行后刷新页面。'); });
    const onConnect = async () => {
      setConnected(true); setConnection('已连接');
      try {
        const saved = await request<{ token: string }>('preferences:resume', { token: readPreferenceToken() });
        try { sessionStorage.setItem(PREFERENCE_SESSION_KEY, saved.token); }
        catch { if (active) setError('浏览器未允许保存会话凭据，刷新后可能需要重新填写密钥。'); }
      } catch { if (active) setError('暂时无法恢复上次配置，仍可手动配置后继续。'); }
      const session = sessionRef.current;
      if (session) {
        try { const joined = await request<Joined>('room:resume', session); if (active) { acceptJoin(joined); setRestoredVersion(v => v + 1); } }
        catch (e) { if (active) { forget(); setError((e as Error).message); } }
      }
      if (active) setBooting(false);
    };
    socket.on('connect', onConnect);
    socket.on('room:update', (next: RoomView) => { if (active && sessionRef.current?.roomCode === next.code && sessionRef.current.playerId === next.you) { rememberTrial(next); setRoom(next); } });
    socket.on('disconnect', reason => { if (active) { setConnected(false); setConnection(reason === 'io server disconnect' ? '连接已断开，请重新连接' : '连接已断开，正在重连'); setDisconnectVersion(v => v + 1); } });
    socket.on('connect_error', () => {
      if (active) { setConnected(false); setConnection('暂时无法连接，正在重试'); if (!readSession()) setBooting(false); }
    });
    socket.connect();
    return () => { active = false; clearTimeout(timer); controller.abort(); socket.removeAllListeners(); socket.disconnect(); };
  }, [socket, request, acceptJoin, forget]);
  return { connected, connection, catalog, room, booting, error, setError, request, acceptJoin, forget, reconnect, disconnectVersion, restoredVersion };
}
