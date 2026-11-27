// @ts-check
/**
 * Unit tests for the browser tracker (public/track.js).
 *
 * These matter more than they look. The tracker is the one piece of this system
 * that runs on someone else's website, where a failure is completely silent:
 * the page renders fine and simply records nothing. The previous implementation
 * read `document.currentScript`, which is null whenever the tag is injected
 * dynamically — exactly what next/script, Google Tag Manager and every tag
 * loader do — so the documented Next.js install recorded zero events.
 *
 * Run with:  npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SOURCE = readFileSync(join(process.cwd(), 'public', 'track.js'), 'utf-8');

/**
 * Runs track.js in a minimal fake browser and returns the environment so the
 * test can inspect what was sent.
 *
 * @param {object} [options]
 */
function runTracker(options = {}) {
  const {
    href = 'https://example.com/pricing?utm_source=hn',
    referrer = 'https://news.ycombinator.com/item?id=1',
    currentScript = null,
    injectedScripts = [],
    doNotTrack = null,
    sendBeacon = true,
  } = options;

  /** @type {Array<{ url: string, body: any }>} */
  const beacons = [];
  /** @type {Array<{ url: string, init: any }>} */
  const fetches = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<string, Function[]>} */
  const listeners = new Map();

  const parsed = new URL(href);
  const location = {
    href,
    pathname: parsed.pathname,
    search: parsed.search,
  };

  const history = {
    pushState() {},
    replaceState() {},
  };

  const document = {
    currentScript,
    referrer,
    querySelector(selector) {
      if (selector.includes('src*="track.js"')) {
        return injectedScripts.find((s) => s.src?.includes('track.js')) ?? null;
      }
      if (selector.includes('data-site-id')) return injectedScripts[0] ?? null;
      return null;
    },
  };

  const sandbox = {
    document,
    location,
    history,
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36',
      doNotTrack,
      ...(sendBeacon
        ? {
            sendBeacon(target, body) {
              beacons.push({ url: target, body: JSON.parse(body) });
              return true;
            },
          }
        : {}),
    },
    fetch(target, init) {
      fetches.push({ url: target, init });
      return Promise.resolve({ ok: true });
    },
    addEventListener(type, handler) {
      const existing = listeners.get(type) ?? [];
      existing.push(handler);
      listeners.set(type, existing);
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) ?? []) handler(event);
    },
    URL,
    URLSearchParams,
    console: {
      warn: (message) => warnings.push(String(message)),
      log: () => {},
      error: () => {},
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'track.js' });

  return { sandbox, beacons, fetches, warnings, location, history, listeners };
}

/** A stand-in for the <script> element the tracker reads attributes from. */
function scriptTag(attrs) {
  return {
    src: attrs.src ?? 'https://analytics.example.com/track.js',
    getAttribute(name) {
      return attrs[name] ?? null;
    },
  };
}

/** Moves the fake browser to a new URL and fires a pushState. */
function navigate(sandbox, nextHref) {
  const parsed = new URL(nextHref, 'https://example.com');
  sandbox.location.href = nextHref;
  sandbox.location.pathname = parsed.pathname;
  sandbox.location.search = parsed.search;
  sandbox.window.history.pushState({}, '', nextHref);
}

// ---------------------------------------------------------------------------

test('records a pageview with path, referrer and UTM parameters', () => {
  const { beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });

  assert.equal(beacons.length, 1);
  const payload = beacons[0].body;
  assert.equal(payload.siteId, 'my-site');
  assert.equal(payload.path, '/pricing');
  assert.equal(payload.referrer, 'https://news.ycombinator.com');
  assert.equal(payload.eventType, 'pageview');
  assert.equal(payload.utmSource, 'hn');
});

test('never sends the query string, only the three UTM parameters', () => {
  // Query strings carry emails, tokens, order ids and search terms. None of it
  // may leave the visitor's browser.
  const { beacons } = runTracker({
    href: 'https://example.com/checkout?email=jane%40example.com&token=s3cr3t&q=my+illness&utm_source=news&utm_medium=email&utm_campaign=spring',
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });

  assert.equal(beacons.length, 1);
  const payload = beacons[0].body;
  assert.equal(payload.path, '/checkout');
  assert.equal(payload.utmSource, 'news');
  assert.equal(payload.utmMedium, 'email');
  assert.equal(payload.utmCampaign, 'spring');

  const wire = JSON.stringify(payload);
  for (const leaked of ['jane', 'example.com%40', 's3cr3t', 'illness', 'email=', 'token=', '?']) {
    assert.ok(!wire.includes(leaked), `payload must not contain "${leaked}": ${wire}`);
  }
});

test('reduces the referrer to its origin before sending', () => {
  const { beacons } = runTracker({
    referrer: 'https://search.example.org/results?q=my+medical+question&user=jane%40example.com#top',
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });

  const wire = JSON.stringify(beacons[0].body);
  assert.equal(beacons[0].body.referrer, 'https://search.example.org');
  assert.ok(!wire.includes('medical') && !wire.includes('jane'), `leaked referrer detail: ${wire}`);
});

test('omits a referrer that is not an http(s) URL', () => {
  for (const referrer of ['', 'android-app://com.example.app', 'not a url']) {
    const { beacons } = runTracker({
      referrer,
      currentScript: scriptTag({ 'data-site-id': 'my-site' }),
    });
    assert.equal(beacons[0].body.referrer, undefined, `referrer "${referrer}" should be omitted`);
  }
});

test('finds the script tag when document.currentScript is null', () => {
  // Regression test for the original bug: next/script with
  // strategy="afterInteractive" injects the tag, so currentScript is null.
  const { beacons, warnings } = runTracker({
    currentScript: null,
    injectedScripts: [scriptTag({ 'data-site-id': 'injected-site' })],
  });

  assert.equal(warnings.length, 0, 'should not warn about a missing site id');
  assert.equal(beacons.length, 1, 'should still record the pageview');
  assert.equal(beacons[0].body.siteId, 'injected-site');
});

test('stays silent rather than throwing when no script tag can be found', () => {
  const { beacons } = runTracker({ currentScript: null, injectedScripts: [] });
  assert.equal(beacons.length, 0);
});

test('warns and records nothing when data-site-id is absent', () => {
  const { beacons, warnings } = runTracker({ currentScript: scriptTag({}) });
  assert.equal(beacons.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /data-site-id/);
});

test('honours Do Not Track', () => {
  const { beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
    doNotTrack: '1',
  });
  assert.equal(beacons.length, 0, 'no events when DNT is set');
});

test('records normally when Do Not Track is unset', () => {
  const { beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
    doNotTrack: null,
  });
  assert.equal(beacons.length, 1);
});

test('exposes window.trackEvent for custom events', () => {
  const { sandbox, beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });

  beacons.length = 0;
  assert.equal(typeof sandbox.window.trackEvent, 'function');

  sandbox.window.trackEvent('signup_completed');
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].body.eventType, 'custom');
  assert.equal(beacons[0].body.eventName, 'signup_completed');
});

test('trackEvent ignores an empty name', () => {
  const { sandbox, beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });
  beacons.length = 0;
  sandbox.window.trackEvent('');
  assert.equal(beacons.length, 0);
});

test('records a second pageview after a pushState navigation', () => {
  const { sandbox, beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });
  assert.equal(beacons.length, 1);

  navigate(sandbox, '/docs');

  assert.equal(beacons.length, 2, 'pushState should record a second pageview');
  assert.equal(beacons[1].body.path, '/docs');
});

test('does not double-count a pushState to the same URL', () => {
  const { sandbox, beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });
  assert.equal(beacons.length, 1);

  // Frameworks call pushState/replaceState repeatedly for the same URL during
  // hydration, scroll restoration and query normalisation. Only real
  // navigations should count, or a single page load reports several views.
  sandbox.window.history.pushState({}, '', '/pricing?utm_source=hn');
  sandbox.window.history.replaceState({}, '', '/pricing?utm_source=hn');
  sandbox.window.history.pushState({}, '', '/pricing?utm_source=hn');

  assert.equal(beacons.length, 1, 'same-URL navigations must not be counted again');
});

test('a query-only change on the same pathname is not a new pageview', () => {
  const { sandbox, beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });
  assert.equal(beacons.length, 1);

  // Only the pathname is recorded, so changing ?page= or having a framework
  // strip ?utm_source after load must not report a second view of the same page.
  navigate(sandbox, '/pricing?page=2');
  navigate(sandbox, '/pricing');

  assert.equal(beacons.length, 1, 'same pathname must not be counted again');
});

test('records a pageview on popstate', () => {
  const { sandbox, beacons, location } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });

  location.pathname = '/back';
  location.search = '';
  sandbox.window.dispatchEvent({ type: 'popstate' });

  assert.equal(beacons.length, 2);
  assert.equal(beacons[1].body.path, '/back');
});

test('derives the collect endpoint from the script src', () => {
  const { beacons } = runTracker({
    currentScript: scriptTag({
      'data-site-id': 'my-site',
      src: 'https://analytics.example.com/track.js',
    }),
  });
  assert.equal(beacons[0].url, 'https://analytics.example.com/api/collect');
});

test('an explicit data-endpoint overrides the derived one', () => {
  const { beacons } = runTracker({
    currentScript: scriptTag({
      'data-site-id': 'my-site',
      'data-endpoint': 'https://custom.example.com/ingest',
    }),
  });
  assert.equal(beacons[0].url, 'https://custom.example.com/ingest');
});

test('falls back to fetch when sendBeacon is unavailable', () => {
  const { sandbox, fetches, beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
    sendBeacon: false,
  });

  assert.equal(beacons.length, 0, 'sendBeacon is not available in this run');
  assert.equal(fetches.length, 1, 'should have used fetch');
  assert.equal(fetches[0].init.method, 'POST');
  assert.equal(fetches[0].init.keepalive, true);
  assert.equal(fetches[0].init.headers['Content-Type'], 'text/plain');
});

test('never throws when sendBeacon itself throws', () => {
  const { sandbox } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });

  sandbox.navigator.sendBeacon = () => {
    throw new Error('blocked by an extension');
  };

  assert.doesNotThrow(() => {
    navigate(sandbox, '/after-block');
  }, 'analytics must never break the host page');
});

test('keeps sending after a failed navigation', () => {
  const { sandbox, beacons } = runTracker({
    currentScript: scriptTag({ 'data-site-id': 'my-site' }),
  });

  sandbox.navigator.sendBeacon = () => {
    throw new Error('transient failure');
  };
  navigate(sandbox, '/fails');

  // Restore and confirm the tracker still works afterwards.
  sandbox.navigator.sendBeacon = (target, body) => {
    beacons.push({ url: target, body: JSON.parse(body) });
    return true;
  };
  navigate(sandbox, '/recovers');

  assert.equal(beacons.length, 2, 'original pageview plus the recovered one');
  assert.equal(beacons[1].body.path, '/recovers');
});
