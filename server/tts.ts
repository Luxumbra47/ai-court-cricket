import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Side } from '../shared/whisper.js';

const run = promisify(execFile);
const MASCULINE = /kangkang|yunxi|yunjian|yunyang|male|男|康康|云希|云健|云扬/i;
const FEMININE = /huihui|yaoyao|xiaoxiao|xiaoyi|hanhan|female|女|慧慧|瑶瑶|晓晓|晓伊|涵涵/i;

export interface SpeechVoice { name: string; locale: string }
export interface TtsStatus { available: boolean; voice: string | null; reason?: string }
export interface TtsService {
  readonly available: boolean | null;
  status(): Promise<TtsStatus>;
  synthesize(text: string, side: Side): Promise<Buffer>;
}

const LIST_SCRIPT = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + "\`t" + $_.VoiceInfo.Culture.Name }
$s.Dispose()`;
const SYNTH_SCRIPT = `Add-Type -AssemblyName System.Speech
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TTS_TEXT_B64))
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($env:TTS_VOICE)
$s.Rate = [int]$env:TTS_RATE
$s.SetOutputToWaveFile($env:TTS_OUT)
$s.Speak($text)
$s.Dispose()`;
const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

/** Local Windows speech synthesis. No network request, no key, no player data. */
export class WindowsSpeechService implements TtsService {
  private probe: Promise<SpeechVoice[]> | null = null;
  private voices: SpeechVoice[] = [];
  private state: boolean | null = null;
  private reason: string | undefined;
  private readonly cache = new Map<string, Buffer>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private readonly directory = resolve('.runtime/tts');

  get available() { return this.state; }

  async status(): Promise<TtsStatus> {
    const voices = await this.list();
    return { available: voices.length > 0, voice: this.pick('b')?.name ?? null, ...(voices.length ? {} : { reason: this.reason }) };
  }

  async synthesize(text: string, side: Side): Promise<Buffer> {
    const spoken = text.trim().slice(0, 500);
    const voice = await this.list().then(() => this.pick(side));
    if (!spoken || !voice) throw new Error(this.reason ?? '没有可用的中文语音。');
    const key = createHash('sha256').update(`${voice.name}\n${spoken}`).digest('hex');
    const cached = this.cache.get(key);
    if (cached) return cached;
    const running = this.pending.get(key);
    if (running) return running;
    const job = this.render(key, spoken, voice.name);
    this.pending.set(key, job);
    try { return await job; } finally { this.pending.delete(key); }
  }

  private async render(key: string, text: string, voice: string): Promise<Buffer> {
    await mkdir(this.directory, { recursive: true });
    const out = resolve(this.directory, `${key}.wav`);
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(SYNTH_SCRIPT)], {
        timeout: 30000, windowsHide: true,
        env: { ...process.env, TTS_TEXT_B64: Buffer.from(text, 'utf8').toString('base64'), TTS_OUT: out, TTS_VOICE: voice, TTS_RATE: '0' },
      });
      const audio = await readFile(out);
      if (audio.length < 64 || audio.toString('ascii', 0, 4) !== 'RIFF') throw new Error('语音合成没有生成有效的音频。');
      if (this.cache.size >= 96) { const oldest = this.cache.keys().next().value; if (oldest) this.cache.delete(oldest); }
      this.cache.set(key, audio);
      return audio;
    } finally { void unlink(out).catch(() => {}); }
  }

  private list(): Promise<SpeechVoice[]> {
    if (!this.probe) this.probe = this.probeVoices();
    return this.probe;
  }

  private async probeVoices(): Promise<SpeechVoice[]> {
    if (process.platform !== 'win32') { this.state = false; this.reason = '当前系统没有 Windows 语音合成。'; return []; }
    try {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(LIST_SCRIPT)], { timeout: 15000, windowsHide: true });
      this.voices = stdout.split(/\r?\n/).flatMap(line => {
        const [name, locale] = line.trim().split('\t');
        return name && locale ? [{ name, locale }] : [];
      }).filter(voice => /^zh/i.test(voice.locale));
      this.state = this.voices.length > 0;
      this.reason = this.voices.length ? undefined : '系统没有安装中文语音。';
    } catch {
      this.state = false; this.reason = 'Windows 语音合成不可用。'; this.voices = [];
    }
    return this.voices;
  }

  private pick(side: Side): SpeechVoice | null {
    const named = this.voices.find(voice => (side === 'a' ? MASCULINE : FEMININE).test(voice.name));
    return named ?? this.voices[0] ?? null;
  }
}
