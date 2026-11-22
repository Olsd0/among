import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('cache version command works in paths with spaces, Korean text and #', (t) => {
  const tempRoot = resolve(tmpdir());
  const root = mkdtempSync(join(tempRoot, 'among bump 한글 #-'));
  t.after(() => {
    assert.equal(dirname(root), tempRoot);
    assert.ok(basename(root).startsWith('among bump 한글 #-'));
    rmSync(root, { recursive: true, force: true });
  });
  for (const directory of ['web', 'collector/src', 'collector/scripts']) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  const script = join(root, 'collector/scripts/bump-versions.js');
  copyFileSync(fileURLToPath(new URL('../scripts/bump-versions.js', import.meta.url)), script);
  writeFileSync(join(root, 'collector/package.json'), '{"type":"module"}\n');
  const unchanged = 'engine.js?v=20000101-4';
  writeFileSync(join(root, 'web/index.html'), `<script src="app.js?v=20000101-2"></script>\n<script src="${unchanged}"></script>\n`);
  writeFileSync(join(root, 'collector/src/loader.js'), `import './app.js?v=20000101-3';\nimport './${unchanged}';\n`);
  writeFileSync(join(root, 'web/sw.js'), `const CACHE = 'among-shell-v9';\nconst SHELL = ['app.js?v=20000101-1', '${unchanged}'];\n`);
  const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const before = kstDate();
  execFileSync(process.execPath, [script, 'app.js'], { cwd: tempRoot, encoding: 'utf8', timeout: 10000 });
  const after = kstDate();
  const html = readFileSync(join(root, 'web/index.html'), 'utf8');
  const loader = readFileSync(join(root, 'collector/src/loader.js'), 'utf8');
  const sw = readFileSync(join(root, 'web/sw.js'), 'utf8');
  const version = html.match(/app\.js\?v=(\d{8}-\d+)/)?.[1];
  assert.ok([`${before}-1`, `${after}-1`].includes(version), 'uses today in KST and starts at version 1');
  for (const content of [html, loader, sw]) {
    assert.ok(content.includes(`app.js?v=${version}`), 'all requested asset references receive the same version');
    assert.ok(content.includes(unchanged), 'unrequested asset versions stay unchanged');
    assert.equal(content.includes('app.js?v=20000101-'), false, 'old requested asset versions are removed');
  }
  assert.ok(sw.includes("const CACHE = 'among-shell-v10';"), 'service worker cache increases once');
});
