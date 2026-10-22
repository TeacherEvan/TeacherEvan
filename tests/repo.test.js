/**
 * Repository integrity tests — no browser required.
 * Guards the things that silently rot: duplicated engine files, stale asset
 * generators, version drift, broken README links and malformed banner assets.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectGif } = require('../scripts/lib/gif');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel.split(path.sep).join('/'));
  }
  return out;
};

test('core project files exist', () => {
  const required = [
    'README.md',
    'package.json',
    'docs/index.html',
    'docs/ARCHITECTURE.md',
    'assets/pickaboo-loop.gif',
    'assets/pickaboo-banner.svg',
    'scripts/banner.html',
    'scripts/capture_banner.js',
    'scripts/lib/gif.js',
    '.github/workflows/profile-update.yml',
  ];
  for (const file of required) {
    assert.ok(exists(file), `missing required file: ${file}`);
  }
});

test('the interactive engine exists exactly once (no duplicated copies)', () => {
  const htmlFiles = walk('.').filter(f => f.endsWith('index.html'));
  assert.deepEqual(htmlFiles, ['docs/index.html'],
    `expected exactly one index.html, found: ${htmlFiles.join(', ')}`);
});

test('the legacy Python banner generator is gone', () => {
  assert.ok(!exists('scripts/generate_pickaboo_loop.py'),
    'the v3 Python generator writes to the same asset as the v4 Playwright renderer');
  const all = walk('.').filter(f => /\.(js|py|json|yml|md|html)$/.test(f));
  for (const f of all) {
    if (f === 'tests/repo.test.js') continue; // this file names the retired generator on purpose
    assert.ok(!read(f).includes('generate_pickaboo_loop'),
      `${f} still references the retired Python generator`);
  }
  assert.deepEqual(walk('scripts').filter(f => f.endsWith('.py')), [],
    'the banner pipeline is JavaScript-only — no competing Python renderer');
});

test('version strings are consistent across engine, banner, asset and README', () => {
  const pkg = JSON.parse(read('package.json'));
  const short = pkg.version.split('.').slice(0, 2).join('.');   // 4.1
  const tag = `v${short}`;
  assert.equal(pkg.version, '4.1.0');

  assert.ok(read('docs/index.html').includes(tag), `docs/index.html missing ${tag}`);
  assert.ok(read('scripts/banner.html').includes(tag), `scripts/banner.html missing ${tag}`);
  assert.ok(read('assets/pickaboo-banner.svg').includes(tag), `assets/pickaboo-banner.svg missing ${tag}`);
  assert.ok(read('README.md').includes(tag), `README.md missing ${tag}`);
  assert.ok(read('docs/ARCHITECTURE.md').includes(tag), `docs/ARCHITECTURE.md missing ${tag}`);

  // No stale major/minor tags anywhere in the shipped sources
  for (const f of ['docs/index.html', 'scripts/banner.html', 'assets/pickaboo-banner.svg', 'README.md']) {
    assert.ok(!/v3\.0|v4\.0/.test(read(f)), `${f} still references a stale version tag`);
  }
});

test('README local links and images resolve', () => {
  const md = read('README.md');
  const refs = [...md.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  const local = refs.filter(r => !/^(https?:|mailto:|#|\/\/)/.test(r));
  assert.ok(local.length > 0, 'expected at least one local asset reference');
  for (const ref of local) {
    const clean = ref.split('#')[0].split('?')[0];
    assert.ok(exists(clean), `README references a missing file: ${clean}`);
  }
});

test('banner GIF is a valid, looping, high-frame-rate loop', () => {
  const info = inspectGif(path.join(ROOT, 'assets/pickaboo-loop.gif'));
  assert.equal(info.width, 800, 'banner GIF should be encoded at 800px wide');
  assert.ok(info.height > 150 && info.height < 400, `unexpected GIF height ${info.height}`);
  assert.ok(info.frames >= 100, `expected >= 100 frames, got ${info.frames}`);
  assert.ok(info.loops, 'banner GIF must loop infinitely');
  assert.ok(info.bytes < 5 * 1024 * 1024, 'banner GIF must stay under the 5MB Camo limit');
});

test('banner SVG is animated and versioned', () => {
  const svg = read('assets/pickaboo-banner.svg');
  assert.ok(svg.includes('@keyframes'), 'SVG banner should contain animation keyframes');
  assert.ok(svg.includes('PICKABOO ENGINE'), 'SVG banner should be labelled');
  assert.ok(svg.trimStart().startsWith('<svg'), 'SVG banner should be a valid SVG root');
});

test('package scripts wire the real test suite and the single banner generator', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.test, /^node --test /, 'npm test must run the node:test suite');
  assert.ok(pkg.scripts.test.includes('tests/'), 'npm test must target the tests directory');
  assert.equal(pkg.scripts['build:gif'], 'node scripts/capture_banner.js');
  assert.ok(pkg.devDependencies.playwright, 'playwright must be a dev dependency');
});

test('CI runs the test suite and regenerates assets with the Playwright renderer', () => {
  const wf = read('.github/workflows/profile-update.yml');
  assert.ok(wf.includes('npm ci'), 'CI must install locked dependencies');
  assert.ok(/npm (run )?test/.test(wf), 'CI must run the test suite');
  assert.ok(wf.includes('playwright install'), 'CI must install the Chromium browser');
  assert.ok(wf.includes('npm run build:gif'), 'CI must regenerate the banner with the canonical renderer');
  assert.ok(!wf.includes('public/index.html'), 'CI must not reference the removed duplicate engine');
});

test('engine ships the accessibility affordances it claims', () => {
  const html = read('docs/index.html');
  assert.ok(!html.includes('user-scalable=no'), 'pinch-zoom must not be disabled');
  assert.ok(html.includes('prefers-reduced-motion'), 'engine must honour reduced-motion');
  assert.ok(html.includes('aria-pressed'), 'toggles must expose their state');
  assert.ok(html.includes('role="img"'), 'canvas must have an accessible role/label');
  assert.ok(html.includes('pointerleave'), 'engine must drop the pointer when it leaves the viewport');
});
