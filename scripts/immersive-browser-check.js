async page => {
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const a = await context.newPage(), b = await context.newPage();
  const errors = [], shots = [];
  let latestA, latestB;
  for (const [p, seat] of [[a, 'a'], [b, 'b']]) {
    p.on('pageerror', error => errors.push(`${seat}: ${error.message}`));
    p.on('console', message => { if (message.type() === 'error') errors.push(`${seat}: ${message.text()}`); });
    p.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('42')) return;
      let message; try { message = JSON.parse(payload.slice(2)); } catch { return; }
      if (message[0] !== 'room:update') return;
      if (seat === 'a') latestA = message[1]; else latestB = message[1];
    }));
  }
  const check = (ok, text) => { if (!ok) throw new Error(text); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const shot = async (name, p = a) => { const path = `docs/screenshots/${name}.png`; await p.screenshot({ path }); shots.push(path); };
  const actions = view => (view?.events || []).filter(event => event.kind === 'speech').length;
  const until = async (fn, timeout = 60000, label = '条件') => { const end = Date.now() + timeout; while (Date.now() < end) { if (fn()) return; await sleep(250); } throw new Error(`等待超时：${label}`); };
  const untilAsync = async (fn, timeout = 60000, label = '条件') => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw new Error(`等待超时：${label}`); };
  const measure = p => p.evaluate(() => {
    const box = el => { const r = el?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) } : null; };
    const gate = document.querySelector('.step-gate'), button = gate?.querySelector('.button-primary');
    const hit = button ? document.elementFromPoint(button.getBoundingClientRect().x + button.getBoundingClientRect().width / 2, button.getBoundingClientRect().y + button.getBoundingClientRect().height / 2) : null;
    const scene = document.querySelector('.negotiation-scene');
    return {
      layout: document.querySelector('.match-page')?.dataset.layout,
      scenePosition: scene ? getComputedStyle(scene).position : null,
      scene: box(scene), canvas: box(document.querySelector('.stage-3d canvas')), hud: box(document.querySelector('.immersive-hud')),
      gate: box(gate), button: box(button), dialogue: box(document.querySelector('.scene-dialogue')), drawer: box(document.querySelector('.drawer')),
      buttonHit: !!(button && hit && button.contains(hit)), buttonReady: !!button && !button.disabled,
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      body: { height: document.body.scrollHeight },
      unavailable: !!document.querySelector('.unavailable-panel'), theatre: !!document.querySelector('.match-page .theatre'),
    };
  });
  const assertFit = async (p, label) => {
    const m = await measure(p);
    check(m.layout === 'full', `${label}: layout is ${m.layout}`);
    check(m.scenePosition === 'fixed', `${label}: scene is not fixed (${m.scenePosition})`);
    check(m.canvas && Math.abs(m.canvas.width - m.viewport.width) <= 2 && Math.abs(m.canvas.height - m.viewport.height) <= 2, `${label}: canvas ${JSON.stringify(m.canvas)} vs ${JSON.stringify(m.viewport)}`);
    check(m.document.width <= m.viewport.width + 1 && m.document.height <= m.viewport.height + 1, `${label}: outer scroll ${JSON.stringify(m.document)}`);
    check(m.gate && m.button && m.gate.bottom <= m.viewport.height + 1, `${label}: gate clipped`);
    check(m.button && m.button.bottom <= m.viewport.height + 1 && m.button.right <= m.viewport.width + 1, `${label}: button outside viewport`);
    check(m.dialogue && m.gate && m.dialogue.bottom <= m.gate.y + 1, `${label}: dialogue overlaps gate`);
    check(m.buttonHit && m.buttonReady, `${label}: continue button covered or disabled`);
    return m;
  };
  const submitPrivate = async (p, stance, note = '') => {
    await p.locator('.drawer-right').waitFor({ timeout: 20000 });
    await p.getByRole('button', { name: stance, exact: true }).click();
    if (note) await p.getByLabel('私密备注', { exact: true }).fill(note);
    await p.getByRole('button', { name: '递出方针', exact: true }).click();
    await p.locator('.drawer-right').waitFor({ state: 'detached', timeout: 20000 });
  };
  const submitPublic = async (p, card) => {
    await p.locator('.drawer-right').waitFor({ timeout: 20000 });
    await p.getByRole('button', { name: card, exact: true }).click();
    await p.getByRole('button', { name: '公开发言', exact: true }).click();
    await p.locator('.drawer-right').waitFor({ state: 'detached', timeout: 20000 });
  };

  await a.goto(origin); await a.getByLabel('你的昵称', { exact: true }).fill('全屏甲');
  await a.getByRole('button', { name: '创建双人房间', exact: true }).click();
  const code = await a.getByTestId('room-code').innerText();
  await b.goto(origin); await b.getByRole('button', { name: '加入房间', exact: true }).click();
  await b.getByLabel('你的昵称', { exact: true }).fill('全屏乙'); await b.getByLabel('六位房间码', { exact: true }).fill(code);
  await b.getByRole('button', { name: '加入这场交锋', exact: true }).click();
  for (const p of [a, b]) {
    await p.getByRole('button', { name: '配置我的代理人', exact: true }).click();
    await p.locator('input[type="radio"][value="enigmatic"]').check();
    await p.getByRole('button', { name: '保存配置', exact: true }).click();
    await p.getByRole('dialog').waitFor({ state: 'hidden' });
    await p.getByRole('button', { name: '我已准备', exact: true }).click();
  }
  await a.getByRole('button', { name: '拉开帷幕', exact: true }).click();
  await a.locator('.immersive-hud').waitFor({ timeout: 30000 });
  check(await a.locator('.match-page').getAttribute('data-layout') === 'full', 'Match did not start in 3D');
  await a.locator('.stage-3d canvas').waitFor({ timeout: 30000 });
  check(await a.locator('.match-page .theatre').count() === 0, '2D stage should not render');
  await a.locator('.drawer-right').waitFor({ timeout: 15000 });
  check((await a.locator('.drawer-right .drawer-badge').innerText()) === '仅你可见', 'Backstage badge missing');
  check(await a.getByRole('button', { name: '守价', exact: true }).isVisible(), 'Private stance cards missing');
  await until(() => latestA?.own?.objective?.title && latestB?.own?.objective?.title, 15000, '隐藏副目标没有下发');
  const objectiveA = latestA.own.objective, objectiveB = latestB.own.objective;
  await b.locator('.drawer-right').waitFor({ timeout: 15000 });
  const drawerA = await a.locator('.drawer-right').innerText(), drawerB = await b.locator('.drawer-right').innerText();
  check(drawerA.includes(objectiveA.title) && drawerA.includes(objectiveA.description), 'Own objective card missing in seat A booth');
  check(drawerA.includes('达成 +5 心理分'), 'Objective reward missing in seat A booth');
  check(!drawerA.includes(objectiveB.title) && !drawerA.includes(objectiveB.description), 'Peer objective leaked into seat A booth');
  check(drawerB.includes(objectiveB.title) && drawerB.includes(objectiveB.description), 'Own objective card missing in seat B booth');
  check(!drawerB.includes(objectiveA.title) && !drawerB.includes(objectiveA.description), 'Peer objective leaked into seat B booth');
  check(!JSON.stringify(latestA).includes(objectiveB.title) && !JSON.stringify(latestA).includes(objectiveB.description), 'Peer objective leaked to seat A socket');
  check(!JSON.stringify(latestB).includes(objectiveA.title) && !JSON.stringify(latestB).includes(objectiveA.description), 'Peer objective leaked to seat B socket');
  check(!JSON.stringify(latestA.events).includes(objectiveA.title) && !JSON.stringify(latestA.events).includes(objectiveB.title), 'Objective leaked into public events');
  for (const [p, label] of [[a, 'A'], [b, 'B']]) {
    const publicText = await p.evaluate(() => ['.immersive-hud', '.scene-dialogue', '.stage-3d', '.public-stage'].map(selector => document.querySelector(selector)?.textContent || '').join(' '));
    check(!publicText.includes(objectiveA.title) && !publicText.includes(objectiveB.title), `Objective leaked into ${label} public stage or HUD`);
  }
  await shot('objective-backstage-1440');
  check(await a.getByRole('button', { name: '守价', exact: true }).isVisible(), 'Private stance cards missing');
  await shot('immersive-backstage-1440');
  for (let i = 0; i < 14; i++) await a.keyboard.press('Tab');
  check(await a.evaluate(() => !!document.activeElement?.closest('.drawer')), 'Focus escaped the backstage drawer');
  await a.keyboard.press('Escape'); await a.locator('.drawer-right').waitFor({ state: 'detached' });

  await a.locator('.backstage-toggle').click();
  await submitPrivate(a, '守价', '守价暗号');
  check(!!latestA?.own?.whispers?.some(w => w.stance === 'hold'), 'Private stance was not stored for the owner');
  await sleep(350);
  check(!JSON.stringify(latestB || {}).includes('守价暗号'), 'Private note leaked to the peer socket');
  check(!(await b.locator('body').innerText()).includes('守价暗号'), 'Private note visible in the peer DOM');
  await submitPrivate(b, '试探');

  await a.locator('.hud-phase strong').filter({ hasText: '代理人交锋中' }).waitFor({ timeout: 30000 });
  for (const p of [a, b]) await p.locator('.gate-controls button[aria-label="加速播放"]').click();
  await until(() => actions(latestA) >= 1, 30000, '自动演出没有产生首个行动');
  check(actions(latestB) >= 1, 'Peer did not receive the automatic action');

  // Pause during the automatic performance, then stop at the gate without any manual gate click.
  await a.locator('.gate-controls button[aria-label="暂停演出"]').waitFor({ timeout: 20000 });
  await a.locator('.gate-controls button[aria-label="暂停演出"]').click();
  const pausedCount = actions(latestA);
  const gateButtonA = a.locator('.step-gate .button-primary');
  await untilAsync(async () => (await gateButtonA.innerText().catch(() => '')) === '继续' && await gateButtonA.isEnabled().catch(() => false), 25000, '暂停后没有停在门闩');
  const gateButtonB = b.locator('.step-gate .button-primary');
  await untilAsync(async () => (await gateButtonB.innerText().catch(() => '')) === '等待对方继续', 25000, '对端没有停在等待');
  await sleep(1600);
  check(actions(latestA) === pausedCount && actions(latestB) === pausedCount, '暂停期间仍在自动推进');
  check(latestA.phase === latestB.phase, 'Two pages diverged in phase');
  check(/守价/.test(latestA.own.reports.at(-1)?.text || ''), 'Agent report did not explain the stance');
  await shot('immersive-paused-1440');

  await a.locator('.backstage-toggle').click(); await a.locator('.drawer-right').waitFor();
  check(/本幕方针/.test(await a.locator('.stance-state').innerText()), 'Backstage stance label missing');
  const withDrawer = await measure(a);
  check(withDrawer.buttonHit && withDrawer.buttonReady, 'Drawer covered the manual gate');
  check(withDrawer.drawer && withDrawer.gate && withDrawer.drawer.bottom <= withDrawer.gate.y, 'Drawer overlaps the gate bar');
  await shot('immersive-backstage-gate-1440');
  await a.keyboard.press('Escape'); await a.locator('.drawer-right').waitFor({ state: 'detached' });

  await a.locator('.archive-toggle').click(); await a.locator('.drawer-left').waitFor();
  check(await a.locator('.drawer-left .negotiation-table').isVisible(), 'Archive table missing');
  check(await a.locator('.drawer-left .archive-transcript .transcript').isVisible(), 'Archive transcript missing');
  check(await a.locator('.drawer-left .action-timeline').isVisible(), 'Archive timeline missing');
  await shot('immersive-archive-1440');
  await a.keyboard.press('Escape'); await a.locator('.drawer-left').waitFor({ state: 'detached' });

  const desktop = await assertFit(a, '1440');
  await shot('immersive-1440');
  await a.setViewportSize({ width: 1920, height: 1080 }); await sleep(500);
  const wide = await assertFit(a, '1920');
  await shot('immersive-1920');
  await a.setViewportSize({ width: 1280, height: 720 }); await sleep(500);
  const hd = await assertFit(a, '1280');
  await shot('immersive-1280');
  await a.setViewportSize({ width: 1440, height: 900 }); await sleep(500);

  const badgeA = await a.locator('.stage-3d-badge').innerText();
  const badgeB = await b.locator('.stage-3d-badge').innerText();
  check(badgeA.includes('甲方席位') && badgeB.includes('乙方席位'), `Seat badges wrong: ${badgeA} / ${badgeB}`);
  check(latestA?.you === 'a' && latestB?.you === 'b', 'Seat authentication mismatch');
  check(!JSON.stringify(latestB).includes('守价暗号'), 'Private whisper leaked to peer');
  check(!(await b.locator('body').innerText()).includes('守价暗号'), 'Private whisper visible in peer DOM');
  await shot('immersive-seat-a-1440', a); await shot('immersive-seat-b-1440', b);

  // Resume: the automatic stage continues and both pages stay in sync without gate clicks.
  await a.locator('.gate-controls button[aria-label="恢复演出"]').click();
  await until(() => actions(latestA) > pausedCount, 30000, '恢复后没有继续自动演出');
  await until(() => actions(latestA) === actions(latestB), 30000, 'Two pages have different action counts');

  await a.locator('.hud-phase strong').filter({ hasText: '公开低语' }).waitFor({ timeout: 90000 });
  await a.locator('.drawer-right').waitFor({ timeout: 15000 });
  check(await a.getByRole('button', { name: '承诺', exact: true }).isVisible(), 'Public cards missing');
  await shot('immersive-public-whisper-1440');
  await submitPublic(a, '承诺');
  await submitPublic(b, '施压');
  await until(() => latestA?.events?.some(e => e.kind === 'whisper' && e.publicCard === 'promise') && latestB?.events?.some(e => e.kind === 'whisper' && e.publicCard === 'pressure'), 15000, '公开卡没有成为双方可见事件');

  // Narrow windows still show the unavailable notice; returning restores automatic play.
  await a.setViewportSize({ width: 800, height: 900 });
  await a.locator('.match-page.is-unavailable').waitFor({ timeout: 10000 });
  const narrow = await measure(a);
  check(narrow.unavailable && !narrow.canvas && !narrow.theatre, `Narrow state wrong: ${JSON.stringify(narrow)}`);
  check(await a.locator('.unavailable-panel').innerText().then(text => text.includes('3D 舞台不可用')), 'Unavailable notice missing');
  await shot('immersive-unavailable-800');
  await a.setViewportSize({ width: 1440, height: 900 }); await a.locator('.match-page[data-layout="full"]').waitFor({ timeout: 10000 });
  await a.locator('.stage-3d canvas').waitFor({ timeout: 30000 });

  await a.locator('.hud-phase strong').filter({ hasText: '耳语时刻' }).waitFor({ timeout: 90000 });
  await submitPrivate(a, '试探'); await submitPrivate(b, '施压');
  await a.locator('.hud-phase strong').filter({ hasText: '公开低语' }).waitFor({ timeout: 90000 });
  await submitPublic(a, '施压'); await submitPublic(b, '表态');

  await a.locator('.hud-phase strong').filter({ hasText: '耳语时刻' }).waitFor({ timeout: 90000 });
  await submitPrivate(a, '成交'); await submitPrivate(b, '守价');
  await a.locator('.hud-phase strong').filter({ hasText: '公开低语' }).waitFor({ timeout: 90000 });
  await submitPublic(a, '表态'); await submitPublic(b, '承诺');

  await until(() => latestA?.status === 'finished' && latestB?.status === 'finished', 180000, '对局没有在自动演出中结束');
  check(actions(latestA) === 12, `Expected 12 AI actions, got ${actions(latestA)}`);
  check(actions(latestB) === 12, `Peer expected 12 AI actions, got ${actions(latestB)}`);
  check(latestA.outcome?.winner !== undefined, 'Outcome missing');
  await shot('immersive-final-1440');

  check(latestA.outcome?.objectives?.a?.title === objectiveA.title && latestA.outcome?.objectives?.b?.title === objectiveB.title, 'Outcome did not reveal both objectives');
  check(typeof latestA.outcome.objectives.a.achieved === 'boolean' && typeof latestA.outcome.objectives.b.achieved === 'boolean', 'Outcome achievement state missing');
  check(!!latestA.outcome.objectives.a.detail && !!latestA.outcome.objectives.b.detail, 'Outcome objective detail missing');
  await a.locator('.hud-result').click();
  await a.locator('.result-page').waitFor({ timeout: 15000 });
  const reportObjectives = await a.locator('[data-testid="objectives"]').innerText();
  check(reportObjectives.includes(objectiveA.title) && reportObjectives.includes(objectiveB.title), 'Report did not reveal both objectives');
  check(reportObjectives.includes(latestA.outcome.objectives.a.detail) && reportObjectives.includes(latestA.outcome.objectives.b.detail), 'Report objective details missing');
  for (const side of ['a', 'b']) {
    const objective = latestA.outcome.objectives[side];
    check(reportObjectives.includes(objective.achieved ? `达成 · 心理分 +${objective.reward}` : '未达成'), `Report objective state missing for seat ${side}`);
  }
  await shot('objective-report-1440');

  check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  return { passed: true, room: code, seatBadges: [badgeA, badgeB], desktop, wide, hd, withDrawer, narrow, shots, browserErrors: errors, actions: actions(latestA) };
}
