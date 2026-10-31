// The public portfolio pages the importer reads, and how each one lists its companies. A source here is a page of a venture-capital firm or an accelerator
// that names the companies it backed. All reads go through the discovery engine's fetcher (src/discovery/http.js): robots.txt is obeyed, the pace is polite,
// LinkedIn and proprietary databases are never read.
//
// Two kinds of page:
//   profiles  the portfolio page links to one page per company; that page names the company and links to its own website
//   direct    the portfolio page itself carries each company's name, blurb and website
//
// A parser returns plain facts read from the page and decides nothing: whether a company is Australian, whether it is new to the directory and where it is
// are decided later by the discovery engine from the company's own pages (see import.mjs and docs/portfolio-import.md).
import { links, stripTags, decodeEntities, titleOf, metaContent } from '../../src/discovery/html.js';

const clean = (s) => decodeEntities(stripTags(String(s ?? ''))).replace(/\s+/g, ' ').trim();
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

// Links on a profile page that are never the company's site: social, the firm's own pages, job boards, maps, investor portals, podcasts.
export const NOT_A_COMPANY_SITE = /(^|\.)(linkedin|twitter|x|facebook|instagram|youtube|youtu|medium|crunchbase|spotify|whooshkaa|goo|getro|fundpanel|intralinks|dynamosoftware|greenhouse|lever|ashbyhq|workable|substack|apple|google|bit|calendly|typeform|tally|notion|github|techcrunch|afr|smh|theaustralian|startupdaily|businessinsider|forbes|bloomberg|reuters|abc\.net|theguardian)\.(com|co|so|fm|net|io|tech|au|ly|link|gl|me)$/i;

// A website address that can be a company's own: not a social page, a job board, a map link or a news site.
export const usableWebsite = (url) => { const h = hostOf(url); return Boolean(h) && !NOT_A_COMPANY_SITE.test(h); };

// The company's own site from the external links of a profile page. A link called "website", "visit" or showing its own address wins; with none of those, a
// single remaining external link is taken; more than one and no label means no answer (a person looks).
export function websiteFromProfile(html, pageUrl, { ownHosts = [], label = /web\s?site|^visit|^https?:\/\/|^www\./i } = {}) {
  const here = hostOf(pageUrl);
  const own = new Set([here, ...ownHosts.map((h) => h.toLowerCase())]);
  const ext = links(html, pageUrl).filter((l) => {
    const h = hostOf(l.href);
    if (!h || own.has(h) || [...own].some((o) => h.endsWith(`.${o}`))) return false;
    return !NOT_A_COMPANY_SITE.test(h);
  });
  const labelled = ext.filter((l) => label.test(l.text.trim()));
  if (labelled.length) return labelled[0].href;
  return ext.length === 1 ? ext[0].href : null;
}

// A name from a page title with the firm's name taken off it ("Eucalyptus | Blackbird", "Square Peg | Amber", "6clicks - OneVentures").
const nameFromTitle = (title, strip) => clean(String(title ?? '').replace(strip, '')).replace(/^[|\-–—:\s]+|[|\-–—:\s]+$/g, '');

function profileParser({ strip, ownHosts = [], label }) {
  return (html, url) => ({
    name: nameFromTitle(titleOf(html), strip),
    website: websiteFromProfile(html, url, { ownHosts, label }),
    description: clean(metaContent(html, 'description') || metaContent(html, 'og:description') || '').slice(0, 400) || null,
  });
}

const profileLinks = (pattern) => (html, base) => links(html, base).filter((l) => pattern.test(new URL(l.href).pathname) && !new URL(l.href).search)
  .map((l) => ({ profile_url: l.href, list_text: clean(l.text) }));

// Cards in a listing: every match of `card` gives { website, name, description } (the regex groups named below).
function cardParser(card) {
  return (html) => [...html.matchAll(card)].map((m) => ({
    name: clean(m.groups.name), website: decodeEntities(m.groups.href).trim(), description: clean(m.groups.desc ?? '').slice(0, 400) || null,
  })).filter((c) => c.name && /^https?:\/\//i.test(c.website));
}

export const SOURCES = [
  {
    id: 'blackbird-portfolio', publisher: 'Blackbird', kind: 'vc_portfolio', investor: 'Blackbird', mode: 'profiles',
    listUrl: 'https://www.blackbird.vc/portfolio', ownHosts: ['blackbird.vc', 'blackbird.foundation', 'thesunrise.live'],
    parseList: profileLinks(/^\/portfolio\/[^/]+$/),
    parseProfile: profileParser({ strip: /\s*\|\s*Blackbird\s*$/i, ownHosts: ['blackbird.vc', 'blackbird.foundation', 'thesunrise.live', 'startmate.com'] }),
  },
  {
    id: 'airtree-portfolio', publisher: 'AirTree', kind: 'vc_portfolio', investor: 'AirTree', mode: 'profiles',
    listUrl: 'https://www.airtree.vc/companies', ownHosts: ['airtree.vc'],
    parseList: profileLinks(/^\/companies\/[^/]+$/),
    parseProfile: profileParser({ strip: /\s*\|\s*Airtree Ventures\s*$/i, ownHosts: ['airtree.vc'], label: /^website$/i }),
  },
  {
    id: 'squarepeg-portfolio', publisher: 'Square Peg', kind: 'vc_portfolio', investor: 'Square Peg', mode: 'profiles',
    listUrl: 'https://www.squarepeg.vc/portfolio', ownHosts: ['squarepeg.vc', 'squarepeg.getro.com'],
    parseList: profileLinks(/^\/portfolio\/[^/]+$/),
    parseProfile: profileParser({ strip: /^\s*Square Peg\s*\|\s*/i, ownHosts: ['squarepeg.vc'], label: /^https?:\/\/|^www\./i }),
  },
  {
    id: 'oneventures-portfolio', publisher: 'OneVentures', kind: 'vc_portfolio', investor: 'OneVentures', mode: 'profiles',
    listUrl: 'https://one-ventures.com.au/portfolio/', ownHosts: ['one-ventures.com.au', 'oneventures.com.au'],
    parseList: profileLinks(/^\/portfolio\/(?!category)[^/]+\/?$/),
    parseProfile: profileParser({ strip: /\s*[-–|]\s*OneVentures\s*$/i, ownHosts: ['one-ventures.com.au', 'oneventures.com.au'], label: /visit website/i }),
  },
  {
    id: 'investible-portfolio', publisher: 'Investible', kind: 'vc_portfolio', investor: 'Investible', mode: 'profiles',
    listUrl: 'https://www.investible.com/portfolio', ownHosts: ['investible.com', 'tankstreamlabs.com'],
    parseList: profileLinks(/^\/company\/[^/]+$/),
    parseProfile: profileParser({ strip: /\s*[|\-–]\s*Investible\s*$/i, ownHosts: ['investible.com', 'tankstreamlabs.com'], label: /web\s?site|^visit/i }),
  },
  {
    id: 'startmate-portfolio', publisher: 'Startmate', kind: 'accelerator_portfolio', investor: 'Startmate', mode: 'profiles',
    listUrl: 'https://www.startmate.com/portfolio', ownHosts: ['startmate.com', 'merchwindow.com'],
    parseList: profileLinks(/^\/portfolio-companies\/[^/]+$/),
    parseProfile: profileParser({ strip: /\s*\|\s*Startmate Portfolio\s*$/i, ownHosts: ['startmate.com', 'merchwindow.com', 'luma.com'], label: /visit website/i }),
  },
  {
    id: 'folklore-portfolio', publisher: 'Folklore Ventures', kind: 'vc_portfolio', investor: 'Folklore Ventures', mode: 'direct',
    listUrl: 'https://www.folklore.vc/companies',
    parseList: cardParser(/<a\b[^>]*?href="(?<href>https?:\/\/[^"]+)"[^>]*class="portfolio-link-item[^"]*"[^>]*>[\s\S]*?alt="(?<name>[^"]+)"[\s\S]*?(?:<p\b[^>]*>(?<desc>[\s\S]*?)<\/p>)?[\s\S]*?<\/a>/g),
  },
  {
    id: 'giantleap-portfolio', publisher: 'Giant Leap', kind: 'vc_portfolio', investor: 'Giant Leap', mode: 'direct',
    listUrl: 'https://www.giantleap.com.au/portfolio',
    parseList: cardParser(/<a href="(?<href>https?:\/\/[^"]+)"[^>]*class="portfolio_item[^"]*"[^>]*>[\s\S]*?<h3\b[^>]*>(?<name>[\s\S]*?)<\/h3>\s*<p\b[^>]*>(?<desc>[\s\S]*?)<\/p>/g),
  },
  {
    id: 'cicada-residents', publisher: 'Cicada Innovations', kind: 'accelerator_portfolio', investor: null, mode: 'direct',
    listUrl: 'https://www.cicadainnovations.com/incubator/residents',
    parseList: cardParser(/<h4><a href="(?<href>https?:\/\/[^"]+)"[^>]*>(?<name>[^<]+)<\/a><\/h4>\s*<p\b[^>]*>(?<desc>[\s\S]*?)<\/p>/g),
  },
];

export const sourceById = (id) => SOURCES.find((s) => s.id === id);
