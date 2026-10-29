import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConfigPage from '../src/pages/ConfigPage';
import { describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../shared/types';
import { availableRoute, newActionId, newConfig, parseRoute, playerCost, PROVIDERS, routeHash, validateConfig, validateEntry, validateNickname } from '../src/frontend';

const waitingRoom = (): RoomView => ({
  code: 'ABC234', actionOptions: [], ownAction: null, status: 'waiting', hostId: 'host', you: 'host',
  players: [{ id: 'host', nickname: '访客', side: 'defense', connected: true, ready: false, configured: true,
    config: newConfig(), loadout: { identity: 'civilian', items: [] }, state: null, usage: { calls: 0, retries: 0, failures: 0, fallback: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 } }],
  case: { id: 'pizza', title: '案件', subtitle: '', background: '', threshold: 60, initialScore: 42 },
  publicEvidence: [], privateEvidence: [], events: [], game: null, thinking: null, persistence: 'memory', notice: null, ownAiSettings: null,
});

describe('workspace destinations and room access', () => {
  it('maps old configuration and preparation links to the merged pages', () => {
    expect(routeHash(parseRoute('#loadout'))).toBe('#config?section=equipment');
    expect(routeHash(parseRoute('#prepare'))).toBe('#room');
  });
  it('round-trips a transcript deep link without exposing configuration', () => {
    const route = { view: 'court' as const, event: 'match:turn-2' };
    expect(parseRoute(routeHash(route))).toEqual({ ...route, section: undefined });
    expect(routeHash({ ...route, section: 'anything' })).not.toContain('section');
  });
  it('redirects unavailable destinations until a room or verdict exists', () => {
    expect(availableRoute({ view: 'report' }, null).route.view).toBe('home');
    expect(availableRoute({ view: 'court' }, waitingRoom()).route.view).toBe('room');
    expect(availableRoute({ view: 'report' }, waitingRoom()).notice).toContain('对局结束');
  });
  it('allows configuration recovery only while a real connection is missing', () => {
    const room = waitingRoom(); room.status = 'playing';
    expect(availableRoute({ view: 'config' }, room).route.view).toBe('room');
    room.players[0].configured = false;
    expect(availableRoute({ view: 'config' }, room).route.view).toBe('config');
  });
  it('does not show an uncommitted verdict in a cancelled room', () => {
    const room = waitingRoom(); room.status = 'cancelled';
    expect(availableRoute({ view: 'report' }, room).route.view).toBe('room');
  });
});

describe('entry and unified configuration validation', () => {
  it('keeps the V1.1 domestic provider catalog in the updated UI', () => {
    expect(Object.keys(PROVIDERS)).toHaveLength(20);
    for (const id of ['deepseek', 'qwen', 'doubao', 'kimi', 'huawei']) expect(PROVIDERS).toHaveProperty(id);
    expect(PROVIDERS).not.toHaveProperty('openai-compatible');
  });
  it('rejects short codes and ambiguous digits before sending a join request', () => {
    expect(validateEntry('昵称', 'join', 'ABCD', '').code).toBeTruthy();
    expect(validateEntry('昵称', 'join', 'AB01CD', '').code).toBeTruthy();
    expect(validateEntry('昵称', 'join', 'ABC234', '')).toEqual({});
  });
  it('checks nickname and case separately for field-level feedback', () => {
    expect(validateEntry('', 'create', '', '')).toHaveProperty('nickname');
    expect(validateEntry('合法昵称', 'create', '', '')).toHaveProperty('caseId');
    expect(validateEntry('<script>', 'create', '', 'pizza')).toHaveProperty('nickname');
  });
  it('validates creator nickname independently before case selection', () => {
    expect(validateNickname('')).toHaveProperty('nickname');
    expect(validateNickname('合法昵称')).toEqual({});
    expect(validateEntry('合法昵称', 'create', '', '')).toHaveProperty('caseId');
  });
  it('allows the default preset without HTTPS or any key', () => {
    expect(validateConfig(newConfig(), false)).toEqual({});
  });
  it('requires HTTPS and a new key for real-model submission', () => {
    const config = { ...newConfig(), provider: 'deepseek' as const, baseUrl: 'https://api.deepseek.com', model: 'model' };
    expect(validateConfig(config, false).apiKey).toContain('HTTPS');
    expect(validateConfig(config, true).apiKey).toBeTruthy();
    expect(validateConfig({ ...config, apiKey: 'test-key' }, true)).toEqual({});
    expect(validateConfig(config, true, true)).toEqual({});
    expect(validateConfig(config, false, true).apiKey).toContain('HTTPS');
  });
  it('rejects malformed endpoints, leaked keys and invalid prices without returning the secret', () => {
    const config = { ...newConfig(), provider: 'qwen' as const, apiKey: 'SENTINEL-KEY', model: 'SENTINEL-KEY', baseUrl: 'https://example.com/?key=oops', inputPricePerMillion: NaN };
    const errors = validateConfig(config, true);
    expect(errors).toHaveProperty('baseUrl'); expect(errors).toHaveProperty('model'); expect(errors).toHaveProperty('inputPricePerMillion');
    expect(JSON.stringify(errors)).not.toContain('SENTINEL-KEY');
  });
});

describe('cost reporting when provider data is incomplete', () => {
  it('does not turn unreported real-model usage into a zero-cost estimate', () => {
    const player = waitingRoom().players[0];
    player.config!.provider = 'qwen';
    expect(playerCost(player)).toContain('未知');
    player.usage.inputTokens = 100; player.usage.estimatedCost = null;
    expect(playerCost(player)).toContain('未知');
  });
  it('distinguishes preset zero cost and a real provider estimate', () => {
    const player = waitingRoom().players[0];
    expect(playerCost(player)).toBe('¥0 · 预设模式');
    player.config!.provider = 'deepseek'; player.usage.inputTokens = 100; player.usage.estimatedCost = 0.001;
    expect(playerCost(player)).toContain('0.001');
  });
});

it('allows key re-entry during a match while keeping model and equipment locked', () => {
  vi.stubGlobal('window', { location: { protocol: 'https:' } });
  try {
    const room = waitingRoom(); room.status = 'playing'; room.players[0].configured = false;
    const config = { ...newConfig(), provider: 'deepseek' as const, baseUrl: 'https://api.deepseek.com', model: 'test' };
    const html = renderToStaticMarkup(createElement(ConfigPage, { room, catalog: null, config, dirty: false, connected: true,
      onChange: () => {}, onProvider: () => {}, onSave: async () => {}, onSaveEquipment: async () => {}, onEquipment: () => {}, request: async <T,>() => ({} as T) }));
    const key = html.match(/<input[^>]*id="field-apiKey"[^>]*>/)?.[0];
    expect(key).toBeDefined(); expect(key).not.toContain('disabled');
    expect(html.match(/<input[^>]*id="field-model"[^>]*>/)?.[0]).toContain('disabled');
  } finally { vi.unstubAllGlobals(); }
});

it('creates valid command IDs on HTTP browsers without crypto.randomUUID', () => {
  vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { a.fill(1); return a; } });
  try { expect(newActionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); }
  finally { vi.unstubAllGlobals(); }
});
