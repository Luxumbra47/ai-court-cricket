import type { ActionUnit, PromiseEntry, PublicAgreement, PublicClaim, PublicEvent, PublicEvidence, PublicOffer } from './whisper.js';

export const ACTION_LABELS = { offer: '推出报价', probe: '追问条件', claim: '放置声明', verify: '翻开凭证', challenge: '指出矛盾', accept: '合并协议', wait: '暂缓表态' };
export const ACTOR_STATES = { offer: '推出报价', probe: '指向条件', claim: '出示材料', verify: '请求查验', challenge: '指出矛盾', accept: '接受协议', wait: '暂缓表态' };
/** Normal Mandarin delivery: about 4.5 spoken characters per second, plus short punctuation pauses. */
export const SPEECH_CHARS_PER_SECOND = 4.5;
export function sanitizeSpeech(text: string): string {
  return text.replace(/[`*#_~]/g, '').replace(/[（(]\s*[)）]/g, '').replace(/\s+/g, ' ').trim();
}
/** Estimated spoken length at 1×. Both the stage and the server gate use this clock. */
export function estimateSpeechMs(text: string, rate = 1): number {
  const spoken = sanitizeSpeech(text);
  const chars = Array.from(spoken).length;
  if (!chars) return 0;
  const pauses = (spoken.match(/[，。！？；：、,.!?;:]/g) || []).length;
  const duration = (chars / SPEECH_CHARS_PER_SECOND) * 1000 + pauses * 160;
  return Math.round(Math.min(120000, Math.max(1200, duration / Math.max(.5, rate))));
}
export function actionUnits(events: PublicEvent[]): ActionUnit[] {
  const seen = new Set<string>();
  return events.flatMap(event => {
    const unit = event.performance;
    if (!unit || seen.has(unit.id)) return [];
    seen.add(unit.id); return [unit];
  });
}
export interface TableState {
  offer: PublicOffer | null; offers: PublicOffer[]; agreement: PublicAgreement | null;
  claims: (PublicClaim & { status: 'unknown' | 'refuted' })[];
  evidence: PublicEvidence[]; challenges: NonNullable<ActionUnit['challenge']>[]; promises: PromiseEntry[];
}
/** Pure public-event replay: refreshing or seeking never consults hidden state or dialogue. */
export function rebuildTable(events: PublicEvent[], throughActionId?: string): TableState {
  const table: TableState = { offer: null, offers: [], agreement: null, claims: [], evidence: [], challenges: [], promises: [] };
  const seen = new Set<string>();
  for (const event of events) {
    if (event.publicPromise && !table.promises.some(p => p.id === event.publicPromise!.id)) table.promises.push({ ...event.publicPromise });
    const action = event.performance;
    if (!action || seen.has(action.id)) continue;
    seen.add(action.id);
    if (action.valid) {
      if (action.offer) { table.offer = action.offer; table.offers.push(action.offer); }
      if (action.claim) table.claims.push({ ...action.claim, status: 'unknown' });
      if (action.evidence) table.evidence.push(action.evidence);
      if (action.challenge) {
        table.challenges.push(action.challenge);
        const claim = table.claims.find(c => c.id === action.challenge!.claimId);
        if (claim && action.challenge.upheld) claim.status = 'refuted';
      }
      if (action.agreement) table.agreement = action.agreement;
      table.promises.push(...action.promises.map(p => ({ ...p })));
      for (const id of action.breaches) { const promise = table.promises.find(p => p.id === id); if (promise) promise.broken = true; }
    }
    if (action.id === throughActionId) break;
  }
  return table;
}
