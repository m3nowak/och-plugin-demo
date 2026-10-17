// Checks the installable ZIP users download: what it contains, its legal
// notices, and that the committed archive matches a fresh build.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, describe, test } from 'node:test';

import { parseManifestJson } from '@openchamber/sdk/schemas';
import { unzipSync } from 'fflate';

import { distZipPath, packageExtension } from '../../scripts/package.mjs';
import { AUTHOR_URL, LICENSE_URL, MODEL_URL, root } from './harness.mjs';


describe('installable ZIP', () => {
  let zipBytes;
  let files;
  const text = (name) => new TextDecoder().decode(files[name]);

  before(async () => {
    zipBytes = await readFile(await distZipPath());
    files = unzipSync(new Uint8Array(zipBytes));
  });

  test('matches a fresh build of the current sources', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rat-package-'));
    try {
      const fresh = await readFile(await packageExtension(path.join(dir, 'rat.zip')));
      assert.ok(Buffer.from(zipBytes).equals(fresh), 'dist ZIP is stale: run npm run package');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('holds exactly the built extension and its notices', () => {
    assert.deepEqual(Object.keys(files).sort(), [
      'LICENSE',
      'NOTICE.md',
      'THIRD_PARTY_LICENSES.txt',
      'icon.svg',
      'package.json',
      'panel/index.html',
      'panel/main.js',
    ]);
  });

  test('declares an API version 1 Rail panel named Rat for OpenChamber 2.3.3', () => {
    const result = parseManifestJson(text('package.json'));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.manifest.apiVersion, 1);
    assert.equal(result.manifest.engines.openchamber, '>=2.3.3');
    assert.deepEqual(result.manifest.contributes.panel, {
      id: 'rat',
      name: 'Rat',
      icon: 'icon.svg',
      entry: 'panel/index.html',
    });
    assert.equal(result.manifest.contributes.capabilities, undefined);
  });

  test('loads a prebuilt classic script, not a module', () => {
    const html = text('panel/index.html');
    assert.match(html, /<script src="\.\/main\.js"><\/script>/);
    assert.doesNotMatch(html, /type="module"/);
    assert.doesNotMatch(text('panel/main.js'), /^\s*(import|export)\s/m);
  });

  test('carries the model attribution in the panel itself', () => {
    const html = text('panel/index.html');
    for (const expected of ['Low Poly Rat', 'Tyler Lazzareschi', 'CC BY 4.0', MODEL_URL, AUTHOR_URL, LICENSE_URL]) {
      assert.ok(html.includes(expected), `panel/index.html lacks ${expected}`);
    }
  });

  test('licenses the code under MIT and excludes the artwork', () => {
    const license = text('LICENSE');
    assert.match(license, /^MIT License/);
    assert.match(license, /does not cover the "Low Poly Rat" artwork/);
    assert.match(license, /CC BY 4\.0/);
  });

  test('records the model attribution and every change made to the artwork', () => {
    const notice = text('NOTICE.md');
    for (const expected of ['Low Poly Rat', 'Tyler Lazzareschi', MODEL_URL, AUTHOR_URL, LICENSE_URL,
      'b340026593dd2d8f86f85853715d7572c6e49c5fe28c31c67398ed1a311a1129', 'MaskMap', 'has not reviewed or endorsed']) {
      assert.ok(notice.includes(expected), `NOTICE.md lacks ${expected}`);
    }
  });

  test('carries the license of every bundled third-party package', () => {
    const notices = text('THIRD_PARTY_LICENSES.txt');
    assert.match(notices, /^three@0\.186\.1 \(MIT\)/m);
    assert.match(notices, /^@openchamber\/sdk@2\.3\.3 \(MIT\)/m);
  });

  test('ships the repository documentation that matches the ZIP', async () => {
    for (const file of ['LICENSE', 'NOTICE.md']) {
      assert.equal(text(file), await readFile(path.join(root, file), 'utf8'));
    }
  });
});
