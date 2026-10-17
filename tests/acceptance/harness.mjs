// Runs the packaged extension in a real, isolated OpenChamber host and drives
// it from Chromium the way a user would.

import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PNG } from 'pngjs';
import { chromium } from 'playwright-core';

import { distZipPath } from '../../scripts/package.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXPECTED_HOST_VERSION = '2.3.3';
const PROBE_PATH = path.join(root, 'tests', 'acceptance', 'probe.js');

/** Model attribution links: the artwork, its creator and its license. */
export const MODEL_URL = 'https://sketchfab.com/3d-models/low-poly-rat-dd63402df69742e39e989801f282e58a';
export const AUTHOR_URL = 'https://sketchfab.com/tylerlazzareschi';
export const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

/** The ZIP under test: the committed deliverable unless `RAT_TEST_ZIP` names another. */
export const deliverableZip = async () => process.env.RAT_TEST_ZIP ?? distZipPath();

const freePort = async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
};

const waitForHttp = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not answer within ${timeoutMs} ms`);
};

/**
 * Starts OpenChamber with its own home and data folders on a free loopback
 * port, so the tests never touch the user's own instance or extensions.
 * `OPENCHAMBER_BIN` selects the executable (default: `openchamber` on PATH).
 */
export const startHost = async () => {
  const bin = process.env.OPENCHAMBER_BIN ?? 'openchamber';
  const { stdout } = await promisify(execFile)(bin, ['--version']);
  const version = stdout.trim();
  const home = await mkdtemp(path.join(tmpdir(), 'rat-host-'));
  const port = await freePort();
  const child = spawn(bin, ['serve', '--foreground', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: home,
    env: { ...process.env, HOME: home, OPENCHAMBER_DATA_DIR: path.join(home, 'data') },
    stdio: 'ignore',
    detached: true,
  });
  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForHttp(url, 60_000);
  } catch (error) {
    process.kill(-child.pid, 'SIGKILL');
    throw error;
  }
  return {
    url,
    version,
    stop: async () => {
      // The host starts its own OpenCode server; stop the whole group.
      try {
        process.kill(-child.pid, 'SIGTERM');
        await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 10_000))]);
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      await rm(home, { recursive: true, force: true });
    },
  };
};

/**
 * `RAT_TEST_CHROMIUM` points at a Chromium executable (default: Playwright's
 * `chromium-headless-shell`). `RAT_TEST_BROWSER_ARGS` replaces the default GL
 * flags; `--use-angle=gl-egl` renders through the system's EGL driver because
 * SwiftShader crashed the GPU process on the machine these tests were written on.
 */
export const launchBrowser = ({ args = [] } = {}) => chromium.launch({
  executablePath: process.env.RAT_TEST_CHROMIUM || undefined,
  args: [...(process.env.RAT_TEST_BROWSER_ARGS ?? '--use-angle=gl-egl').split(' ').filter(Boolean), ...args],
});

const isLoopback = (url) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
export const isRatFrame = (frame) => frame.url().includes('/api/guests/rat/');

/**
 * A browser context with every non-loopback request blocked, the Rat probe
 * injected into each frame, and a log of what the Rat frame requested.
 */
export const newContext = async (browser, options = {}) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...options });
  await context.addInitScript({ path: PROBE_PATH });
  const blocked = [];
  const ratRequests = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (isLoopback(url)) return route.continue();
    blocked.push(url);
    return route.abort('internetdisconnected');
  });
  context.on('request', (request) => {
    let frame;
    try {
      frame = request.frame();
    } catch {
      // Service worker and early navigation requests have no frame.
      return;
    }
    if (isRatFrame(frame)) ratRequests.push(request.url());
  });
  return { context, blocked, ratRequests };
};

export const ratRailButton = (page) => page.getByRole('button', { name: 'Rat', exact: true });

export const openSettingsSection = async (page, section) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: section, exact: true }).click();
  return page.getByRole('dialog');
};

export const closeSettings = (page) => page.getByRole('button', { name: 'Close settings' }).click();

/** Installs a ZIP the way a user does: Settings → Extensions → Browse ZIP archive. */
export const installZipThroughSettings = async (page, zipPath) => {
  const dialog = await openSettingsSection(page, 'Extensions');
  await dialog.locator('input[type="file"][accept*=".zip"]').setInputFiles(zipPath);
  await dialog.getByText('Rat', { exact: true }).waitFor();
  const card = (await dialog.innerText()).split('Installed')[1] ?? '';
  await closeSettings(page);
  // The host confirms with a short-lived toast that would otherwise sit over
  // the panel; it may already be gone.
  await page.locator('[data-sonner-toast]', { hasText: 'Added Rat' }).waitFor({ state: 'detached', timeout: 15_000 });
  return card;
};

export const ratFrame = async (page) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const frame = page.frames().find(isRatFrame);
    if (frame) {
      await frame.waitForLoadState('load');
      return frame;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("Rat's Rail panel frame did not appear.");
};

/** Clicks the rail entry and waits until the panel's scene has drawn. */
export const openRat = async (page) => {
  await ratRailButton(page).click();
  const frame = await ratFrame(page);
  await frame.waitForFunction(() => window.__ratProbe?.draws > 0 || !document.getElementById('message').hidden);
  return frame;
};

export const probe = (frame) => frame.evaluate(() => {
  const { pending, ...counts } = window.__ratProbe;
  return { ...counts, pending: pending.size };
});

/** Probe counts at the start and end of `ms` of waiting, and the frames drawn in between. */
export const sampleDrawing = async (page, frame, ms) => {
  const before = await probe(frame);
  await page.waitForTimeout(ms);
  const after = await probe(frame);
  return { before, after, draws: after.draws - before.draws };
};

// --- Pixels -----------------------------------------------------------------

const decode = (png) => PNG.sync.read(png);

/**
 * The host draws its card edge and resize handle over the outermost pixels
 * of the panel frame, so scene analysis skips this band on every side.
 */
const HOST_CHROME_INSET = 4;

/**
 * Splits a canvas screenshot into background (the commonest colour along the
 * edges) and model pixels, and measures the model's bounding box and colours.
 */
export const analyseScene = (pngBuffer) => {
  const png = decode(pngBuffer);
  const inset = HOST_CHROME_INSET;
  const width = png.width - inset * 2;
  const height = png.height - inset * 2;
  const at = (x, y) => {
    const i = ((y + inset) * png.width + x + inset) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const edgeColours = new Map();
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, height - 1]) {
      const key = at(x, y).join(',');
      edgeColours.set(key, (edgeColours.get(key) ?? 0) + 1);
    }
  }
  const background = [...edgeColours].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const mask = new Uint8Array(width * height);
  let count = 0;
  let fur = 0;
  let pink = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = at(x, y);
      const distance = Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]);
      if (distance < 30) continue;
      mask[y * width + x] = 1;
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      // Brown fur: warm and dark, never grey. Pink: tail, ears and nose. An
      // untextured grey model has neither.
      if (r - b > 12 && r >= g - 8 && r < 170) fur += 1;
      if (r > 150 && r - g > 30 && b > g - 25) pink += 1;
    }
  }
  return {
    png: pngBuffer,
    width,
    height,
    background,
    mask,
    count,
    fur: count ? fur / count : 0,
    pink: count ? pink / count : 0,
    box: count ? { minX, minY, maxX, maxY } : null,
  };
};

/** Share of model pixels that differ between two analyses of the same size. */
export const silhouetteChange = (a, b) => {
  let changed = 0;
  let union = 0;
  for (let i = 0; i < a.mask.length; i += 1) {
    if (a.mask[i] || b.mask[i]) union += 1;
    if (a.mask[i] !== b.mask[i]) changed += 1;
  }
  return union ? changed / union : 0;
};

// --- Colours ----------------------------------------------------------------

export const parseColor = (css) => {
  const match = /rgba?\(([^)]+)\)/.exec(css);
  if (!match) throw new Error(`Unexpected colour ${css}`);
  return match[1].split(/[ ,/]+/).filter(Boolean).slice(0, 3).map(Number);
};

const luminance = ([r, g, b]) => {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export const relativeLuminance = luminance;

export const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

export const readText = (file) => readFile(file, 'utf8');
