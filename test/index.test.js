import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {processSnapshot, compareSnapshots, withinScope, exitCode} from '../src/index.js';

const snapshot = (manifest = {}, more = {}) => ({manifest,
  manifest_url: 'https://example.com/resources/manifest.json',
  document_url: 'https://example.com/app/index.html?doc=1#home', ...more});

test('relative start uses manifest directory; relative id uses origin', () => {
  const p = processSnapshot(snapshot({start_url: '../app/home', id: 'identity'}));
  assert.equal(p.start_url, 'https://example.com/app/home');
  assert.equal(p.id, 'https://example.com/identity');
  assert.equal(p.scope, 'https://example.com/app/');
});
test('absent, empty, non-string, invalid and cross-origin start fall back to document', () => {
  for (const value of [undefined, '', null, 7, 'http://[', 'https://other.example/']) {
    const p = processSnapshot(snapshot({start_url: value}));
    assert.equal(p.start_url, snapshot().document_url);
    assert.equal(p.id, 'https://example.com/app/index.html?doc=1');
    assert.equal(p.sources.start_url, 'fallback');
  }
});
test('id fallbacks, fragment removal and meaningful query', () => {
  for (const value of [undefined, '', {}, 'https://else.example/id', 'http://[']) {
    assert.equal(processSnapshot(snapshot({id: value})).id, 'https://example.com/app/index.html?doc=1');
  }
  assert.equal(processSnapshot(snapshot({id: '/x?source=1#frag'})).id, 'https://example.com/x?source=1');
});
test('id can be outside navigation scope', () => {
  assert.equal(processSnapshot(snapshot({start_url: '/app/', scope: '/app/', id: '/identity'})).id, 'https://example.com/identity');
});
test('Unicode, dot segments, ports and IDN use WHATWG URL', () => {
  assert.equal(processSnapshot(snapshot({id: '/café'})).id, 'https://example.com/caf%C3%A9');
  assert.equal(processSnapshot(snapshot({id: 'https://EXAMPLE.com:443/a/../b'})).id, 'https://example.com/b');
  const p = processSnapshot(snapshot({id: './😀'}, {document_url: 'https://例子.测试/', manifest_url: 'https://例子.测试/m.json'}));
  assert.equal(p.id, 'https://xn--fsqu00a.xn--0zwm56d/%F0%9F%98%80');
});
test('scope strips query and fragment and does not use segment boundaries', () => {
  const p = processSnapshot(snapshot({start_url: '/app/main', scope: '/app?x=1#part'}));
  assert.equal(p.scope, 'https://example.com/app');
  assert.equal(withinScope('https://example.com/application', p.scope), true);
  assert.equal(withinScope('https://example.com/application', 'https://example.com/app/'), false);
});
test('invalid, cross-origin and excluding scopes fall back to start directory', () => {
  for (const scope of ['', null, 42, '/other/', 'https://other.example/', 'http://[']) {
    const p = processSnapshot(snapshot({start_url: '/app/start?x#y', scope}));
    assert.equal(p.scope, 'https://example.com/app/');
    assert.equal(p.sources.scope, 'fallback');
  }
});
test('cross-origin hosted manifest can specify an app-origin start', () => {
  const p = processSnapshot(snapshot({start_url: 'https://example.com/app/', id: 'stable'}, {manifest_url: 'https://cdn.example/m.json'}));
  assert.equal(p.id, 'https://example.com/stable');
});
test('changed start without stable id is regression; explicit old id preserves it', () => {
  const old = snapshot({start_url: '/old?source=pwa'});
  assert.equal(compareSnapshots(old, snapshot({start_url: '/new'})).summary.regression, true);
  assert.equal(compareSnapshots(old, snapshot({start_url: '/new', id: '/old?source=pwa'})).summary.regression, false);
});
test('identity fragments do not create differences but query changes do', () => {
  assert.equal(compareSnapshots(snapshot({id: '/a#1'}), snapshot({id: '/a#2'})).identity_changed, false);
  assert.equal(compareSnapshots(snapshot({id: '/a?q=1'}), snapshot({id: '/a?q=2'})).identity_changed, true);
});
test('scope relations and lost/gained navigation witnesses', () => {
  const old = snapshot({start_url: '/app/', id: '/', scope: '/'});
  const next = snapshot({start_url: '/app/', id: '/', scope: '/app/'});
  const r = compareSnapshots(old, next, ['https://example.com/settings', 'https://example.com/app/', 'https://other.example/', 'https://example.com/settings']);
  assert.equal(r.scope_relation, 'narrowed');
  assert.equal(r.summary.scope_lost, 1);
  assert.equal(r.navigation.length, 3);
  assert.equal(r.summary.regression, true);
  assert.equal(compareSnapshots(next, old).scope_relation, 'broadened');
  assert.equal(compareSnapshots(next, next).scope_relation, 'equal');
  assert.equal(compareSnapshots(next, snapshot({start_url: '/other/', scope: '/other/'})).scope_relation, 'disjoint');
});
test('origin change creates new identity and disjoint scope', () => {
  const r = compareSnapshots(snapshot({id: '/'}), snapshot({id: '/'}, {document_url: 'https://new.example/', manifest_url: 'https://new.example/m.json'}));
  assert.equal(r.identity_changed, true);
  assert.equal(r.scope_relation, 'disjoint');
});
test('strict snapshot validation rejects typo and unsupported contexts', () => {
  for (const bad of [null, [], {}, snapshot(null), snapshot({}, {typo: 1}), snapshot({}, {document_url: '/relative'}), snapshot({}, {manifest_url: 'file:///x'}), snapshot({}, {document_url: 'https://u:p@example.com/'})]) {
    assert.throws(() => processSnapshot(bad));
  }
  assert.throws(() => processSnapshot(snapshot({start_url: 'blob:https://example.com/a'})));
  assert.throws(() => compareSnapshots(snapshot(), snapshot(), ['file:///x']));
  assert.throws(() => compareSnapshots(snapshot(), snapshot(), {}));
  assert.throws(() => compareSnapshots(snapshot(), snapshot(), Array(10001).fill('https://example.com/')));
});
test('policy is explicit and invalid policy never passes', () => {
  const r = compareSnapshots(snapshot({id: '/'}), snapshot({id: '/', start_url: '/changed'}));
  assert.equal(exitCode(r), 0);
  assert.equal(exitCode(r, 'any'), 1);
  assert.equal(exitCode(r, 'none'), 0);
  assert.equal(exitCode(r, 'identity'), 0);
  assert.throws(() => exitCode(r, 'bogus'));
});

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [join(root, 'bin/cli.js'), ...args], {cwd: root, encoding: 'utf8'});
test('real CLI detects regression and emits parseable JSON', () => {
  const r = cli('examples/before.json', 'examples/after-breaking.json', '--urls', 'examples/urls.json', '--json');
  assert.equal(r.status, 1, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.identity_changed, true);
  assert.equal(report.summary.scope_lost, 1);
});
test('real CLI preserved identity example passes with witnesses', () => {
  const r = cli('examples/before.json', 'examples/after-preserved.json', '--urls', 'examples/urls.json');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Identity: preserved/);
});
test('CLI error modes do not emit a success report', () => {
  for (const args of [[], ['missing', 'missing'], ['--bad'], ['examples/before.json', 'examples/before.json', '--fail-on', 'bogus']]) {
    const r = cli(...args);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
  }
  assert.equal(cli('--version').stdout.trim(), '0.1.0');
  assert.equal(cli('--help').status, 0);
});
test('CLI rejects malformed JSON, oversized input, invalid UTF-8 and directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pwa-id-test-'));
  try {
    const path = join(dir, 'input.json');
    for (const content of ['{oops', Buffer.from([0xff]), ' '.repeat(1024 * 1024 + 1)]) {
      writeFileSync(path, content);
      assert.equal(cli(path, 'examples/before.json').status, 2);
    }
    assert.equal(cli(dir, 'examples/before.json').status, 2);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
