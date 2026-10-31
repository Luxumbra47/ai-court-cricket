async page => {
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.__audioAudit = { buffers: 0, loops: 0, stopped: 0, oscillators: 0, oscStopped: 0 };
    const bufferStart = AudioBufferSourceNode.prototype.start, bufferStop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__audioAudit.buffers += 1;
      if (this.loop) window.__audioAudit.loops += 1;
      this.__auditStopped = false;
      return bufferStart.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      if (!this.__auditStopped) { this.__auditStopped = true; window.__audioAudit.stopped += 1; }
      return bufferStop.apply(this, args);
    };
    const oscStart = OscillatorNode.prototype.start, oscStop = OscillatorNode.prototype.stop;
    OscillatorNode.prototype.start = function (...args) {
      window.__audioAudit.oscillators += 1; this.__auditStopped = false;
      return oscStart.apply(this, args);
    };
    OscillatorNode.prototype.stop = function (...args) {
      if (!this.__auditStopped) { this.__auditStopped = true; window.__audioAudit.oscStopped += 1; }
      return oscStop.apply(this, args);
    };
  });
  const p = await context.newPage();
  const errors = [], audioRequests = [], shots = [], transitions = [];
  p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  p.on('request', req => { if (/\.(mp3|wav|ogg|m4a|flac|opus)(\?|$)/i.test(req.url())) audioRequests.push(req.url()); });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const check = (ok, text) => { if (!ok) throw new Error(text); };
  const state = () => p.evaluate(() => {
    const el = document.querySelector('.stage-3d');
    return el ? { ...el.dataset } : null;
  });
  const measure = () => p.evaluate(() => {
    const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) } : null; };
    const gate = document.querySelector('.step-gate'), button = gate?.querySelector('.button-primary');
    const hit = button ? document.elementFromPoint(button.getBoundingClientRect().x + button.getBoundingClientRect().width / 2, button.getBoundingClientRect().y + button.getBoundingClientRect().height / 2) : null;
    return {
      layout: document.querySelector('.match-page')?.dataset.layout, canvas: box(document.querySelector('.stage-3d canvas')),
      gate: box(gate), button: box(button), dialogue: box(document.querySelector('.scene-dialogue')),
      buttonHit: !!(button && hit && button.contains(hit)), buttonReady: !!button && !button.disabled,
      viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    };
  });
  const shot = async name => { await p.screenshot({ path: `docs/screenshots/${name}.png` }); shots.push(name); };
  const closeDrawer = async () => { if (await p.locator('.drawer-right').count()) await p.keyboard.press('Escape'); };

  await p.goto(origin);
  await p.locator('#scenario').waitFor({ timeout: 30000 });
  await p.locator('#scenario').selectOption('last-battery');
  await p.getByRole('button', { name: '独自体验一局', exact: true }).click();
  await p.locator('.stage-3d[data-scene="last-battery"]').waitFor({ timeout: 30000 });
  await p.locator('.stage-3d canvas').waitFor({ timeout: 30000 });
  await sleep(700); await closeDrawer(); await sleep(350);

  // Opening: the standing 12-chip scale and the small lot are both visible, no card covers them.
  const openings = [];
  for (const [width, height, name] of [[1440, 900, 'trade-open-1440'], [1920, 1080, 'trade-open-1920'], [1280, 720, 'trade-open-1280']]) {
    await p.setViewportSize({ width, height }); await sleep(550); await closeDrawer(); await sleep(200);
    const m = await measure();
    check(m.layout === 'full', `opening ${width}: layout ${m.layout}`);
    check(m.canvas && Math.abs(m.canvas.width - width) <= 2 && Math.abs(m.canvas.height - height) <= 2, `opening ${width}: canvas ${JSON.stringify(m.canvas)}`);
    check(m.document.width <= width + 1 && m.document.height <= height + 1, `opening ${width}: outer scroll ${JSON.stringify(m.document)}`);
    await shot(name);
    openings.push({ width, height, m });
  }
  await p.setViewportSize({ width: 1440, height: 900 }); await sleep(500); await closeDrawer();
  const opening = await state();
  check(opening && opening.chips === '12', `data-chips ${opening?.chips}`);
  check(opening && opening.lot === 'last-battery', `data-lot ${opening?.lot}`);
  check(opening && opening.offer === 'none' && opening.agreement === 'none' && opening.trade === 'idle', `opening state ${JSON.stringify(opening)}`);

  let lastTrade = opening.trade, lastOffer = opening.offer, speedSet = false, settled = false;
  const started = Date.now();
  let finalState = null, agreementCaptured = false;
  while (Date.now() - started < 300000) {
    await closeDrawer();
    const speedButton = p.locator('.gate-controls button[aria-label="加速播放"]');
    if (!speedSet && await speedButton.count()) { await speedButton.click().catch(() => {}); speedSet = true; }
    const s = await state();
    if (!s) { await sleep(120); continue; }
    if (s.trade !== lastTrade) {
      transitions.push({ t: Date.now() - started, trade: s.trade, offer: s.offer, agreement: s.agreement, ceremony: s.ceremony });
      lastTrade = s.trade;
      if (s.trade === 'place' && s.offer !== 'none') { await sleep(140); await shot('trade-offer-1440'); }
      if (s.trade === 'withdraw') { await sleep(160); await shot('trade-change-1440'); }
    }
    if (s.offer !== lastOffer) lastOffer = s.offer;
    if (!settled && s.trade === 'idle' && s.offer !== 'none') {
      settled = true;
      await sleep(220); await shot('trade-settled-1440');
      await closeDrawer();
      await p.setViewportSize({ width: 1920, height: 1080 }); await sleep(500); await closeDrawer(); await shot('trade-offer-1920');
      await p.setViewportSize({ width: 1280, height: 720 }); await sleep(500); await closeDrawer(); await shot('trade-offer-1280');
      await p.setViewportSize({ width: 1440, height: 900 }); await sleep(400); await closeDrawer();
    }
    if (!agreementCaptured && s.agreement !== 'none' && s.ceremony === 'none') {
      agreementCaptured = true; await sleep(450); await shot('trade-agreement-1440');
    }
    if (s.ceremony !== 'none') {
      await sleep(900);
      finalState = s;
      await shot(s.ceremony === 'fail' ? 'trade-fail-1440' : 'trade-deal-1440');
      for (let i = 0; i < 20; i++) { const end = await state(); if (end?.trade === 'idle') break; await sleep(100); }
      break;
    }
    await sleep(110);
  }
  const final = await state();
  const audit = await p.evaluate(() => window.__audioAudit);
  const gate = await measure();
  check(final && final.chips === '12', `final data-chips ${final?.chips}`);
  check(final && final.lot === 'last-battery', `final data-lot ${final?.lot}`);
  check(final && final.trade === 'idle', `final data-trade ${final?.trade}`);
  check(final && final.ceremony !== 'none' && final.ceremony === finalState?.ceremony, `final ceremony ${JSON.stringify(final)}`);
  if (final.ceremony === 'fail') check(final.agreement === 'none', `failed match carries agreement ${final.agreement}`);
  if (gate.gate) check(gate.buttonHit && gate.buttonReady, 'manual gate button covered or disabled');
  check(audit.loops === 0, `looping audio sources ${audit.loops}`);
  check(audit.buffers === audit.stopped, `${audit.buffers - audit.stopped} buffer sources not stopped`);
  check(audit.oscillators === audit.oscStopped, `${audit.oscillators - audit.oscStopped} oscillators not stopped`);
  check(audioRequests.length === 0, `external audio requests: ${audioRequests.join(', ')}`);
  check(errors.length === 0, `browser errors: ${errors.join('; ')}`);
  await context.close();
  return { passed: true, shots, openings, opening, transitions, final, audit, audioRequests, browserErrors: errors, ceremony: final.ceremony, agreementSeen: agreementCaptured };
}
