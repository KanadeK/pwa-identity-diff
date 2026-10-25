# pwa-identity-diff

Compare two Web App Manifest snapshots before deploying an update. Catch an
accidental new app identity and show which supplied navigation URLs leave scope.
Runs locally with **Node.js 20+ and no dependencies**. No browser, server or network.

[中文说明](README.zh-CN.md) · [MIT](LICENSE)

Changing `/app/?source=installed` to `/workspace/` without a stable `id` changes
the computed app identity. A generic JSON diff cannot tell whether a relative ID,
default port, fallback or fragment changes the effective identity. This tool can.

## Install and run

Clone the repository, then run the CLI directly (no installation step required):

```sh
git clone https://github.com/KanadeK/pwa-identity-diff.git
cd pwa-identity-diff
node bin/cli.js examples/before.json examples/after-breaking.json --urls examples/urls.json
```

This intentionally exits **1**: identity changed and one supplied navigation URL
left scope. To preserve the old identity while changing the launch location:

```sh
node bin/cli.js examples/before.json examples/after-preserved.json --urls examples/urls.json --json
```

This exits **0** and emits JSON. The example preserves the old computed ID and
broadens navigation scope; choose a scope appropriate for your actual app.

Optional installation from the cloned source:

```sh
npm install --global .
pwa-identity-diff examples/before.json examples/after-preserved.json
npm uninstall --global pwa-identity-diff
```

No npm registry publication is assumed. For direct use, cleanup is simply removal
of your clone; the program creates no cache or application data.

## Snapshot format

Save one snapshot for each release, using the actual public URL of the manifest
and of the HTML document that links to it. Both URLs are required; they can have
different origins. `manifest` is the actual manifest JSON object, with any fields.

```json
{
  "manifest_url": "https://example.com/assets/manifest.webmanifest",
  "document_url": "https://example.com/app/",
  "manifest": {"start_url": "/app/", "id": "/stable-app", "scope": "/app/"}
}
```

The optional `--urls` file is a JSON array of absolute HTTP(S) navigation URLs.
These are evaluated against both effective scopes without fetching them.
Repeated normalized URLs are checked once. Snapshot envelope fields are strict
to catch misspellings; unrelated manifest fields are ignored.

## Reports and CI

JSON schema version 1 includes both processed snapshots, field provenance,
fallback reasons, identity change, exact URL changes, scope relation
(`equal`, `narrowed`, `broadened`, `disjoint`) and each navigation witness.
Human output quotes input strings so control characters cannot alter the terminal.

| Policy | Exit 1 when |
|---|---|
| `--fail-on regression` (default) | Identity changes or a supplied URL leaves scope |
| `--fail-on identity` | Computed identity changes |
| `--fail-on any` | Any effective ID/start/scope/manifest/document URL changes |
| `--fail-on none` | Never for valid input (report only) |

Exit **2** always means malformed/unsupported input or a usage error.
Narrowing scope without supplied witnesses is reported, but does not itself fail
the default policy. Use `--fail-on any` for a stricter gate.

```sh
node bin/cli.js old-snapshot.json new-snapshot.json --urls critical-routes.json --json
```

Library use:

```js
import {compareSnapshots, processSnapshot} from './src/index.js';
const effective = processSnapshot(oldSnapshot);
const report = compareSnapshots(oldSnapshot, newSnapshot, navigationUrls);
```

## Processing model and limits

Implements the identity-related parts of the
[W3C Web Application Manifest draft dated 2026-10-16](https://www.w3.org/TR/2026/WD-appmanifest-20261016/):
start resolves from the manifest URL and must share the document origin;
ID resolves from the start origin; scope resolves from the manifest URL.
Invalid members fall back with a reason in the report. Identity comparison
ignores fragments, including when ID falls back to start. Query strings remain
significant. Node's WHATWG `URL` handles normalization. Scope compares origin and
serialized path prefix: `/app` includes `/application`, whereas `/app/` does not.

This is a release comparison, not an installation or browser compatibility test.
It cannot determine what is already installed, browser-specific update policy,
redirects, service-worker scope/cache behavior, network availability, manifest
discovery, CORS or installability. It does not migrate installed applications.
Legacy browsers may use other identity rules. Only HTTP(S) deployment contexts
and processed members without credentials are supported. Snapshot inputs are
UTF-8 JSON, at most 1 MiB each; navigation lists are capped at 10,000 entries.
JSON duplicate properties use standard JSON.parse last-value semantics.
Reports contain supplied URLs, so do not share private snapshots indiscriminately.

## Why another tool?

[PWABuilder](https://github.com/pwa-builder/PWABuilder) and browser DevTools help
build and inspect an app. [pwa-offline-check](https://github.com/INNERLUXES/pwa-offline-check)
audits a built folder. This tool compares **two releases and their deployment
contexts**, explaining a preserved or changed identity and navigation witnesses.
The [WICG migration explainer](https://github.com/WICG/manifest-incubations/blob/gh-pages/pwa-migration-explainer.md)
describes why accidental identity splits matter. No implementation is copied.

## Development

```sh
npm test
npm run check
npm pack --dry-run
```

Tests cover URL processing, fallbacks, Unicode/IDN, ports, query/fragment rules,
scope relations, origin moves, invalid inputs, policy and actual CLI workflows.
CI runs on Windows and Linux with Node 20, 22 and 24.
