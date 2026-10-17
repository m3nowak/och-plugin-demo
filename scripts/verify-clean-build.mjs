// Clones the committed repository into a temporary folder, installs the
// locked dependencies, packages the extension there and checks that the
// archive is byte for byte the committed dist ZIP.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

const dir = await mkdtemp(path.join(tmpdir(), 'rat-clean-build-'));
try {
  const checkout = path.join(dir, 'checkout');
  execFileSync('git', ['clone', '--quiet', '--no-local', root, checkout], { stdio: 'inherit' });
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: checkout, stdio: 'inherit' });
  const { version } = JSON.parse(await readFile(path.join(checkout, 'extension', 'package.json'), 'utf8'));
  const committed = path.join(checkout, 'dist', `rat-${version}.zip`);
  const rebuilt = path.join(dir, `rat-${version}.zip`);
  execFileSync('node', ['scripts/package.mjs', rebuilt], { cwd: checkout, stdio: 'inherit' });

  const [expected, actual] = await Promise.all([sha256(committed), sha256(rebuilt)]);
  console.log(`committed dist ZIP ${expected}`);
  console.log(`clean rebuild      ${actual}`);
  if (expected !== actual) {
    console.error('The clean build differs from the committed ZIP.');
    process.exitCode = 1;
  } else {
    console.log('The clean build matches the committed ZIP.');
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
