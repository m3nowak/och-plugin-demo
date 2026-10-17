// Builds the installable extension folder at build/rat.

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { convertRatModel, ratModelModule } from './rat-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = path.join(root, 'build', 'rat');

const ratModelPlugin = (model) => ({
  name: 'rat-model',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^virtual:rat-model$/ }, () => ({ path: 'rat-model', namespace: 'rat-model' }));
    pluginBuild.onLoad({ filter: /.*/, namespace: 'rat-model' }, () => ({ contents: ratModelModule(model), loader: 'js' }));
  },
});

/** Package directories under node_modules that ended up in the bundle. */
const bundledPackages = (metafile) => {
  const packages = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (match) packages.add(match[1]);
  }
  return [...packages].sort();
};

const thirdPartyLicenses = async (packages) => {
  const sections = [];
  for (const name of packages) {
    const dir = path.join(root, 'node_modules', name);
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    const license = await readFile(path.join(dir, 'LICENSE'), 'utf8');
    sections.push(`${name}@${manifest.version} (${manifest.license})\n\n${license.trim()}\n`);
  }
  return [
    'Third-party software bundled in panel/main.js',
    '',
    sections.join(`\n${'-'.repeat(72)}\n\n`),
  ].join('\n');
};

export const buildExtension = async () => {
  const model = await convertRatModel(path.join(root, 'assets', 'low-poly-rat.zip'));

  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, 'panel'), { recursive: true });

  const result = await build({
    entryPoints: [path.join(root, 'src', 'panel', 'main.ts')],
    outfile: path.join(outDir, 'panel', 'main.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'eof',
    metafile: true,
    logLevel: 'warning',
    plugins: [ratModelPlugin(model)],
  });

  for (const file of ['package.json', 'icon.svg', 'panel/index.html']) {
    await copyFile(path.join(root, 'extension', file), path.join(outDir, file));
  }
  for (const file of ['LICENSE', 'NOTICE.md']) {
    await copyFile(path.join(root, file), path.join(outDir, file));
  }
  await writeFile(
    path.join(outDir, 'THIRD_PARTY_LICENSES.txt'),
    await thirdPartyLicenses(bundledPackages(result.metafile)),
  );

  return { outDir, model };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { model } = await buildExtension();
  console.log(`Built ${path.relative(root, outDir)}`);
  console.log(JSON.stringify(model.report));
}
