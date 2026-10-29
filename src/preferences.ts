import type { AiConfig, Loadout } from '../shared/types';
import { PROVIDER_PRESETS } from '../shared/providers';

export type ModelSettings = Omit<AiConfig, 'apiKey' | 'identity' | 'items'>;
export const MODEL_PREFERENCES_KEY = 'ai-court-model-preferences-v2';
export const LOADOUT_PREFERENCES_KEY = 'ai-court-loadout-preferences-v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export function normalizedEndpoint(value: string): string {
  if (!value.trim()) return '';
  try { return new URL(value.trim()).toString().replace(/\/+$/, ''); }
  catch { return value.trim().replace(/\/+$/, ''); }
}

/** Explicit field projection: model preferences exclude secrets, room credentials and equipment. */
export function modelSettings(value: ModelSettings): ModelSettings {
  const result: ModelSettings = { provider: value.provider, baseUrl: normalizedEndpoint(value.baseUrl),
    model: value.model, personality: value.personality, strategy: value.strategy };
  if (value.inputPricePerMillion !== undefined) result.inputPricePerMillion = value.inputPricePerMillion;
  if (value.outputPricePerMillion !== undefined) result.outputPricePerMillion = value.outputPricePerMillion;
  return result;
}

export function readModelPreferences(storage?: StorageLike): ModelSettings | null {
  try {
    const value: unknown = JSON.parse((storage ?? window.localStorage).getItem(MODEL_PREFERENCES_KEY) || 'null');
    if (!value || typeof value !== 'object') return null;
    const input = value as Record<string, unknown>;
    const preset = PROVIDER_PRESETS.find(p => p.id === input.provider);
    if (!preset || typeof input.baseUrl !== 'string' || typeof input.model !== 'string' ||
      !/^[A-Za-z0-9_.:/@+ -]{1,120}$/.test(input.model) || input.baseUrl.length > 500 ||
      !['rigorous', 'aggressive', 'cunning', 'chaotic'].includes(String(input.personality)) ||
      !['evidence', 'rebuttal', 'cautious', 'free'].includes(String(input.strategy))) return null;
    if (preset.id !== 'mock') {
      const endpoint = new URL(input.baseUrl);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    }
    for (const field of ['inputPricePerMillion', 'outputPricePerMillion']) {
      if (input[field] !== undefined && (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || Number(input[field]) < 0 || Number(input[field]) > 10000)) return null;
    }
    return modelSettings({ provider: preset.id, baseUrl: input.baseUrl, model: input.model,
      personality: input.personality as AiConfig['personality'], strategy: input.strategy as AiConfig['strategy'],
      inputPricePerMillion: input.inputPricePerMillion as number | undefined, outputPricePerMillion: input.outputPricePerMillion as number | undefined });
  } catch { return null; }
}

export function saveModelPreferences(value: ModelSettings, storage?: StorageLike): boolean {
  try { (storage ?? window.localStorage).setItem(MODEL_PREFERENCES_KEY, JSON.stringify(modelSettings(value))); return true; }
  catch { return false; }
}

export function sameModelSettings(a: ModelSettings, b: ModelSettings): boolean {
  return JSON.stringify(modelSettings(a)) === JSON.stringify(modelSettings(b));
}

export function readLoadoutPreferences(storage?: StorageLike): Loadout | null {
  try {
    const value = JSON.parse((storage ?? window.localStorage).getItem(LOADOUT_PREFERENCES_KEY) || 'null');
    if (!value || !['civilian', 'tycoon', 'scientist'].includes(value.identity) ||
      !Array.isArray(value.items) || value.items.length > 3 || new Set(value.items).size !== value.items.length ||
      !value.items.every((id: unknown) => typeof id === 'string' && ['magnifier', 'coffee', 'archive', 'interrogate', 'firewall', 'extension'].includes(id))) return null;
    return { identity: value.identity, items: [...value.items] };
  } catch { return null; }
}

export function saveLoadoutPreferences(value: Loadout, storage?: StorageLike): boolean {
  try {
    (storage ?? window.localStorage).setItem(LOADOUT_PREFERENCES_KEY, JSON.stringify({ identity: value.identity, items: value.items }));
    return true;
  } catch { return false; }
}
