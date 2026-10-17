// What the panel shows when it cannot draw: no WebGL, or a broken model
// asset. Each case runs on its own fresh host.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { unzipSync, zipSync } from 'fflate';

import {
  deliverableZip,
  installZipThroughSettings,
  launchBrowser,
  newContext,
  openRat,
  probe,
  root,
  startHost,
} from './harness.mjs';

const BASE_MAP_PATH = 'textures/rat_low_lambert1_BaseMap.png';

const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

/** Opens Rat in a fresh host with `zipPath` installed and reports what it shows. */
const showFailure = async ({ zipPath, browserArgs = [] }) => {
  const host = await startHost();
  const browser = await launchBrowser({ args: browserArgs });
  try {
    const { context } = await newContext(browser);
    const page = await context.newPage();
    await page.goto(host.url);
    await installZipThroughSettings(page, zipPath);
    const frame = await openRat(page);
    await page.waitForTimeout(500);
    const before = await probe(frame);
    await page.waitForTimeout(2500);
    const later = await probe(frame);
    const shown = await frame.evaluate(() => {
      const message = document.getElementById('message');
      const attribution = document.getElementById('attribution');
      const box = attribution.getBoundingClientRect();
      return {
        message: message.hidden ? null : message.textContent,
        messageVisible: message.checkVisibility(),
        attribution: attribution.textContent.replace(/\s+/g, ' ').trim(),
        links: [...attribution.querySelectorAll('a')].map((link) => link.href),
        attributionInView: box.height > 0 && box.bottom <= innerHeight + 1,
      };
    });
    return { shown, before, later };
  } finally {
    await browser.close();
    await host.stop();
  }
};

const assertReadableFailure = ({ shown, before, later }, expectedMessage) => {
  assert.match(shown.message ?? '', expectedMessage);
  assert.equal(shown.messageVisible, true);
  assert.match(shown.attribution, /“Low Poly Rat” by Tyler Lazzareschi, licensed under CC BY 4\.0\./);
  assert.equal(shown.links.length, 3);
  assert.equal(shown.attributionInView, true);
  assert.equal(later.draws, 0, 'the scene drew frames');
  assert.equal(later.pending, 0, 'an animation loop is still running');
  // No retries: nothing new was attempted after the failure was shown.
  assert.equal(later.contextRequests, before.contextRequests, 'WebGL context requested again');
  assert.equal(later.imageDecodes, before.imageDecodes, 'textures decoded again');
};

describe('Rat when it cannot draw', () => {
  let deliverable;
  let deliverableHash;
  let workDir;

  before(async () => {
    deliverable = await deliverableZip();
    deliverableHash = await sha256(deliverable);
    workDir = await mkdtemp(path.join(tmpdir(), 'rat-failures-'));
  });

  after(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test('explains that WebGL is unavailable and keeps the model attribution', async () => {
    const result = await showFailure({ zipPath: deliverable, browserArgs: ['--disable-3d-apis'] });
    assertReadableFailure(result, /^The 3D view needs WebGL, which is not available here\.$/);
  });

  test('explains a broken model asset in an isolated test copy', async () => {
    // Swap the embedded base colour texture for bytes that are not a PNG.
    const files = unzipSync(new Uint8Array(await readFile(deliverable)));
    const source = unzipSync(new Uint8Array(await readFile(path.join(root, 'assets', 'low-poly-rat.zip'))));
    const baseMap = `data:image/png;base64,${Buffer.from(source[BASE_MAP_PATH]).toString('base64')}`;
    const script = new TextDecoder().decode(files['panel/main.js']);
    assert.equal(script.split(baseMap).length, 2, 'the base colour texture is not embedded exactly once');
    files['panel/main.js'] = new TextEncoder().encode(
      script.replace(baseMap, `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`),
    );
    const brokenZip = path.join(workDir, 'rat-broken-asset.zip');
    await writeFile(brokenZip, zipSync(files));

    const result = await showFailure({ zipPath: brokenZip });
    assertReadableFailure(result, /^The rat model could not be loaded\.$/);
  });

  test('leaves the deliverable ZIP untouched', async () => {
    assert.equal(await sha256(deliverable), deliverableHash);
  });
});
