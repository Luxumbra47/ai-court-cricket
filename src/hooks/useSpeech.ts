import { useCallback, useEffect, useRef, useState } from 'react';
import type { Side } from '../../shared/whisper';
import { estimateSpeechMs, sanitizeSpeech } from '../../shared/stage';

type ServerState = 'unknown' | 'ready' | 'unavailable';
interface VoiceProfile { voice: SpeechSynthesisVoice | null; pitch: number }
const MASCULINE = /yunxi|yunjian|yunyang|kangkang|male|男|云希|云健|云扬|康康/i;
const FEMININE = /xiaoxiao|xiaoyi|xiaohan|xiaomo|huihui|yaoyao|female|女|晓晓|晓伊|晓涵|晓墨|慧慧|瑶瑶/i;
const CHINESE = /^(?:zh|cmn|yue)(?:[-_]|$)/i;

function chooseVoices(voices: SpeechSynthesisVoice[]): Record<Side, VoiceProfile> {
  const pick = (side: Side): VoiceProfile => {
    const named = voices.find(voice => (side === 'a' ? MASCULINE : FEMININE).test(voice.name));
    if (named) return { voice: named, pitch: 1 };
    if (voices.length > 1) return { voice: side === 'a' ? voices[0] : voices[1], pitch: 1 };
    return { voice: voices[0] ?? null, pitch: side === 'a' ? .92 : 1.06 };
  };
  return { a: pick('a'), b: pick('b') };
}

/**
 * Agent speech. The local server synthesizes with Windows' installed Chinese
 * voice first (reliable even when a browser's online voice is blocked), then
 * falls back to the browser's SpeechSynthesis, then to a silent reading pace.
 * Audio never leaves this machine.
 */
export function useSpeech(enabled: boolean, code: string) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesReady, setVoicesReady] = useState(false);
  const [server, setServer] = useState<ServerState>('unknown');
  const [speaking, setSpeaking] = useState<Side | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const profiles = useRef<Record<Side, VoiceProfile>>({ a: { voice: null, pitch: 1 }, b: { voice: null, pitch: 1 } });
  const serverRef = useRef<ServerState>('unknown');
  const enabledRef = useRef(enabled);
  const timer = useRef<number | undefined>(undefined);
  const settle = useRef<(() => void) | null>(null);
  const supported = server === 'ready' || voices.length > 0;
  enabledRef.current = enabled;

  useEffect(() => {
    const synth = typeof window === 'undefined' ? null : window.speechSynthesis;
    if (!synth) { setVoicesReady(true); return; }
    let alive = true;
    const load = () => {
      if (!alive) return;
      const all = synth.getVoices();
      const chinese = all.filter(voice => CHINESE.test(voice.lang) || /chinese|mandarin|中文|普通话/i.test(voice.name));
      voicesRef.current = chinese;
      profiles.current = chooseVoices(chinese);
      setVoices(chinese);
      if (chinese.length) setVoicesReady(true);
    };
    load();
    synth.addEventListener('voiceschanged', load);
    const idle = window.setTimeout(() => { if (alive) setVoicesReady(true); }, 900);
    return () => { alive = false; window.clearTimeout(idle); synth.removeEventListener('voiceschanged', load); };
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    fetch(`/api/tts/status?code=${encodeURIComponent(code)}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then((status: { available?: boolean } | null) => {
        if (!alive) return;
        const next: ServerState = status?.available ? 'ready' : 'unavailable';
        serverRef.current = next; setServer(next);
      })
      .catch(() => { if (alive) { serverRef.current = 'unavailable'; setServer('unavailable'); } });
    return () => { alive = false; controller.abort(); };
  }, [code]);

  const stop = useCallback(() => { settle.current?.(); }, []);
  useEffect(() => () => { settle.current?.(); settle.current = null; }, []);
  useEffect(() => { if (!enabled) stop(); }, [enabled, stop]);

  const speak = useCallback((text: string, side: Side, rate: number) => new Promise<void>(resolve => {
    const spoken = sanitizeSpeech(text);
    const pace = estimateSpeechMs(spoken, rate);
    window.clearTimeout(timer.current);
    let done = false, audio: HTMLAudioElement | null = null, url: string | null = null;
    let line: SpeechSynthesisUtterance | null = null, abort: AbortController | null = null;
    const releaseAudio = () => {
      if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio = null; }
      if (url) { URL.revokeObjectURL(url); url = null; }
    };
    const cleanup = () => {
      window.clearTimeout(timer.current);
      abort?.abort(); releaseAudio();
      if (line) {
        line.onend = null; line.onerror = null; line = null;
        if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
      }
    };
    const finish = () => {
      if (done) return;
      done = true;
      if (settle.current === finish) settle.current = null;
      cleanup(); setSpeaking(null); resolve();
    };
    settle.current = finish;
    if (!enabledRef.current || !spoken) { timer.current = window.setTimeout(finish, Math.max(800, pace)); return; }
    const silent = () => { if (!done) timer.current = window.setTimeout(finish, pace); };
    const browser = () => {
      if (done) return;
      const synth = typeof window === 'undefined' ? null : window.speechSynthesis;
      if (!synth || !voicesRef.current.length) { silent(); return; }
      const profile = profiles.current[side];
      const utterance = new SpeechSynthesisUtterance(spoken);
      utterance.lang = profile.voice?.lang || 'zh-CN';
      if (profile.voice) utterance.voice = profile.voice;
      utterance.rate = Math.min(2, Math.max(.5, rate));
      utterance.pitch = profile.pitch;
      utterance.volume = .95;
      line = utterance;
      utterance.onend = finish;
      utterance.onerror = () => {
        if (done) return;
        utterance.onend = null; utterance.onerror = null; line = null;
        silent();
      };
      try { synth.speak(utterance); }
      catch { line = null; silent(); return; }
      setSpeaking(side);
      timer.current = window.setTimeout(() => { synth.cancel(); finish(); }, Math.round(pace * 1.5) + 3000);
    };
    if (serverRef.current === 'unavailable') { browser(); return; }
    abort = new AbortController();
    // A slow server must not hold the stage longer than a spoken line could.
    timer.current = window.setTimeout(finish, Math.round(pace * 1.5) + 12000);
    fetch(`/api/tts?code=${encodeURIComponent(code)}&side=${side}&text=${encodeURIComponent(spoken)}`, { signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error('tts-unavailable');
        const blob = await response.blob();
        if (done) return;
        url = URL.createObjectURL(blob);
        audio = new Audio(url);
        audio.playbackRate = Math.min(2, Math.max(.5, rate));
        audio.onended = finish;
        audio.onerror = () => {
          if (done) return;
          releaseAudio(); browser();
        };
        setSpeaking(side);
        if (serverRef.current !== 'ready') { serverRef.current = 'ready'; setServer('ready'); }
        try { await audio.play(); }
        catch { if (done) return; releaseAudio(); browser(); return; }
        if (done) return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => { audio?.pause(); finish(); }, Math.round(pace * 1.7) + 4000);
      })
      .catch(() => {
        if (done) return;
        if (serverRef.current !== 'unavailable') { serverRef.current = 'unavailable'; setServer('unavailable'); }
        browser();
      });
  }), [code]);

  return { speak, stop, speaking, supported, ready: voicesReady, server };
}
