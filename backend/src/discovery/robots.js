// robots.txt, read the way RFC 9309 describes: which paths a crawler may fetch.
//
//   - Rules are grouped by User-agent. A crawler uses the group naming its own
//     product token (the longest such name), else the "*" group.
//   - Within a group the longest matching pattern wins, and Allow wins a tie.
//   - "*" matches any run of characters and a trailing "$" anchors the end.
//   - An empty Disallow allows everything.
//   - Crawl-delay is not in the RFC but is widely published and honoured.

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let inAgents = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || !inAgents) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      inAgents = true;
      continue;
    }
    inAgents = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') current.rules.push({ allow: field === 'allow', pattern: value });
    else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups };
}

// The groups that apply to this crawler: those naming its token most specifically,
// or the "*" groups when none does.
function groupsFor(robots, productToken) {
  const token = productToken.toLowerCase();
  let best = 0;
  for (const g of robots.groups) for (const a of g.agents) if (a !== '*' && a && token.startsWith(a)) best = Math.max(best, a.length);
  if (best > 0) return robots.groups.filter((g) => g.agents.some((a) => a !== '*' && a.length === best && token.startsWith(a)));
  return robots.groups.filter((g) => g.agents.includes('*'));
}

function matches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(`^${body.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return re.test(path);
}

export function isAllowed(robots, productToken, pathWithQuery) {
  let verdict = null;
  for (const g of groupsFor(robots, productToken)) {
    for (const rule of g.rules) {
      if (!rule.pattern) continue; // an empty Allow or Disallow says nothing
      if (!matches(rule.pattern, pathWithQuery)) continue;
      const length = rule.pattern.length;
      if (!verdict || length > verdict.length || (length === verdict.length && rule.allow && !verdict.allow)) verdict = { allow: rule.allow, length };
    }
  }
  return verdict ? verdict.allow : true;
}

// Seconds the site asks crawlers to wait between requests, or null.
export function crawlDelay(robots, productToken) {
  const delays = groupsFor(robots, productToken).map((g) => g.crawlDelay).filter((d) => d != null);
  return delays.length ? Math.max(...delays) : null;
}
