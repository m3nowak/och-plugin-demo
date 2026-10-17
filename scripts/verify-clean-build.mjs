// Clones the committed repository into a temporary folder, installs the
// locked dependencies, packages the extension there and checks that the
// archive and Git runtime files match the committed artifacts byte for byte.

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
  const { version } = JSON.parse(await readFile(path.join(checkout, 'package.json'), 'utf8'));
  const committed = path.join(checkout, 'dist', `rat-${version}.zip`);
  const rebuilt = path.join(dir, `rat-${version}.zip`);
  const artifacts = [
    ['dist ZIP', committed, rebuilt],
    ['Git bundle', path.join(checkout, 'extension', 'panel', 'main.js'), path.join(checkout, 'build', 'rat', 'panel', 'main.js')],
    ['Git notices', path.join(checkout, 'THIRD_PARTY_LICENSES.txt'), path.join(checkout, 'build', 'rat', 'THIRD_PARTY_LICENSES.txt')],
  ];
  // Building refreshes the Git files too; capture committed hashes first.
  const expected = await Promise.all(artifacts.map(([, file]) => sha256(file)));
  execFileSync('node', ['scripts/package.mjs', rebuilt], { cwd: checkout, stdio: 'inherit' });

  for (const [index, [label, , file]] of artifacts.entries()) {
    const actual = await sha256(file);
    console.log(`committed ${label}: ${expected[index]}`);
    console.log(`rebuilt ${label}:   ${actual}`);
    if (expected[index] !== actual) {
      console.error(`The clean build differs from the committed ${label}.`);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) console.log('The clean build matches all committed artifacts.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
