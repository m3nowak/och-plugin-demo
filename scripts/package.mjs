// Zips build/rat into dist/rat-<version>.zip. Entries are sorted and carry a
// fixed timestamp, so the same sources produce the same archive. The host's
// extractor accepts only plain local headers (no data descriptors, no zip64),
// which fflate's synchronous writer produces.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { zipSync } from 'fflate';

import { buildExtension } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// fflate writes DOS timestamps from local-time fields; building the date from
// local fields keeps the bytes the same in every time zone.
const FIXED_MTIME = new Date(2026, 0, 1, 0, 0, 0);

const extensionVersion = async () => (
  JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
);

/** Where `npm run package` writes the installable archive. */
export const distZipPath = async () => path.join(root, 'dist', `rat-${await extensionVersion()}.zip`);

const listFiles = async (dir, prefix = '') => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(dir, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
};

/** Builds the extension and writes its ZIP to `zipPath`. */
export const packageExtension = async (zipPath) => {
  const { outDir } = await buildExtension();
  const entries = {};
  for (const file of await listFiles(outDir)) {
    entries[file] = [await readFile(path.join(outDir, file)), { level: 9, mtime: FIXED_MTIME }];
  }
  await mkdir(path.dirname(zipPath), { recursive: true });
  await writeFile(zipPath, zipSync(entries));
  return zipPath;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const zipPath = await packageExtension(process.argv[2] ? path.resolve(process.argv[2]) : await distZipPath());
  console.log(`Packaged ${path.relative(root, zipPath)}`);
}
