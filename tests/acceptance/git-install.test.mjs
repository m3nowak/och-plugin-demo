// Exercise the real Git installer without publishing changes or contacting a
// remote: Git rewrites this public-looking URL to a clean local repository.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import {
  EXPECTED_HOST_VERSION,
  analyseScene,
  launchBrowser,
  newContext,
  openRat,
  root,
  sampleDrawing,
  startHost,
} from './harness.mjs';

// A literal documentation IP avoids DNS too. The rewrite means no connection
// to it is made. This configuration exists only in the isolated test host.
const GIT_URL = 'https://192.0.2.1/rat.git';

const snapshotRepository = async (dir) => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate', '-z'], {
    cwd: root,
    encoding: 'utf8',
  }).split('\0').filter(Boolean);
  for (const file of files) {
    const destination = path.join(dir, file);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await copyFile(path.join(root, file), destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error; // Tracked file deleted in the working tree.
    }
  }
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git(['init', '--initial-branch=main']);
  git(['add', '.']);
  git(['-c', 'user.name=Rat test', '-c', 'user.email=rat@example.invalid', '-c', 'commit.gpgsign=false',
    'commit', '-m', 'Test snapshot']);
};

test('installs a clean Git checkout without npm or a build and renders offline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rat-git-install-'));
  let host;
  let browser;
  try {
    await snapshotRepository(dir);
    host = await startHost({ env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(dir).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: GIT_URL,
      GIT_ALLOW_PROTOCOL: 'file',
    } });
    assert.equal(host.version, EXPECTED_HOST_VERSION);
    const response = await fetch(new URL('api/guests', host.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: GIT_URL }),
    });
    const result = await response.json();
    assert.equal(response.status, 201, JSON.stringify(result));
    assert.equal(result.guest.id, 'rat');
    assert.equal(result.guest.source, 'git');

    browser = await launchBrowser();
    const { context, ratRequests } = await newContext(browser);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(host.url);
    const frame = await openRat(page);
    const drawing = await sampleDrawing(page, frame, 500);
    assert.ok(drawing.draws > 10, `only ${drawing.draws} frames drawn`);
    const scene = analyseScene(await frame.locator('#scene').screenshot());
    assert.ok(scene.count > 0 && scene.fur > 0.25 && scene.pink > 0.005, 'textured rat is missing');
    assert.equal(await frame.locator('#message').isVisible(), false);
    assert.match(await frame.locator('#attribution').innerText(), /Tyler Lazzareschi/);
    assert.deepEqual(errors, []);
    assert.ok(ratRequests.every((url) => url.startsWith(new URL('api/guests/rat/', host.url).href)),
      'the panel requested an asset outside its own package');
    assert.ok(ratRequests.some((url) => new URL(url).pathname.endsWith('/extension/panel/main.js')),
      `prebuilt Git bundle was not loaded; observed requests: ${JSON.stringify(ratRequests)}`);
  } finally {
    await browser?.close();
    await host?.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
