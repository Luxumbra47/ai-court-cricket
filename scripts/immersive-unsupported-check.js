async page => {
  const origin = new URL(page.url()).origin;
  const shot = async (p, name) => { const path = `docs/screenshots/${name}.png`; await p.screenshot({ path }); return path; };
  const inspect = p => p.evaluate(() => ({
    layout: document.querySelector('.match-page')?.dataset.layout,
    unavailable: !!document.querySelector('.unavailable-panel'),
    canvas: !!document.querySelector('.stage-3d canvas'),
    theatre: !!document.querySelector('.match-page .theatre'),
    notice: document.querySelector('.unavailable-panel')?.innerText || '',
    width: document.documentElement.scrollWidth, viewport: innerWidth,
  }));
  const check = (ok, text) => { if (!ok) throw new Error(text); };

  const noWebglContext = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await noWebglContext.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (typeof type === 'string' && /webgl/i.test(type)) return null;
      return original.apply(this, arguments);
    };
  });
  const noWebgl = await noWebglContext.newPage();
  await noWebgl.goto(origin);
  await noWebgl.getByRole('button', { name: '独自体验一局', exact: true }).waitFor({ timeout: 30000 });
  await noWebgl.getByRole('button', { name: '独自体验一局', exact: true }).click();
  await noWebgl.locator('.match-page.is-unavailable').waitFor({ timeout: 30000 });
  const noWebglState = await inspect(noWebgl);
  const noWebglShot = await shot(noWebgl, 'immersive-nowebgl-1440');

  const failedContext = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await failedContext.route('**/Stage3D-*.js', route => route.abort());
  const failed = await failedContext.newPage();
  await failed.goto(origin);
  await failed.getByRole('button', { name: '独自体验一局', exact: true }).waitFor({ timeout: 30000 });
  await failed.getByRole('button', { name: '独自体验一局', exact: true }).click();
  await failed.locator('.match-page.is-unavailable').waitFor({ timeout: 30000 });
  const failedState = await inspect(failed);
  const failedShot = await shot(failed, 'immersive-load-failure-1440');

  for (const [label, state] of [['no-webgl', noWebglState], ['load-failure', failedState]]) {
    check(state.layout === 'unavailable', `${label}: layout ${state.layout}`);
    check(state.unavailable === true, `${label}: notice missing`);
    check(state.canvas === false, `${label}: 3D canvas still mounted`);
    check(state.theatre === false, `${label}: 2D stage rendered`);
    check(state.notice.includes('3D 舞台不可用'), `${label}: notice text missing`);
    check(state.width <= state.viewport, `${label}: horizontal overflow`);
  }
  return { passed: true, noWebgl: noWebglState, loadFailure: failedState, shots: [noWebglShot, failedShot] };
}
