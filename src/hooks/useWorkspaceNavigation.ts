import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView } from '../../shared/types';
import { availableRoute, parseRoute, routeHash, type Route } from '../frontend';

interface Pending { route: Route; delta?: number; replace?: boolean }

/** Hash history contains UI destinations only; room access is checked after session recovery. */
export function useWorkspaceNavigation(room: RoomView | null, booting: boolean, dirty: boolean, onNotice: (message: string) => void) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [pending, setPending] = useState<Pending | null>(null);
  const latest = useRef({ room, booting, dirty, onNotice, route });
  latest.current = { room, booting, dirty, onNotice, route };
  const index = useRef<number>(window.history.state?.courtIndex ?? 0);
  const reversing = useRef(false);
  const bypass = useRef(false);
  const last = useRef('');

  const apply = useCallback((next: Route, replace = false) => {
    const result = availableRoute(next, latest.current.room);
    const hash = routeHash(result.route);
    if (hash !== window.location.hash) {
      if (!replace) index.current++;
      window.history[replace ? 'replaceState' : 'pushState']({ courtIndex: index.current }, '', hash);
    }
    last.current = `${index.current}:${hash}`;
    setRoute(result.route);
    if (result.notice) latest.current.onNotice(result.notice);
  }, []);

  const navigate = useCallback((next: Route, replace = false, force = false) => {
    if (!force && latest.current.dirty && latest.current.route.view === 'config' && next.view !== 'config') {
      setPending({ route: next, replace }); return;
    }
    apply(next, replace);
  }, [apply]);

  useEffect(() => {
    window.history.replaceState({ courtIndex: index.current }, '', window.location.href);
    const onLocation = () => {
      const targetIndex = window.history.state?.courtIndex ?? index.current + 1;
      const key = `${targetIndex}:${window.location.hash}`;
      if (last.current === key) return;
      last.current = key;
      if (reversing.current) {
        if (window.location.hash === routeHash(latest.current.route)) reversing.current = false;
        return;
      }
      if (latest.current.booting) { index.current = targetIndex; setRoute(parseRoute(window.location.hash)); return; }
      const target = parseRoute(window.location.hash);
      if (!bypass.current && latest.current.dirty && latest.current.route.view === 'config' && target.view !== 'config') {
        const delta = targetIndex - index.current;
        setPending({ route: target, delta });
        if (delta) { reversing.current = true; window.history.go(-delta); }
        else window.history.replaceState({ courtIndex: index.current }, '', routeHash(latest.current.route));
        return;
      }
      bypass.current = false;
      index.current = targetIndex;
      window.history.replaceState({ courtIndex: index.current }, '', window.location.href);
      apply(target, true);
    };
    window.addEventListener('popstate', onLocation);
    window.addEventListener('hashchange', onLocation);
    return () => { window.removeEventListener('popstate', onLocation); window.removeEventListener('hashchange', onLocation); };
  }, [apply]);

  useEffect(() => {
    if (!booting) apply(latest.current.route, true);
  }, [booting, room?.code, room?.status, room?.players.find(p => p.id === room.you)?.configured, apply]);

  const discardAndNavigate = () => {
    const next = pending;
    setPending(null);
    if (!next) return;
    if (next.delta) { bypass.current = true; window.history.go(next.delta); }
    else apply(next.route, !!next.replace);
  };
  return { route, navigate, pending, cancelNavigation: () => setPending(null), discardAndNavigate };
}
