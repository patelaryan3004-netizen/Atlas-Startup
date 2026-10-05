// A publisher's RSS/Atom feed as a source of funding announcements. Only the
// headline, the link, the date and a short excerpt are read, and only the
// headline and link are kept, with the publisher credited. The page the link
// points at is never fetched.
//
// A funding story rarely hands over a clean company name, so extraction favours
// precision over recall. It reads the excerpt first, because Startup Daily's
// excerpts open with the company ("Trendspek grabs $6M ..."), then the headline
// ("Asset analysis platform Trendspek banks $6 million ..."), and gives up on
// roundups ("3 startups pocket $18.75 million"), lists, and headlines that do
// not name the company at all. What it finds is a lead with low confidence for
// the rest of the pipeline to check, not a fact.
import { decodeEntities, stripTags } from '../html.js';
import { FEED_TYPES } from '../http.js';

// ---------- reading the feed ----------

const tag = (block, name) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : '';
};
const text = (s) => stripTags(decodeEntities(s));

export function parseFeed(xml) {
  const items = [];
  const rss = /<item\b[\s\S]*?<\/item>/gi;
  const atom = /<entry\b[\s\S]*?<\/entry>/gi;
  for (const block of [...(String(xml).match(rss) ?? []), ...(String(xml).match(atom) ?? [])]) {
    const link = text(tag(block, 'link')) || (/<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(block)?.[1] ?? '');
    const date = text(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date'));
    const parsed = date ? new Date(date) : null;
    const title = text(tag(block, 'title'));
    if (!title || !link) continue;
    items.push({
      title,
      link,
      guid: text(tag(block, 'guid') || tag(block, 'id')) || link,
      published: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      excerpt: text(tag(block, 'description') || tag(block, 'summary')).slice(0, 600),
    });
  }
  return items;
}

// ---------- finding the company in a funding story ----------

const VERBS = '(?:raises?|raised|secures?|secured|closes?|closed|lands?|landed|grabs?|grabbed|bags?|bagged|banks?|banked|pockets?|pocketed|nabs?|nabbed|snags?|snagged|scores?|scored|lifts?|lifted|nails?|nailed|cements?|cemented|books?|booked|hauls?|hauled|attracts?|attracted|receives?|received|gets|wins?)';
const AMOUNT = '(?:A\\$|AU\\$|US\\$|NZ\\$|\\$|£|€)\\s?\\d[\\d.,]*\\s?(?:[kKmMbB]|[mM][nN]|[bB][nN]|[mM]illion|[bB]illion)?\\b';
const WORD = '[A-Z0-9][\\w.&\'’-]*';
const NAME = `${WORD}(?:\\s+(?:${WORD}|of|the|and|&)){0,3}`;

// Words that say what a company is or where it is, not what it is called.
const DESCRIPTORS = new Set([
  'startup', 'startups', 'scale-up', 'scaleup', 'platform', 'company', 'business', 'firm', 'outfit', 'developer', 'maker', 'spinout',
  'play', 'player', 'biotech', 'medtech', 'fintech', 'healthtech', 'edtech', 'agtech', 'proptech', 'insurtech', 'regtech', 'legaltech',
  'martech', 'cleantech', 'climate', 'robotics', 'software', 'app', 'marketplace', 'ai', 'saas', 'tool', 'provider', 'operator', 'brand',
  'retailer', 'label', 'network', 'service', 'lab', 'labs', 'tech', 'venture', 'unicorn', 'giant', 'challenger', 'upstart', 'newcomer',
]);
const STOP = new Set([
  'australian', 'aussie', 'australia', 'local', 'new', 'this', 'that', 'the', 'how', 'why', 'what', 'who', 'meet', 'cheque-in', 'exclusive',
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'canberra', 'hobart', 'darwin', 'queensland', 'victorian', 'tasmanian', 'nsw',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'government', 'federal', 'state', 'big', 'top', 'another',
  'startup', 'startups', 'company', 'fund', 'fintech', 'ai', 'it', 'its', 'a', 'an',
]);
const NOT_A_FUNDING_STORY = /^(?:how|why|what|when|should|can|is|are|opinion|explainer|analysis|podcast|watch|listen|review)\b/i;
const ROUNDUP = /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:aussie\s+|australian\s+|local\s+)?(?:\w+\s+){0,2}startups?\b|\bcheque-in\b|\b(?:share|sharing|split|splits|splitting)\b[^.]{0,40}\$/i;

function cleanName(raw) {
  const tokens = String(raw).trim().split(/\s+/).filter(Boolean);
  const droppable = (t) => STOP.has(t.toLowerCase()) || /-(?:based|founded|headquartered|born|backed)$/i.test(t);
  while (tokens.length && droppable(tokens[0])) tokens.shift();
  while (tokens.length && STOP.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
  const name = tokens.join(' ').replace(/[’']s$/, '').replace(/[,;:]+$/, '');
  if (!name || name.length > 40 || name.length < 2 || tokens.length > 4) return null;
  if (!/^[A-Z0-9]/.test(name) || /[,;]/.test(name)) return null;
  if (STOP.has(name.toLowerCase()) || DESCRIPTORS.has(name.toLowerCase())) return null;
  return name;
}

// Pattern A: the excerpt opens with the company and a funding verb and an amount.
function fromExcerpt(excerpt) {
  const m = new RegExp(`^(${NAME})\\s+${VERBS}\\s+(?:an?\\s+)?(?:its\\s+)?${AMOUNT}`).exec(excerpt.slice(0, 220));
  return m && !/,|\band\b/.test(m[1]) ? cleanName(m[1]) : null;
}

// Pattern B: the headline is "[descriptor] Name verb amount-or-round".
function fromTitle(title) {
  const m = new RegExp(`^(.{2,90}?)\\s+${VERBS}\\s+(?:an?\\s+)?(?:its\\s+)?(?:${AMOUNT}|(?:\\w+\\s+){0,3}(?:pre-?seed|seed|series\\s+[a-e]|funding|round))`, 'i').exec(title);
  if (!m || /,|\band\b/i.test(m[1])) return null;
  const words = m[1].split(/\s+/);
  let start = 0;
  words.forEach((w, i) => { if (DESCRIPTORS.has(w.toLowerCase().replace(/[^a-z-]/g, ''))) start = i + 1; });
  const tail = words.slice(start).join(' ');
  const t = new RegExp(`(${NAME})$`).exec(tail);
  return t ? cleanName(t[1]) : null;
}

// Pattern C, the weakest: the excerpt opens with a capitalised name and, close by,
// an amount followed by a round. "R2Crete turns landfill concrete into ... with a $750k pre-seed"
function fromRoundMention(excerpt) {
  const head = excerpt.slice(0, 160);
  const m = new RegExp(`^(${WORD})\\s+[a-z]`).exec(head);
  if (!m || !new RegExp(`${AMOUNT}\\s+(?:pre-?seed|seed|series\\s+[a-e])`, 'i').test(head)) return null;
  return cleanName(m[1]);
}

export function roundOf(s) {
  const m = /\b(pre-?seed|seed|series\s+([a-e])(\+?))(?![a-z0-9])/i.exec(s);
  if (!m) return null;
  if (/^pre-?seed$/i.test(m[1])) return 'Pre-seed';
  if (/^seed$/i.test(m[1])) return 'Seed';
  return `Series ${m[2].toUpperCase()}${m[3]}`;
}

const CITIES = 'Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|Newcastle';
const cityHint = (s) => new RegExp(`\\b(${CITIES})[- ](?:based|founded|headquartered)\\b`).exec(s)?.[1] ?? null;

// Investors the story names, from the investors we already know.
function investorsIn(s, known) {
  const found = [];
  for (const name of known) {
    if (name.length < 4) continue;
    if (new RegExp(`(?<![\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`).test(s) && !found.includes(name)) found.push(name);
  }
  return found.slice(0, 4);
}

// The company a funding story is about, or null. Never guesses at roundups.
export function extractCompany(item, { knownInvestors = [] } = {}) {
  if (NOT_A_FUNDING_STORY.test(item.title) || ROUNDUP.test(item.title)) return null;
  const fromEx = fromExcerpt(item.excerpt);
  const fromTi = fromTitle(item.title);
  let name = fromEx ?? fromTi;
  let pattern = fromEx ? 'excerpt' : 'headline';
  if (!name) { name = fromRoundMention(item.excerpt); pattern = 'excerpt-round'; }
  if (!name) return null;
  const agreed = fromEx != null && fromTi != null && fromEx.toLowerCase().replace(/\W/g, '') === fromTi.toLowerCase().replace(/\W/g, '');
  const corpus = `${item.title}. ${item.excerpt}`;
  return { name, pattern, agreed, round: roundOf(corpus), city: cityHint(corpus), investors: investorsIn(corpus, knownInvestors) };
}

// ---------- the source ----------

export function createRssSource(config) {
  const { id, feed_url: feedUrl, publisher, region = 'AU', maxAgeDays = 45 } = config;
  if (!feedUrl) throw new Error(`source "${id}": feed_url is required`);
  return {
    id, kind: 'press', region, license: config.license,
    async discover(ctx) {
      const res = await ctx.fetcher.get(feedUrl, { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8', allow: FEED_TYPES });
      const items = parseFeed(res.text);
      if (items.length === 0) throw new Error(`${feedUrl} did not contain any feed items`);
      const retrievedAt = new Date(ctx.now()).toISOString();
      const oldest = ctx.now() - maxAgeDays * 86400000;
      const leads = [];
      for (const item of items) {
        if (item.published && Date.parse(item.published) < oldest) continue;
        const found = extractCompany(item, { knownInvestors: ctx.knownInvestors });
        if (!found) continue;
        const note = item.title.slice(0, 200);
        const evidence = [];
        if (found.round) evidence.push({ field: 'last_funding_round', value: found.round, confidence: 'medium', note });
        if (found.city) evidence.push({ field: 'city', value: found.city, confidence: 'medium', note });
        for (const investor of found.investors) evidence.push({ field: 'investors', value: investor, confidence: 'medium', note });
        leads.push({
          key: item.guid, name: found.name, url: item.link, title: item.title,
          observed_at: item.published ?? retrievedAt, retrieved_at: retrievedAt, publisher,
          evidence, text: `${item.title}. ${item.excerpt}`,
          extraction: { method: found.pattern, agreed: found.agreed },
        });
      }
      return leads;
    },
  };
}
