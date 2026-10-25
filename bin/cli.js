#!/usr/bin/env node
import {openSync, fstatSync, readSync, closeSync} from 'node:fs';
import {TextDecoder} from 'node:util';
import {parseArgs} from 'node:util';
import {compareSnapshots, exitCode, VERSION} from '../src/index.js';

const HELP = `pwa-identity-diff BEFORE.json AFTER.json [--urls URLS.json] [--json]
  --fail-on regression|identity|any|none  (default: regression)
  --version                            Print version
  --help                               Print help
Snapshots contain manifest, manifest_url, document_url. No network requests.
Exit: 0 pass, 1 selected change/regression, 2 input or usage error.`;

function readJson(path) {
  const max = 1024 * 1024;
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > max) throw new Error('inputs must be regular files of at most 1 MiB');
    const buffer = Buffer.alloc(max + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = readSync(fd, buffer, used, buffer.length - used, null);
      if (!count) break;
      used += count;
    }
    if (used > max) throw new Error('input exceeds 1 MiB');
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(0, used)));
  } finally { closeSync(fd); }
}

try {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    json: {type: 'boolean'}, urls: {type: 'string'}, 'fail-on': {type: 'string', default: 'regression'},
    help: {type: 'boolean'}, version: {type: 'boolean'},
  }});
  if (values.help) console.log(HELP);
  else if (values.version) console.log(VERSION);
  else {
    if (positionals.length !== 2) throw new Error(HELP);
    const report = compareSnapshots(readJson(positionals[0]), readJson(positionals[1]),
      values.urls ? readJson(values.urls) : []);
    const code = exitCode(report, values['fail-on']);
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Identity: ${report.identity_changed ? 'CHANGED' : 'preserved'}`);
      console.log(`  before: ${JSON.stringify(report.before.id)}`);
      console.log(`  after:  ${JSON.stringify(report.after.id)}`);
      console.log(`Navigation scope: ${report.scope_relation}`);
      for (const change of report.changes) console.log(`  ${change.field}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
      for (const side of ['before', 'after']) {
        for (const item of report[side].fallbacks) console.log(`  ${side}.${item.field}: fallback (${item.reason})`);
      }
      for (const item of report.navigation) console.log(`  ${item.change}: ${JSON.stringify(item.url)}`);
      console.log(`${report.summary.navigation_checked} navigation URLs checked; ${report.summary.scope_lost} lost, ${report.summary.scope_gained} gained.`);
    }
    process.exitCode = code;
  }
} catch (error) {
  console.error(`pwa-identity-diff: ${JSON.stringify(error.message)}`);
  process.exitCode = 2;
}
