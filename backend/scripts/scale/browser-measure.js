// Measures what a visitor's browser does with the app, at whatever dataset size the server behind it holds.
// It is a console script, not a module: open the app (an already loaded page, with a map that exposes
// `window.__map`, see docs/scale.md), paste this into the console (or evaluate it with a browser tool) and it
// resolves to a plain object. Nothing is sent anywhere.
//
// It times, with the main thread's own clock:
//   load      how long until pins are on the map and the page is quiet; API calls and bytes; DOM nodes; heap; long tasks
//   zoomIn    the map flies to street level in the Sydney CBD, the densest place there is
//   zoomOut   and back out to all of Australia
//   list      the List tab: how long, how many cards, how many DOM nodes
//   profile   opening a company from the list
//   map       coming back to the map
//   jobs      the Jobs view
//   search    typing "cob" at about 12 keys a second: how many requests that makes, and when the page settles
//             (last, because it leaves work queued behind it on a slow device)
// "Quiet" means no request in flight and no change to the page (tiles aside) for 300 ms. A long task is
// main-thread work over 50 ms, which a visitor feels as the page not answering.
(async () => {
  // Third-party images (logos from Clearbit and Google, map tiles) are blocked from here on, unless the driver has
  // already blocked them at the network (window.__blockImages === false): what is measured is this app's work, not
  // other people's servers, and no fake company's address is sent to anyone.
  if (window.__blockImages !== false) {
    const csp = document.createElement('meta');
    csp.httpEquiv = 'Content-Security-Policy';
    csp.content = "img-src 'self' data: blob:";
    document.head.append(csp);
  }
  const knob = (name, fallback) => (typeof window[name] === 'number' ? window[name] : fallback);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (n) => Math.round(n);
  const out = { url: location.href, viewport: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio, at: new Date().toISOString() };
  const pins = () => document.querySelectorAll('.leaflet-marker-icon').length;
  const api = () => performance.getEntriesByType('resource').filter((e) => /\/api\/|\/directory/.test(e.name));
  const heap = () => (performance.memory ? round(performance.memory.usedJSHeapSize / 1048576) : null);
  const nodes = () => document.getElementsByTagName('*').length;
  const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);

  // Everything the page asks of the server from here on is counted.
  let inflight = 0;
  const calls = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    inflight += 1;
    const t0 = performance.now();
    return realFetch(...args).then((r) => { calls.push({ url: String(args[0]).replace(location.origin, ''), ms: round(performance.now() - t0), status: r.status }); return r; }).finally(() => { inflight -= 1; });
  };
  let lastChange = performance.now();
  let firstChange = null;
  // While a step runs, what kinds of node changed and how often. Only a step that never goes quiet reports it:
  // it is how a page that redraws something thousands of times a second shows up in a measurement.
  let trace = null;
  const describe = (n) => {
    if (!n) return '?';
    if (n.nodeType === 3) return `text in ${describe(n.parentElement)}`;
    const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${cls ? `.${cls}` : ''}`;
  };
  new MutationObserver((records) => {
    if (records.some((m) => !(m.target.closest && m.target.closest('.leaflet-tile-pane')))) {
      lastChange = performance.now();
      if (firstChange === null) firstChange = lastChange;
    }
    if (trace) {
      for (const m of records) {
        const key = `${m.type} ${describe(m.target)}${m.attributeName ? ` @${m.attributeName}` : ''}`;
        if (trace.has(key) || trace.size < 30) trace.set(key, (trace.get(key) ?? 0) + 1);
      }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  // The whole run has to fit in the time a browser tool allows, so each wait is capped and a step that would start
  // too late is skipped and says so. A step that never goes quiet within its cap is itself a result.
  const budget = performance.now() + knob('__budgetMs', 36000);
  const quiet = async (ms = 300, cap = knob('__quietCapMs', 7000)) => {
    const start = performance.now();
    while (performance.now() - start < cap) {
      if (inflight === 0 && performance.now() - lastChange > ms) return true;
      await sleep(15);
    }
    return false;
  };
  // How long the main thread was held up while something happened: long tasks (where the browser reports them) and,
  // independently, a 10 ms heartbeat whose gaps show any stretch the page could not answer a click.
  out.longTaskSupported = Boolean(PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes('longtask'));
  const tasksDuring = () => {
    const seen = [];
    const po = new PerformanceObserver((list) => seen.push(...list.getEntries()));
    if (out.longTaskSupported) po.observe({ type: 'longtask' });
    let last = performance.now();
    let worst = 0;
    let blocked = 0;
    const beat = setInterval(() => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      if (gap > worst) worst = gap;
      if (gap > 60) blocked += gap - 10;
    }, 10);
    return () => {
      clearInterval(beat);
      if (out.longTaskSupported) po.takeRecords().forEach((e) => seen.push(e));
      po.disconnect();
      return { longTasks: seen.length, blockedMs: round(blocked), worstGapMs: round(worst) };
    };
  };
  // `until` says what the step is meant to put on the page. A step is over when that is there and the page has gone
  // quiet, not when the page first goes quiet: an answer that is slow to arrive leaves the page quiet for a while
  // before anything is drawn, and a step that stopped there would miss the drawing, which is where the time goes.
  const step = async (name, action, extra = () => ({}), until = null) => {
    if (performance.now() > budget - 3500) { out[name] = { skipped: 'out of time' }; return; }
    const before = calls.length;
    const stop = tasksDuring();
    lastChange = performance.now();
    firstChange = null;
    trace = new Map();
    const t0 = performance.now();
    await action();
    await sleep(30);
    let shown = true;
    if (until) {
      const deadline = performance.now() + knob('__untilCapMs', 90000);
      while (!until() && performance.now() < deadline) await sleep(20);
      shown = Boolean(until());
    }
    const settled = await quiet(300);
    const ms = round(performance.now() - t0 - 300);
    const changing = settled ? undefined : [...trace].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([what, n]) => `${what} x${n}`);
    trace = null;
    out[name] = { reactedMs: firstChange === null ? null : round(firstChange - t0), quietMs: Math.max(0, ms), settled, ...(shown ? {} : { neverShown: true }), requests: calls.length - before, ...stop(), ...extra(), heapMb: heap(), domNodes: nodes(), ...(changing ? { stillChanging: changing } : {}) };
  };

  // ---- load: the page is already loaded; read how it went
  let first = null;
  let last = pins();
  let stableSince = performance.now();
  const began = performance.now();
  while (performance.now() - began < knob('__loadCapMs', 9000)) {
    const n = pins();
    if (n > 0 && first === null) first = performance.now();
    if (n !== last) { last = n; stableSince = performance.now(); }
    if (first !== null && performance.now() - stableSince > 600) break;
    await sleep(20);
  }
  const tasks = await new Promise((resolve) => {
    const seen = [];
    const po = new PerformanceObserver((list) => seen.push(...list.getEntries()));
    po.observe({ type: 'longtask', buffered: true });
    setTimeout(() => { po.disconnect(); resolve(seen); }, 60);
  });
  const nav = performance.getEntriesByType('navigation')[0];
  const mine = api();
  // A driver that can run code before the page does (cdp-bench.js) watches the map from the first moment, so
  // when the pins first appeared is known exactly; pasted into a console it is when this script first looked.
  const watched = window.__pinWatch;
  out.load = {
    pinsFirstSeenMs: watched && watched.first !== null ? round(watched.first) : first === null ? null : round(first),
    pinsLastChangedMs: watched && watched.last !== null ? round(watched.last) : null, lastApiResponseEndMs: round(Math.max(0, ...mine.map((e) => e.responseEnd))),
    lastLongTaskEndMs: round(Math.max(0, ...tasks.map((e) => e.startTime + e.duration))), loadEventMs: round(nav.loadEventEnd),
    requests: mine.length, wireKB: round(sum(mine, (e) => e.transferSize || 0) / 1024), bodyKB: round(sum(mine, (e) => e.decodedBodySize || 0) / 1024),
    longTasks: { count: tasks.length, totalMs: round(sum(tasks, (e) => e.duration)), longestMs: round(Math.max(0, ...tasks.map((e) => e.duration))) },
    pinsOnScreen: pins(), heapMb: heap(), domNodes: nodes(),
  };

  const map = window.__map;
  if (map) {
    await step('zoomIn', async () => { map.setView([-33.8688, 151.2093], 15, { animate: false }); }, () => ({ pinsOnScreen: pins() }));
    await step('zoomOut', async () => { map.setView([-33.0, 145.0], 5, { animate: false }); }, () => ({ pinsOnScreen: pins() }));
  }

  // The order matters. Typing in the search box leaves the app with work still queued behind it on a slow phone
  // (it re-filters for "c", "co" and "cob" one after another), so it goes last: anything measured after it would
  // be measuring that backlog, and a list opened while the box still says "cob" would show a handful of companies.
  const tab = (text) => [...document.querySelectorAll('.bc-tab')].find((b) => b.textContent.trim().startsWith(text));
  if (tab('List')) {
    await step('list', async () => { tab('List').click(); }, () => ({ cards: document.querySelectorAll('.startup-card').length }), () => document.querySelector('.startup-card'));
    const card = document.querySelector('.startup-card');
    if (card) await step('profile', async () => { card.click(); await sleep(0); }, () => ({ panelShown: Boolean(document.querySelector('.sdp-panel')), loadingNote: Boolean(document.querySelector('.sdp-loading')) }), () => document.querySelector('.sdp-panel'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await quiet(300);
    await step('map', async () => { tab('Map').click(); }, () => ({ pinsOnScreen: pins() }), () => pins() > 0);
  }

  const jobsLink = [...document.querySelectorAll('.nav-link')].find((b) => b.textContent.trim().startsWith('Jobs'));
  if (jobsLink) {
    await step('jobs', async () => { jobsLink.click(); }, () => ({ cards: document.querySelectorAll('.job-card').length }), () => document.querySelector('.job-card'));
    const back = [...document.querySelectorAll('button')].find((b) => /back to map/i.test(b.textContent));
    if (back) {
      back.click();
      const cap = performance.now() + knob('__loadCapMs', 9000);
      while (pins() === 0 && performance.now() < cap) await sleep(20);
      await quiet(600);
    }
  }

  const box = document.querySelector('.floating-search input');
  const setValue = (v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, v);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };
  if (box) {
    const bytesBefore = sum(api(), (e) => e.transferSize || 0);
    await step('search', async () => { for (const text of ['c', 'co', 'cob']) { setValue(text); await sleep(80); } }, () => ({ pinsOnScreen: pins() }));
    out.search.wireKB = round((sum(api(), (e) => e.transferSize || 0) - bytesBefore) / 1024);
  }

  out.requests = calls.slice(0, 40);
  return JSON.stringify(out);
})()
