async page => {
  const origin = new URL(page.url()).origin;
  const browser = page.context().browser();
  const ids = ['last-battery', 'last-ferry', 'silent-archive'];
  const results = [];
  const errors = [];
  for (const id of ids) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await context.newPage();
    p.on('pageerror', error => errors.push(`${id}: ${error.message}`));
    p.on('console', message => { if (message.type() === 'error') errors.push(`${id}: ${message.text()}`); });
    await p.goto(origin);
    await p.locator('#scenario').waitFor({ timeout: 30000 });
    await p.locator('#scenario').selectOption(id);
    await p.getByRole('button', { name: '独自体验一局', exact: true }).click();
    await p.locator(`.stage-3d[data-scene="${id}"]`).waitFor({ timeout: 30000 });
    await p.locator('.stage-3d canvas').waitFor({ timeout: 30000 });
    const state = await p.evaluate(() => ({
      scene: document.querySelector('.stage-3d')?.dataset.scene,
      act: document.querySelector('.stage-3d')?.dataset.act,
      ceremony: document.querySelector('.stage-3d')?.dataset.ceremony,
      ambience: document.querySelector('.hud-actions .ambience-toggle')?.getAttribute('aria-pressed'),
      canvas: !!document.querySelector('.stage-3d canvas'),
      theatre: !!document.querySelector('.match-page .theatre'),
      layout: document.querySelector('.match-page')?.dataset.layout,
    }));
    const toggle = p.locator('.hud-actions .ambience-toggle');
    if (await toggle.count()) {
      await toggle.click();
      state.ambienceAfter = await toggle.getAttribute('aria-pressed');
      state.persisted = await p.evaluate(() => localStorage.getItem('whisper-ambience-enabled'));
      await toggle.click();
    }
    results.push({ id, ...state });
    await context.close();
  }
  const check = (ok, text) => { if (!ok) throw new Error(text); };
  for (const state of results) {
    check(state.scene === state.id, `scene mismatch ${state.id}`);
    check(state.act === '1', `act mismatch ${state.id}: ${state.act}`);
    check(state.canvas && !state.theatre && state.layout === 'full', `stage not 3D for ${state.id}`);
    check(state.ambience === 'true' && state.ambienceAfter === 'false' && state.persisted === 'false', `ambience toggle failed for ${state.id}`);
  }
  check(errors.length === 0, `browser errors: ${errors.join('; ')}`);
  return { passed: true, results, errors };
}
