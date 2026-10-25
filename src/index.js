/** Offline implementation of the identity-relevant Web App Manifest algorithms. */
export const VERSION = '0.1.0';

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
}

function absolute(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a URL string`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${label} must be an absolute URL`); }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new TypeError(`${label}: only HTTP(S) deployment URLs are supported`);
  }
  if (url.username || url.password) throw new TypeError(`${label}: credential URLs are unsupported`);
  return url;
}

function member(value, base, origin) {
  if (value === undefined) return {reason: 'missing'};
  if (typeof value !== 'string') return {reason: 'not-string'};
  if (value === '') return {reason: 'empty'};
  let url;
  try { url = new URL(value, base); } catch { return {reason: 'invalid-url'}; }
  if (url.origin !== origin) return {reason: 'cross-origin'};
  // Blob URLs can have the same origin but are outside this tool's HTTP(S) model.
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('HTTP(S) URLs without credentials are required for processed members');
  }
  return {url};
}

export function withinScope(url, scope) {
  const target = absolute(url, 'navigation URL');
  const boundary = absolute(scope, 'scope');
  return target.origin === boundary.origin && target.pathname.startsWith(boundary.pathname);
}

/** A snapshot records the linking document URL separately from the manifest URL. */
export function processSnapshot(snapshot) {
  object(snapshot, 'snapshot');
  for (const key of Object.keys(snapshot)) {
    if (!['manifest', 'manifest_url', 'document_url'].includes(key)) {
      throw new TypeError(`unknown snapshot field: ${key}`);
    }
  }
  object(snapshot.manifest, 'manifest');
  const manifestUrl = absolute(snapshot.manifest_url, 'manifest_url');
  const documentUrl = absolute(snapshot.document_url, 'document_url');
  const raw = snapshot.manifest;
  const fields = {};
  const fallbacks = [];
  function record(field, attempt, fallback) {
    const value = new URL(attempt.url ?? fallback);
    fields[field] = attempt.url ? 'explicit' : 'fallback';
    if (!attempt.url) fallbacks.push({field, reason: attempt.reason});
    return value;
  }
  const start = record('start_url', member(raw.start_url, manifestUrl, documentUrl.origin), documentUrl);
  const id = record('id', member(raw.id, `${start.origin}/`, start.origin), start);
  // Identity comparison deliberately ignores fragments, including the fallback case.
  id.hash = '';
  const scopeAttempt = member(raw.scope, manifestUrl, start.origin);
  if (scopeAttempt.url) {
    scopeAttempt.url.search = '';
    scopeAttempt.url.hash = '';
    if (!withinScope(start.href, scopeAttempt.url.href)) {
      delete scopeAttempt.url;
      scopeAttempt.reason = 'start-outside-scope';
    }
  }
  const scope = record('scope', scopeAttempt, new URL('.', start));
  return {
    manifest_url: manifestUrl.href,
    document_url: documentUrl.href,
    start_url: start.href,
    id: id.href,
    scope: scope.href,
    sources: fields,
    fallbacks,
  };
}

export function compareSnapshots(beforeSnapshot, afterSnapshot, urls = []) {
  if (!Array.isArray(urls) || urls.length > 10000) {
    throw new TypeError('urls must be an array of at most 10000 absolute HTTP(S) URLs');
  }
  const before = processSnapshot(beforeSnapshot);
  const after = processSnapshot(afterSnapshot);
  const changes = [];
  for (const field of ['id', 'start_url', 'scope', 'manifest_url', 'document_url']) {
    if (before[field] !== after[field]) changes.push({field, before: before[field], after: after[field]});
  }
  const navigation = [...new Set(urls.map(url => absolute(url, 'navigation URL').href))].map(url => {
    const oldScope = withinScope(url, before.scope);
    const newScope = withinScope(url, after.scope);
    return {url, before: oldScope, after: newScope,
      change: oldScope === newScope ? 'unchanged' : newScope ? 'gained' : 'lost'};
  });
  const identityChanged = before.id !== after.id;
  const scopeLost = navigation.filter(item => item.change === 'lost').length;
  const scopeGained = navigation.filter(item => item.change === 'gained').length;
  let scopeRelation;
  if (before.scope === after.scope) scopeRelation = 'equal';
  else if (withinScope(after.scope, before.scope)) scopeRelation = 'narrowed';
  else if (withinScope(before.scope, after.scope)) scopeRelation = 'broadened';
  else scopeRelation = 'disjoint';
  return {
    schema_version: 1,
    before,
    after,
    identity_changed: identityChanged,
    scope_relation: scopeRelation,
    changes,
    navigation,
    summary: {navigation_checked: navigation.length, scope_lost: scopeLost, scope_gained: scopeGained,
      regression: identityChanged || scopeLost > 0},
  };
}

export function exitCode(report, failOn = 'regression') {
  if (!['regression', 'identity', 'any', 'none'].includes(failOn)) {
    throw new TypeError('fail-on must be regression, identity, any or none');
  }
  if (failOn === 'none') return 0;
  if (failOn === 'identity') return report.identity_changed ? 1 : 0;
  if (failOn === 'any') return report.changes.length ? 1 : 0;
  return report.summary.regression ? 1 : 0;
}
