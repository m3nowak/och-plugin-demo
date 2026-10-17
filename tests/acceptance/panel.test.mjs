// Installs the packaged Rat ZIP into a real OpenChamber host and checks what
// a user sees and what the panel asks of the browser.

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  AUTHOR_URL,
  EXPECTED_HOST_VERSION,
  LICENSE_URL,
  MODEL_URL,
  analyseScene,
  closeSettings,
  contrast,
  deliverableZip,
  installZipThroughSettings,
  launchBrowser,
  newContext,
  openRat,
  openSettingsSection,
  isRatFrame,
  parseColor,
  ratFrame,
  ratRailButton,
  relativeLuminance,
  silhouetteChange,
  startHost,
  sampleDrawing,
} from './harness.mjs';

/** Longest host panel open/close animation, with room to settle. */
const SETTLE_MS = 800;

const sceneOf = async (frame) => analyseScene(await frame.locator('#scene').screenshot());

const saveArtifact = (png, label) => {
  const dir = path.join(tmpdir(), 'rat-acceptance');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label.replace(/[^a-z0-9]+/gi, '-')}.png`);
  writeFileSync(file, png);
  return file;
};

/** The textured rat is drawn, entirely inside the canvas. */
const assertFramedRat = (scene, label) => {
  try {
    checkFramedRat(scene, label);
  } catch (error) {
    error.message += `\nScreenshot: ${saveArtifact(scene.png, label)}`;
    throw error;
  }
};

const checkFramedRat = (scene, label) => {
  assert.ok(scene.box, `${label}: nothing drawn`);
  const area = scene.width * scene.height;
  assert.ok(scene.count > area * 0.01, `${label}: rat covers only ${scene.count} of ${area} pixels`);
  assert.ok(scene.fur > 0.25, `${label}: only ${(scene.fur * 100).toFixed(1)}% brown fur; textures missing?`);
  assert.ok(scene.pink > 0.005, `${label}: only ${(scene.pink * 100).toFixed(1)}% pink; textures missing?`);
  const { minX, minY, maxX, maxY } = scene.box;
  const margin = Math.min(minX, minY, scene.width - 1 - maxX, scene.height - 1 - maxY);
  assert.ok(margin >= 2, `${label}: rat touches the edge (box ${JSON.stringify(scene.box)} in ${scene.width}x${scene.height})`);
};

const attributionState = (frame) => frame.evaluate(() => {
  const attribution = document.getElementById('attribution');
  const stage = document.getElementById('stage').getBoundingClientRect();
  const box = attribution.getBoundingClientRect();
  const links = [...attribution.querySelectorAll('a')].map((link) => ({
    text: link.textContent.trim(),
    href: link.href,
    color: getComputedStyle(link).color,
  }));
  return {
    text: attribution.textContent.replace(/\s+/g, ' ').trim(),
    links,
    color: getComputedStyle(attribution).color,
    background: getComputedStyle(document.body).backgroundColor,
    belowScene: box.top >= stage.bottom - 1,
    inView: box.top >= 0 && box.bottom <= innerHeight + 1 && box.height > 0,
  };
});

const assertAttribution = (state, label) => {
  assert.ok(state.inView, `${label}: attribution is cut off`);
  assert.ok(state.belowScene, `${label}: attribution is not below the scene`);
  assert.match(state.text, /“Low Poly Rat” by Tyler Lazzareschi, licensed under CC BY 4\.0\./);
  assert.deepEqual(state.links.map(({ text, href }) => [text, href]), [
    ['Low Poly Rat', MODEL_URL],
    ['Tyler Lazzareschi', AUTHOR_URL],
    ['CC BY 4.0', LICENSE_URL],
  ]);
  const background = parseColor(state.background);
  assert.ok(contrast(parseColor(state.color), background) >= 4.5, `${label}: attribution text contrast too low`);
  for (const link of state.links) {
    assert.ok(contrast(parseColor(link.color), background) >= 4.5, `${label}: ${link.text} link contrast too low`);
  }
};

const assertDrawing = (watched, label) => {
  assert.ok(watched.draws > 10, `${label}: only ${watched.draws} frames drawn`);
  assert.ok(watched.after.pending <= 1, `${label}: ${watched.after.pending} animation frames pending`);
  assert.equal(watched.after.maxCallbacksPerFrame, 1, `${label}: more than one animation loop ran`);
};

const assertStopped = (watched, label) => {
  assert.equal(watched.draws, 0, `${label}: still drew ${watched.draws} frames`);
  assert.equal(watched.after.pending, 0, `${label}: an animation frame is still requested`);
};

describe('Rat installed in OpenChamber', () => {
  let host;
  let browser;
  let session;
  let page;
  let frame;
  const ratCard = () => page.locator('[data-zone-card]').filter({ has: page.locator('iframe[src*="/api/guests/rat/"]') });

  before(async () => {
    host = await startHost();
    browser = await launchBrowser();
    session = await newContext(browser);
    page = await session.context.newPage();
    await page.goto(host.url);
  });

  after(async () => {
    await browser?.close();
    await host?.stop();
  });

  test(`runs against OpenChamber web ${EXPECTED_HOST_VERSION}`, () => {
    assert.equal(host.version, EXPECTED_HOST_VERSION);
  });

  test('installs from the ZIP through Settings → Extensions', async () => {
    const card = await installZipThroughSettings(page, await deliverableZip());
    assert.match(card, /Rat/);
    assert.match(card, /ZIP · v1\.0\.0/);
    assert.match(card, /Enabled/);
  });

  test('adds a "Rat" entry to the rail that opens its panel', async () => {
    await ratRailButton(page).waitFor();
    frame = await openRat(page);
    assert.equal(await frame.locator('#message').isHidden(), true, await frame.locator('#message').textContent());
    assert.equal(await ratCard().getByText('Rat', { exact: true }).isVisible(), true);
  });

  test('shows the textured rat fully in frame', async () => {
    await page.waitForTimeout(500);
    assertFramedRat(await sceneOf(frame), 'opened');
  });

  test('turns the rat slowly while keeping all of it in frame', async () => {
    // A full turn takes 20 s; sampling 11 s covers both side-on views.
    const scenes = [];
    for (let i = 0; i < 12; i += 1) {
      scenes.push(await sceneOf(frame));
      await page.waitForTimeout(1000);
    }
    scenes.forEach((scene, i) => assertFramedRat(scene, `t=${i}s`));
    const widths = scenes.map(({ box }) => box.maxX - box.minX);
    assert.ok(Math.max(...widths) > Math.min(...widths) * 1.3, `silhouette width barely changed: ${widths}`);

    const first = await sceneOf(frame);
    await page.waitForTimeout(250);
    const second = await sceneOf(frame);
    const change = silhouetteChange(first, second);
    assert.ok(change > 0.002 && change < 0.25, `silhouette changed ${(change * 100).toFixed(1)}% in 250 ms`);
  });

  test('offers no camera, playback or settings controls', async () => {
    const controls = await frame.evaluate(() => (
      document.querySelectorAll('button, input, select, textarea, [role="button"], [role="slider"], [tabindex]').length
    ));
    assert.equal(controls, 0);
    const links = await frame.evaluate(() => [...document.querySelectorAll('a')].map((link) => link.href));
    assert.deepEqual(links, [MODEL_URL, AUTHOR_URL, LICENSE_URL]);
  });

  test('keeps the model attribution readable below the scene', async () => {
    assertAttribution(await attributionState(frame), 'light theme');
  });

  test('opens model attribution links through the host', async () => {
    // The tests block external network access, so the new tab's navigation is
    // refused; that it was attempted is what matters here.
    const opened = session.context.waitForEvent('page', { timeout: 5_000 });
    await frame.getByRole('link', { name: 'Low Poly Rat' }).click();
    const popup = await opened;
    await page.waitForTimeout(500);
    assert.ok(session.blocked.includes(MODEL_URL), `the host did not open ${MODEL_URL}`);
    await popup.close();
  });

  test('refits the rat when the panel is resized', async () => {
    const sizes = [];
    const check = async (label) => {
      await page.waitForTimeout(SETTLE_MS);
      const canvas = await frame.evaluate(() => {
        const element = document.getElementById('scene');
        return { width: element.clientWidth, height: element.clientHeight, buffer: element.width };
      });
      sizes.push(`${canvas.width}x${canvas.height}`);
      assert.equal(canvas.buffer, Math.floor(canvas.width), `${label}: drawing buffer not resized`);
      assertFramedRat(await sceneOf(frame), label);
      assertAttribution(await attributionState(frame), label);
    };

    await ratCard().getByRole('button', { name: 'Expand panel' }).click();
    await check('expanded');
    await ratCard().getByRole('button', { name: 'Collapse panel' }).click();
    await check('restored');
    await page.setViewportSize({ width: 1000, height: 640 });
    await check('small window');
    await page.setViewportSize({ width: 1400, height: 900 });
    await check('large window');
    assert.equal(new Set(sizes).size >= 3, true, `panel sizes: ${sizes}`);
  });

  test('follows the host theme, including changes while open', async () => {
    const themeState = async () => ({
      ...await attributionState(frame),
      mode: await frame.evaluate(() => document.documentElement.dataset.ocTheme),
      card: await ratCard().evaluate((card) => getComputedStyle(card).backgroundColor),
    });
    for (const mode of ['Dark', 'Light']) {
      const dialog = await openSettingsSection(page, 'Appearance');
      await dialog.getByRole('radio', { name: mode, exact: true }).click();
      await closeSettings(page);
      await page.waitForTimeout(SETTLE_MS);
      const state = await themeState();
      assert.equal(state.mode, mode.toLowerCase());
      assert.deepEqual(parseColor(state.background), parseColor(state.card), `${mode}: panel background differs from the host card`);
      const luminance = relativeLuminance(parseColor(state.background));
      assert.ok(mode === 'Dark' ? luminance < 0.1 : luminance > 0.6, `${mode}: background luminance ${luminance}`);
      assertAttribution(state, `${mode} theme`);
      assertFramedRat(await sceneOf(frame), `${mode} theme`);
    }
  });

  test('stops drawing while the rail panel is hidden and resumes with one loop', async () => {
    assertDrawing(await sampleDrawing(page, frame, 1000), 'before hiding');

    await ratRailButton(page).click();
    await page.waitForTimeout(SETTLE_MS);
    assertStopped(await sampleDrawing(page, frame, 1500), 'closed from the rail');
    await ratRailButton(page).click();
    await page.waitForTimeout(SETTLE_MS);
    assertDrawing(await sampleDrawing(page, frame, 1000), 'reopened from the rail');

    await ratCard().getByRole('button', { name: 'Close panel' }).click();
    await page.waitForTimeout(SETTLE_MS);
    assertStopped(await sampleDrawing(page, frame, 1500), 'closed from the panel');
    await ratRailButton(page).click();
    await page.waitForTimeout(SETTLE_MS);
    assertDrawing(await sampleDrawing(page, frame, 1000), 'reopened after closing');

    await page.getByRole('button', { name: 'Browser', exact: true }).click();
    await page.waitForTimeout(SETTLE_MS);
    assertStopped(await sampleDrawing(page, frame, 1500), 'another rail panel shown');
    await ratRailButton(page).click();
    await page.waitForTimeout(SETTLE_MS);
    assertDrawing(await sampleDrawing(page, frame, 1000), 'back from another rail panel');
    assertFramedRat(await sceneOf(frame), 'after hide and show');
  });

  test('stops drawing while the page is in the background', async () => {
    // Headless Chromium never hides a page, so tell the panel's document what
    // a browser reports when the user switches tabs or minimises the window.
    const setVisibility = (state) => frame.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    await setVisibility('hidden');
    assertStopped(await sampleDrawing(page, frame, 1500), 'page in the background');
    await setVisibility('visible');
    assertDrawing(await sampleDrawing(page, frame, 1000), 'page in the foreground');
  });

  test('docks wherever the host layout controls put it, including the right', async () => {
    const dockAndShow = async (side) => {
      await ratRailButton(page).click({ button: 'right' });
      await page.getByRole('menuitem', { name: `Move panel to the ${side}` }).click();
      await page.waitForTimeout(SETTLE_MS);
      if (await ratRailButton(page).getAttribute('aria-pressed') !== 'true') {
        await ratRailButton(page).click();
        await page.waitForTimeout(SETTLE_MS);
      }
      frame = await ratFrame(page);
      const box = await ratCard().boundingBox();
      const { width } = page.viewportSize();
      return { centre: box.x + box.width / 2, width };
    };

    // The move animates the panel's size and position; repeat it, since the
    // panel must restart however the layout changes arrive.
    for (const round of [1, 2]) {
      const left = await dockAndShow('left');
      assert.ok(left.centre < left.width / 2, 'Rat is not on the left');
      assertDrawing(await sampleDrawing(page, frame, 1000), `docked left (${round})`);
      assertFramedRat(await sceneOf(frame), `docked left (${round})`);

      const right = await dockAndShow('right');
      assert.ok(right.centre > right.width / 2, 'Rat is not on the right');
      assertDrawing(await sampleDrawing(page, frame, 1000), `docked right (${round})`);
      assertFramedRat(await sceneOf(frame), `docked right (${round})`);
    }
  });

  test('renders after a reload with external network access blocked', async () => {
    session.ratRequests.length = 0;
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
    await page.waitForTimeout(2000);
    frame = page.frames().find(isRatFrame);
    if (!frame || (await sampleDrawing(page, frame, 500)).draws === 0) frame = await openRat(page);
    await page.waitForTimeout(SETTLE_MS);
    assertDrawing(await sampleDrawing(page, frame, 1000), 'offline');
    assertFramedRat(await sceneOf(frame), 'offline');
    assert.ok(session.ratRequests.length > 0, 'no Rat requests were observed');
    for (const url of session.ratRequests) {
      const { hostname, pathname } = new URL(url);
      assert.ok(hostname === '127.0.0.1' && pathname.startsWith('/api/guests/rat/'), `Rat requested ${url}`);
    }
  });

  test('keeps rotating when reduced motion is preferred', async () => {
    const reduced = await newContext(browser, { reducedMotion: 'reduce' });
    try {
      const reducedPage = await reduced.context.newPage();
      await reducedPage.goto(host.url);
      await reducedPage.getByRole('button', { name: 'Settings', exact: true }).waitFor();
      let reducedFrame = reducedPage.frames().find(isRatFrame);
      reducedFrame ??= await openRat(reducedPage);
      await reducedPage.waitForTimeout(SETTLE_MS);
      assert.equal(await reducedFrame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      const first = await sceneOf(reducedFrame);
      await reducedPage.waitForTimeout(1500);
      const second = await sceneOf(reducedFrame);
      assertFramedRat(second, 'reduced motion');
      assert.ok(silhouetteChange(first, second) > 0.01, 'the rat did not turn with reduced motion preferred');
    } finally {
      await reduced.context.close();
    }
  });
});
