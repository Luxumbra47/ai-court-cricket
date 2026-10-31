/**
 * Local, procedural stage sound.
 *
 * Everything is synthesized with the Web Audio API: no audio files, no network,
 * no third-party dependency. Only short one-shot cues are played — there is no
 * looping noise bed, no rain loop, no electrical hum and no low drone, so the
 * stage never sounds like constant background noise. The context is created and
 * resumed only after the first pointerdown/keydown, so browsers never report a
 * blocked autoplay. Only public stage cues are used; private data never reaches
 * this module.
 */
export type AmbienceCue =
  | 'paper' | 'chip' | 'page' | 'challenge' | 'wax' | 'stamp' | 'breach' | 'act' | 'deal' | 'lightsOut';

export interface AmbienceController {
  setEnabled(value: boolean): void;
  setDucked(value: boolean): void;
  trigger(cue: AmbienceCue): void;
  /** Keep one-shot cues available for the closing ceremony; there is no bed to stop. */
  end(): void;
  dispose(): void;
}

const silent: AmbienceController = {
  setEnabled: () => {}, setDucked: () => {}, trigger: () => {}, end: () => {}, dispose: () => {},
};

function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createAmbience(initialEnabled = true): AmbienceController {
  if (typeof window === 'undefined') return silent;

  let enabled = initialEnabled, ducked = false, unlocked = false, ended = false, disposed = false;
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let effects: GainNode | null = null;
  let noise: AudioBuffer | null = null;

  const disconnect = (node: AudioNode | null) => { try { node?.disconnect(); } catch { /* already closed */ } };

  const tone = (frequency: number, duration: number, level: number, type: OscillatorType = 'sine') => {
    if (!context || !effects) return;
    const now = context.currentTime;
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain); gain.connect(effects);
    osc.start(now); osc.stop(now + duration + .06);
    osc.onended = () => { disconnect(osc); disconnect(gain); };
  };

  const burst = (duration: number, level: number, filter: BiquadFilterType, frequency: number, q = 1) => {
    if (!context || !noise || !effects) return;
    const now = context.currentTime;
    const source = context.createBufferSource(), gain = context.createGain(), shape = context.createBiquadFilter();
    source.buffer = noise; source.loop = false;
    shape.type = filter; shape.frequency.setValueAtTime(frequency, now); shape.Q.setValueAtTime(q, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(shape); shape.connect(gain); gain.connect(effects);
    source.start(now); source.stop(now + duration + .05);
    source.onended = () => { disconnect(source); disconnect(shape); disconnect(gain); };
  };

  const chime = (base: number, level: number, duration: number) => {
    tone(base, duration, level, 'sine');
    tone(base * 1.48, duration * .72, level * .55, 'sine');
    tone(base * 2.03, duration * .45, level * .3, 'triangle');
  };

  const ensureGraph = () => {
    if (context || disposed) return !!context;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    try {
      context = new Ctor();
      master = context.createGain(); master.gain.value = .58;
      effects = context.createGain(); effects.gain.value = ducked ? .4 : .86;
      effects.connect(master); master.connect(context.destination);
      noise = noiseBuffer(context);
      return true;
    } catch {
      context = null; master = null; effects = null;
      return false;
    }
  };

  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    if (!enabled || disposed) return;
    if (!ensureGraph()) return;
    if (context!.state === 'suspended') void context!.resume().catch(() => {});
  };

  const onHidden = () => {
    if (document.hidden) {
      if (context?.state === 'running') void context.suspend().catch(() => {});
    } else if (unlocked && !disposed && context?.state === 'suspended') {
      void context.resume().catch(() => {});
    }
  };

  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', onHidden);

  return {
    setEnabled(value) {
      enabled = value;
      if (!enabled || !unlocked || disposed || ended) return;
      if (!ensureGraph()) return;
      if (context!.state === 'suspended') void context!.resume().catch(() => {});
    },
    setDucked(value) {
      ducked = value;
      if (effects && context) effects.gain.setTargetAtTime(ducked ? .4 : .86, context.currentTime, .18);
    },
    trigger(cue) {
      if (!enabled || disposed || ended && cue !== 'deal' && cue !== 'lightsOut') return;
      if (!context || context.state !== 'running') return;
      switch (cue) {
        case 'paper': burst(.22, .032, 'bandpass', 2300, .8); tone(180, .18, .008, 'triangle'); break;
        case 'chip': burst(.055, .026, 'bandpass', 1900, 1.4); tone(640, .05, .01, 'triangle'); tone(880, .03, .006, 'sine'); break;
        case 'page': burst(.16, .03, 'highpass', 3100, .9); tone(220, .12, .006, 'triangle'); break;
        case 'challenge': tone(66, .38, .042, 'sine'); tone(132, .22, .015, 'triangle'); burst(.2, .015, 'lowpass', 420, .8); break;
        case 'wax': burst(.12, .028, 'lowpass', 880, .6); tone(92, .18, .022, 'sine'); break;
        case 'stamp': tone(88, .26, .034, 'sine'); burst(.09, .024, 'lowpass', 900, .7); break;
        case 'breach': burst(.08, .034, 'highpass', 1900, 2.4); tone(72, .3, .03, 'sine'); break;
        case 'act': chime(392, .014, 1.2); break;
        case 'deal': tone(96, .32, .04, 'sine'); burst(.12, .026, 'lowpass', 950, .7); chime(392, .014, 1.5); break;
        case 'lightsOut': burst(.1, .012, 'lowpass', 700, .6); tone(72, .5, .012, 'sine'); break;
      }
    },
    end() { ended = true; },
    dispose() {
      disposed = true;
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      document.removeEventListener('visibilitychange', onHidden);
      if (context) {
        const closing = context;
        context = null; master = null; effects = null;
        void closing.close().catch(() => {});
      }
    },
  };
}
