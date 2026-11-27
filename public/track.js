/*!
 * Analytics tracker — cookie-free, no persistent identifiers.
 * https://github.com/your-org/analytics
 */
(function () {
  'use strict';

  // `document.currentScript` is null when the tag is injected dynamically —
  // which is exactly what next/script, Google Tag Manager and every tag loader
  // do. Falling back to a DOM lookup is what makes the documented Next.js
  // install work at all. Note this must run before any `await`, since
  // currentScript is only valid during synchronous execution.
  var script =
    document.currentScript ||
    document.querySelector('script[data-site-id][src*="track.js"]') ||
    document.querySelector('script[data-site-id]');

  if (!script) return;

  var siteId = script.getAttribute('data-site-id');
  if (!siteId) {
    console.warn('[analytics] Missing data-site-id attribute on the script tag.');
    return;
  }

  var endpoint =
    script.getAttribute('data-endpoint') ||
    (script.src ? script.src.split('/track.js')[0] + '/api/collect' : '/api/collect');

  // Respect the (non-standard but widely honoured) opt-out signals.
  var dnt =
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1' ||
    navigator.msDoNotTrack === '1';
  if (dnt) return;

  function send(payload) {
    try {
      var body = JSON.stringify(payload);
      // sendBeacon survives page unload, which is what makes the last pageview
      // of a session count. It cannot set Content-Type, hence text/plain — the
      // server parses the text as JSON.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, body);
      } else {
        fetch(endpoint, {
          method: 'POST',
          body: body,
          keepalive: true,
          headers: { 'Content-Type': 'text/plain' },
        })['catch'](function () {});
      }
    } catch (e) {
      /* Analytics must never break the host page. */
    }
  }

  // Only the three marketing parameters are ever read from the query string.
  // Nothing else in it leaves the visitor's browser: query strings routinely
  // carry email addresses, tokens, order ids and search terms.
  function utm(name) {
    try {
      return new URLSearchParams(location.search).get(name) || undefined;
    } catch (e) {
      return undefined;
    }
  }

  // The referrer is reduced to its origin ("https://news.ycombinator.com")
  // before sending. The full referrer URL can contain a query string with
  // personal data, and the dashboard only ever needs the domain.
  function referrerOrigin() {
    try {
      var ref = document.referrer;
      if (!ref) return undefined;
      var url = new URL(ref);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
      return url.origin;
    } catch (e) {
      return undefined;
    }
  }

  // Last path recorded. pushState/replaceState are routinely called for the
  // same URL (scroll restoration, query normalisation, framework internals), so
  // without this a single navigation would be counted several times. Compared
  // by pathname only, which also means a framework stripping ?utm_* from the
  // address bar after load does not register as a second pageview.
  var lastPath = null;

  function trackPageview() {
    var path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;

    send({
      siteId: siteId,
      path: path,
      referrer: referrerOrigin(),
      eventType: 'pageview',
      utmSource: utm('utm_source'),
      utmMedium: utm('utm_medium'),
      utmCampaign: utm('utm_campaign'),
    });
  }

  /** window.trackEvent('signup_clicked', { plan: 'pro' }) */
  window.trackEvent = function (name, props) {
    if (!name) return;
    send({
      siteId: siteId,
      path: location.pathname,
      eventType: 'custom',
      eventName: String(name),
      // Reserved for a future properties column; ignored by the server today.
      props: props || undefined,
    });
  };

  trackPageview();

  // SPA navigations. pushState/replaceState do not fire popstate, so both the
  // patched call and the listener are needed to avoid missing either kind.
  function onNavigate() {
    trackPageview();
  }

  if (window.history && window.history.pushState) {
    var pushState = window.history.pushState;
    window.history.pushState = function () {
      var result = pushState.apply(this, arguments);
      onNavigate();
      return result;
    };

    var replaceState = window.history.replaceState;
    window.history.replaceState = function () {
      var result = replaceState.apply(this, arguments);
      onNavigate();
      return result;
    };
  }

  window.addEventListener('popstate', onNavigate);
})();
