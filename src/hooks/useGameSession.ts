import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Ack, Entry, RoomView, Scenario, Session } from '../../shared/whisper';
import type { ProviderPreset } from '../../shared/providers';

const SESSION_KEY = 'whisper-agents-session-v1';
function readSession(): Session | null {
  try { const raw = sessionStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) as Session : null; } catch { return null; }
}
export function useGameSession() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<{ scenarios: Scenario[]; providers: ProviderPreset[] } | null>(null);
  const socketRef = useRef<Socket | null>(null), sessionRef = useRef<Session | null>(readSession());
  const request = useCallback(<T = void,>(event: string, payload: unknown = {}): Promise<T> => new Promise((resolve, reject) => {
    const socket = socketRef.current;
    if (!socket?.connected) { reject(new Error('连接已断开，请等待恢复后重试。')); return; }
    socket.timeout(10000).emit(event, payload, (err: Error | null, ack: Ack<T>) => {
      if (err) reject(new Error('请求暂未确认，请等待连接恢复；已送达的耳语不会重复处理。'));
      else if (!ack?.ok) reject(new Error(ack?.error || '操作未完成，请重试。'));
      else resolve(ack.data as T);
    });
  }), []);
  useEffect(() => {
    const socket = io({ autoConnect: false, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', async () => {
      setConnected(true); setError('');
      if (sessionRef.current) {
        try { const entry = await request<Entry>('session:resume', sessionRef.current); setRoom(entry.room); }
        catch (err) { setError((err as Error).message); sessionRef.current = null; setRoom(null); try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Memory session still works. */ } }
      }
      setRestoring(false);
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => { setConnected(false); setRestoring(false); setError('暂时无法连接舞台，请重试连接。'); });
    socket.on('room:update', (update: RoomView) => setRoom(update));
    socket.connect();
    const controller = new AbortController();
    fetch('/api/catalog', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setCatalog).catch(() => { if (!controller.signal.aborted) setError('议题目录暂不可用，请刷新页面重试。'); });
    return () => { controller.abort(); socket.disconnect(); socketRef.current = null; };
  }, [request]);
  const enter = (entry: Entry) => {
    sessionRef.current = entry.session; setRoom(entry.room); setError('');
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(entry.session)); } catch { setError('浏览器未允许保存会话，刷新后需要重新加入。'); }
  };
  const forget = () => {
    sessionRef.current = null; setRoom(null); setError('');
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* No persisted session. */ }
  };
  const leave = async () => { await request('room:leave'); forget(); };
  const reconnect = () => { socketRef.current?.connect(); };
  return { room, connected, restoring, error, setError, catalog, request, enter, leave, forget, reconnect };
}
