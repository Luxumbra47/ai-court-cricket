import { describe, expect, it } from 'vitest';
import { LOADOUT_PREFERENCES_KEY, MODEL_PREFERENCES_KEY, modelSettings, readLoadoutPreferences, readModelPreferences, sameModelSettings, saveLoadoutPreferences, saveModelPreferences } from '../src/preferences.js';
import type { AiConfig } from '../shared/types.js';

const config: AiConfig = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'manual-model', apiKey: 'TEST-KEY-MUST-NOT-PERSIST',
  personality: 'rigorous', strategy: 'evidence', identity: 'scientist', items: ['coffee'], inputPricePerMillion: 1.5 };
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
describe('model preference privacy and equipment independence', () => {
  it('restores the latest equipment selection without persisting extra fields or changing model settings', () => {
    const saved = storage(); saveModelPreferences(config, saved);
    saveLoadoutPreferences(config, saved);
    expect(readLoadoutPreferences(saved)).toEqual({ identity: 'scientist', items: ['coffee'] });
    saveLoadoutPreferences({ identity: 'tycoon', items: [] }, saved);
    expect(readLoadoutPreferences(saved)).toEqual({ identity: 'tycoon', items: [] });
    expect(readModelPreferences(saved)).toEqual(modelSettings(config));
    expect(saved.values.get(LOADOUT_PREFERENCES_KEY)).not.toMatch(/apiKey|TEST-KEY|provider|model/);
  });
  it('ignores invalid equipment and handles blocked storage', () => {
    const saved = storage();
    for (const value of ['broken-json', { identity: 'unknown', items: [] }, { identity: 'scientist', items: ['unknown'] },
      { identity: 'scientist', items: ['coffee', 'coffee'] }, { identity: 'scientist', items: ['coffee', 'archive', 'firewall', 'magnifier'] }]) {
      saved.setItem(LOADOUT_PREFERENCES_KEY, typeof value === 'string' ? value : JSON.stringify(value));
      expect(readLoadoutPreferences(saved)).toBeNull();
    }
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readLoadoutPreferences(blocked)).toBeNull(); expect(saveLoadoutPreferences(config, blocked)).toBe(false);
  });
  it('persists only explicit non-secret model settings', () => {
    const saved = storage();
    saveModelPreferences({ ...config, token: 'RECONNECT-TOKEN', privateEvidence: ['SECRET-EVIDENCE'] } as AiConfig, saved);
    const json = saved.values.get(MODEL_PREFERENCES_KEY)!;
    expect(json).not.toMatch(/apiKey|TEST-KEY|token|RECONNECT|identity|items|privateEvidence|SECRET/);
    expect(readModelPreferences(saved)).toEqual(modelSettings(config));
  });
  it('does not overwrite a saved model when only equipment changes', () => {
    const changed = { ...config, identity: 'tycoon' as const, items: ['archive' as const] };
    expect(sameModelSettings(config, changed)).toBe(true);
    expect(modelSettings(config)).toEqual(modelSettings(changed));
  });
  it('normalizes endpoint trailing slashes and detects real model changes', () => {
    expect(sameModelSettings(config, { ...config, baseUrl: `${config.baseUrl}/` })).toBe(true);
    expect(sameModelSettings(config, { ...config, baseUrl: ' HTTPS://API.DEEPSEEK.COM/ ' })).toBe(true);
    expect(sameModelSettings(config, { ...config, model: 'another-model' })).toBe(false);
  });
  it('drops unexpected fields from previously stored JSON', () => {
    const saved = storage(); saved.setItem(MODEL_PREFERENCES_KEY, JSON.stringify(config));
    expect(readModelPreferences(saved)).not.toHaveProperty('apiKey');
    expect(readModelPreferences(saved)).not.toHaveProperty('identity');
  });
  it.each(['not-json', JSON.stringify({ ...config, provider: 'openai-compatible' }), JSON.stringify({ ...config, provider: 'foreign-provider' })])('ignores malformed or removed vendor preferences: %s', value => {
    const saved = storage(); saved.setItem(MODEL_PREFERENCES_KEY, value); expect(readModelPreferences(saved)).toBeNull();
  });
  it('rejects credentials or query parameters embedded in saved endpoints', () => {
    for (const baseUrl of ['https://user:password@api.deepseek.com', 'https://api.deepseek.com?apiKey=PRIVATE', 'http://api.deepseek.com']) {
      const saved = storage(); saved.setItem(MODEL_PREFERENCES_KEY, JSON.stringify({ ...config, baseUrl }));
      expect(readModelPreferences(saved)).toBeNull();
    }
  });
  it('rejects invalid prices and handles unavailable browser storage safely', () => {
    const saved = storage(); saved.setItem(MODEL_PREFERENCES_KEY, JSON.stringify({ ...config, outputPricePerMillion: -1 }));
    expect(readModelPreferences(saved)).toBeNull();
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readModelPreferences(blocked)).toBeNull(); expect(saveModelPreferences(config, blocked)).toBe(false);
  });
});
