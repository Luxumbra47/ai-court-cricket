import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomView } from '../../shared/whisper';
import { actionUnits, rebuildTable } from '../../shared/stage';
import { useSpeech } from './useSpeech';

export function useStagePlayback(room: RoomView, connected: boolean, reduceMotion: boolean, request: <T = void>(event: string, data?: unknown) => Promise<T>, voiceEnabled = false, drawerOpen = false) {
  const units = useMemo(() => actionUnits(room.events), [room.events]);
  const speech = useSpeech(voiceEnabled, room.code);
  // Already received actions are restored as objective state, never replayed on mount.
  const [played, setPlayed] = useState(units.length), [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true), [paused, setPaused] = useState(false);
  const [review, setReview] = useState<string | null>(null), [speed, setSpeed] = useState(1);
  const [systemReduce, setSystemReduce] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState('');
  const spokenFor = useRef<string | null>(null), acknowledged = useRef(new Set<string>());
  const reduced = reduceMotion || systemReduce;
  const active = units[played];
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduce(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!active) return;
    if (reduced) { speech.stop(); setStep(3); return; }
    // Step 1 is the spoken line. Step 3 rests until auto-confirm or a manual "继续".
    if (step === 1) {
      if (spokenFor.current !== active.id) {
        spokenFor.current = active.id;
        void speech.speak(active.speech, active.side, speed).then(() => setStep(current => current === 1 ? 2 : current));
      }
      return;
    }
    if (step >= 3) return;
    const duration = [240, 0, active.kind === 'challenge' || active.kind === 'accept' || active.kind === 'verify' ? 850 : 550, 0][step];
    const timer = window.setTimeout(() => setStep(current => current + 1), duration / speed);
    return () => window.clearTimeout(timer);
  }, [active?.id, step, speed, reduced, units.length, speech.speak, speech.stop]);
  useEffect(() => {
    const hush = () => { if (document.hidden) speech.stop(); };
    document.addEventListener('visibilitychange', hush);
    return () => document.removeEventListener('visibilitychange', hush);
  }, [speech.stop]);
  const segment = room.playback;
  const segmentUnits = segment ? units.filter(unit => unit.segmentId === segment.id) : [];
  const expected = room.phase === 'exchange' ? 3 : room.phase === 'response' ? 1 : 0;
  const counted = segmentUnits.length;
  const start = !!segment?.waiting && segment.lastActionId === null;
  const playingNow = !!active && step < 3 && !!segment?.waiting;
  const viewed = !!active && step >= 3 && !!segment && segment.lastActionId === active.id;
  const resumed = !!segment?.waiting && !active && segment.lastActionId !== null;
  const last = expected > 0 && counted >= expected;
  const held = paused || drawerOpen;
  const gateKey = segment ? `${segment.id}:${segment.lastActionId ?? 'start'}` : '';
  const acknowledgedNow = !!gateKey && acknowledged.current.has(gateKey);
  const canAdvance = !!segment?.waiting && !segment.completed && connected && !submitting && !review && !acknowledgedNow && (start || viewed || resumed);
  const stateLabel = held && canAdvance
    ? '继续'
    : start
      ? room.phase === 'response' ? '开始回应' : '开始本回合交锋'
      : last
        ? room.phase === 'response' ? (room.act >= 3 ? '查看赛后结果' : '进入下一幕') : '进入公开低语'
        : '继续下一步';
  const advance = async () => {
    if (!segment?.waiting || segment.completed || submitting || !connected || review) return;
    if (!(start || viewed || resumed)) return;
    const actionId = segment.lastActionId;
    const key = `${segment.id}:${actionId ?? 'start'}`;
    if (acknowledged.current.has(key)) return;
    setSubmitting(true); setError('');
    try {
      const result = await request<{ accepted: boolean }>('game:playback-complete', { segmentId: segment.id, lastActionId: actionId });
      if (!result?.accepted) { setError('这一步已经被推进，请查看最新进展。'); return; }
      acknowledged.current.add(key);
      if (actionId !== null) { setPlayed(n => Math.min(n + 1, units.length)); setStep(0); }
    } catch (err) { setError((err as Error).message); }
    finally { setSubmitting(false); }
  };
  // 自动演出：门闩就绪后稍作停顿再确认；暂停、回看和抽屉都会拦住它。
  const advanceRef = useRef(advance); advanceRef.current = advance;
  useEffect(() => {
    if (!auto || held || review || !canAdvance) return;
    const timer = window.setTimeout(() => { void advanceRef.current(); }, 800);
    return () => window.clearTimeout(timer);
  }, [auto, held, review, canAdvance, gateKey, units.length]);
  const skip = () => {
    if (review) { setReview(null); return; }
    if (active && step < 3) { speech.stop(); setStep(3); }
  };
  const selected = review ? units.find(unit => unit.id === review) : active ?? units[played - 1];
  const visibleCount = review ? units.findIndex(unit => unit.id === review) + 1 : played + (active && step >= 2 ? 1 : 0);
  const table = useMemo(() => !review && !active ? rebuildTable(room.events) : visibleCount > 0 ? rebuildTable(room.events, units[visibleCount - 1]?.id) : rebuildTable([]), [room.events, visibleCount, units, review, active]);
  const waitingPeer = !!segment?.waiting && segment.completed && !segment.peerCompleted;
  const peerDone = !!segment?.waiting && segment.completed && segment.peerCompleted;
  const advancing = acknowledgedNow && !segment?.completed;
  const gate = {
    visible: !!segment?.waiting && !review,
    ready: canAdvance,
    start, last, stateLabel, submitting, error, waitingPeer, peerDone, advancing,
    auto, paused, suspended: drawerOpen, held,
    title: start ? advancing ? '正在推进' : held ? '自动演出已暂停' : '本回合等待开始'
      : held ? '自动演出已暂停'
        : playingNow ? '这一步正在演出' : waitingPeer ? '等待对方继续' : peerDone ? '正在推进' : advancing ? '正在推进' : last ? '本回合最后一步已完成' : '本步已完成',
    hint: start ? advancing ? '已确认，等待代理人开始本轮交锋。' : held ? '自动演出已暂停。点击继续开始本轮交锋，或恢复演出。' : '双方已就绪。片刻后将自动开始本轮交锋。'
      : playingNow ? held ? '演出已暂停，这一步播放结束后会停在门闩。' : '朗读与桌面核对完成后会自动继续。'
      : held ? drawerOpen ? '抽屉打开时自动演出暂停；关闭抽屉后恢复。' : '自动演出已暂停。点击继续手动推进，或恢复演出。'
      : waitingPeer ? '你已继续，等待另一位玩家确认。'
      : peerDone ? '双方已确认，代理人的下一步即将出现。'
      : advancing ? '已确认，等待代理人下一步。'
      : `本回合第 ${Math.min(counted, expected)} / ${expected} 步已完成。${held ? '点击继续推进。' : '片刻后将自动继续。'}`,
  };
  return { units, table, selected, active, step, review, setReview, speed, setSpeed, reduced, skip, played, voice: speech, advance, gate, auto, paused, togglePause: () => setPaused(value => !value) };
}
