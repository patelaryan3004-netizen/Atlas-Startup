// What a company's own homepage says about whether it is still what the directory says it is. Pure: a site that
// was read goes in, signals come out. Nothing here changes a company.
//
// Two kinds of signal, and the difference matters:
//
//   a CLAIM       the page says, in a sentence about the company itself, that it was acquired, is a subsidiary,
//                 or has closed. It becomes a company_status evidence row (medium confidence: a sentence on a
//                 page, not structured data), with the sentence in its note. Evidence never writes to a company:
//                 it waits as a suggestion if the record says nothing, and shows as a conflict if the record
//                 says otherwise, for a person to settle.
//   a WATCH       something changed that makes the record worth a person's look, but no claim is being made:
//                 the address redirects to another domain, the page says the company used to be called
//                 something else, the domain looks parked, or the site is now plainly someone else's. These
//                 are remembered on the company's status clock and listed by the data-quality job. They are
//                 never evidence, because nothing on the page says what the company's status is.
//
// The patterns are deliberately narrow. They look for the company's own name (or "we") doing the verb, because a
// homepage mentions other companies being acquired all the time ("we acquired Beta", a news item about a
// customer). A sentence they do not recognise is simply not a signal: a missed shutdown is found by the next
// check or by a person, and a false one wastes a person's time and teaches them to ignore the list.
import { canonicalDomain } from '../models/identity.js';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const QUOTE = 180;

// The other company in "acquired by ...": the run of capitalised words that follows (with "of", "and" and "&" allowed
// between them), up to five. "Initech Holdings last month" is Initech Holdings.
const CONNECTORS = new Set(['of', 'and', '&', 'the']);
const capitalised = (t) => /^[A-Z0-9]/.test(t) || /^[a-z]+[A-Z]/.test(t); // Initech, 3M, eBay
function companyAfter(text) {
  const tokens = text.replace(/^the\s+/i, '').split(/[.,;:!?()"“”]/)[0].trim().split(/\s+/).filter(Boolean);
  const taken = [];
  for (let i = 0; i < tokens.length && taken.length < 5; i += 1) {
    const t = tokens[i];
    if (capitalised(t) || (CONNECTORS.has(t.toLowerCase()) && taken.length && tokens[i + 1] && capitalised(tokens[i + 1]))) taken.push(t); else break;
  }
  const name = taken.join(' ');
  return name.length >= 2 && name.length <= 50 ? name : null;
}

// "shut down" and "closing down" are ambiguous ("we shut down the old server"): they count only when the sentence
// ends there, or goes straight on to when or why.
const ENDS = '(?=\\s*[.!,]|\\s+(?:and|on|at|in|after|due|for\\s+good|permanently)\\b|\\s*$)';

function namesPattern(names) {
  const usable = [...new Set(names.map(squash).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  return usable.length ? `(?:${usable.map(escape).join('|')})` : null;
}

const quote = (text, index, length) => {
  const start = Math.max(0, index - 20);
  return squash(text.slice(start, index + length + 40)).slice(0, QUOTE);
};

// Each rule: a pattern over the page text, the claim it makes (or null for a watch), and how to describe it.
function rules(NAME) {
  const out = [
    // acquired
    { code: 'acquired_notice', claim: 'acquired', re: /\bwe(?:'ve|’ve| have)\s+(?:just\s+|recently\s+)?been\s+acquired\s+by\s+([^.;:!?()]{2,80})/gi },
    { code: 'acquired_notice', claim: 'acquired', re: /\bwe\s+(?:were|got)\s+(?:recently\s+)?acquired\s+by\s+([^.;:!?()]{2,80})/gi },
    { code: 'acquired_notice', claim: 'acquired', re: /\bwe(?:'re|’re| are)\s+now\s+part\s+of\s+([^.;:!?()]{2,80})/gi },
    // a subsidiary or a brand of another company
    { code: 'subsidiary_notice', claim: 'subsidiary', re: /\bwe(?:'re|’re| are)\s+(?:now\s+)?(?:a\s+)?(?:subsidiary|division|brand)\s+of\s+([^.;:!?()]{2,80})/gi },
    // closed
    { code: 'closed_notice', claim: 'defunct', re: /\bwe(?:'ve|’ve| have)?\s+(?:closed\s+(?:our\s+doors|the\s+business|our\s+business)|ceased\s+(?:trading|operations|operating))\b/gi },
    { code: 'closed_notice', claim: 'defunct', re: new RegExp(`\\bwe(?:'ve|’ve| have)\\s+(?:shut\\s+down|wound\\s+up)${ENDS}`, 'gi') },
    { code: 'closed_notice', claim: 'defunct', re: new RegExp(`\\bwe(?:'re|’re| are)\\s+(?:shutting\\s+down|winding\\s+up)${ENDS}`, 'gi') },
    { code: 'closed_notice', claim: 'defunct', re: /\bwe(?:'re|’re| are)\s+closing\s+(?:our\s+doors|the\s+business|for\s+good)\b/gi },
    // a domain that is for sale or parked
    { code: 'parked_domain', claim: null, re: /\b(?:this\s+domain(?:\s+name)?\s+(?:is|may\s+be)\s+for\s+sale|buy\s+this\s+domain|the\s+domain\s+is\s+(?:parked|for\s+sale)|this\s+(?:web)?site\s+is\s+for\s+sale|domain\s+(?:has\s+)?expired)\b/gi },
    // the company says it has changed its name
    { code: 'renamed_notice', claim: null, re: /\bwe(?:'ve|’ve| have)\s+(?:rebranded|changed\s+our\s+name|renamed\s+ourselves)(?:\s+(?:to|as))?\s+([^.;:!?()]{2,60})/gi },
  ];
  if (NAME) {
    out.push(
      { code: 'acquired_notice', claim: 'acquired', re: new RegExp(`${NAME}\\s+(?:has\\s+(?:just\\s+)?been|was|is\\s+now|have\\s+been|were)\\s+(?:recently\\s+)?acquired\\s+by\\s+([^.;:!?()]{2,80})`, 'gi') },
      { code: 'acquired_notice', claim: 'acquired', re: new RegExp(`${NAME}\\s+(?:is|are)\\s+now\\s+part\\s+of\\s+([^.;:!?()]{2,80})`, 'gi') },
      { code: 'subsidiary_notice', claim: 'subsidiary', re: new RegExp(`${NAME}\\s+(?:is|are)\\s+(?:a\\s+)?(?:wholly[- ]owned\\s+)?(?:subsidiary|division|brand)\\s+of\\s+([^.;:!?()]{2,80})`, 'gi') },
      { code: 'closed_notice', claim: 'defunct', re: new RegExp(`${NAME}\\s+(?:has|have)\\s+(?:closed\\s+(?:its|their)\\s+doors|ceased\\s+(?:trading|operations)|entered\\s+(?:voluntary\\s+)?(?:administration|liquidation)|been\\s+(?:wound\\s+up|placed\\s+into\\s+(?:administration|liquidation)))\\b`, 'gi') },
      { code: 'closed_notice', claim: 'defunct', re: new RegExp(`${NAME}\\s+(?:has|have)\\s+(?:shut\\s+down|closed\\s+down)${ENDS}`, 'gi') },
      { code: 'closed_notice', claim: 'defunct', re: new RegExp(`${NAME}\\s+(?:is|are)\\s+(?:shutting\\s+down|closing\\s+down)${ENDS}`, 'gi') },
      { code: 'closed_notice', claim: 'defunct', re: new RegExp(`${NAME}\\s+(?:is|are)\\s+(?:closing\\s+(?:its|their)\\s+doors|no\\s+longer\\s+(?:operating|trading))\\b`, 'gi') },
      { code: 'renamed_notice', claim: null, re: new RegExp(`\\b(?:formerly|previously|originally)\\s+(?:known\\s+as|called|named)\\s+${NAME}\\b`, 'gi'), former: true },
    );
  }
  return { rules: out };
}

// The text worth reading on a homepage: its title, its description and the start of what a visitor sees.
function scanText(facts) {
  return squash([facts.title, facts.description, String(facts.text ?? '').slice(0, 4000)].filter(Boolean).join('. '));
}

// site: from readSite. facts: what extractFacts read from the homepage. names: every name the company goes by.
// Returns [{ code, detail, claim, value, other, page_url }]: claim is 'acquired' | 'subsidiary' | 'defunct' or null.
export function statusSignals(site, { facts = null, names = [] } = {}) {
  const signals = [];
  const home = site?.pages?.[0];
  if (!home || !site.domain) return signals;
  const seen = new Set();
  const push = (s) => { const key = `${s.code}|${s.value ?? ''}`; if (!seen.has(key)) { seen.add(key); signals.push({ page_url: home.finalUrl, claim: null, value: null, other: null, ...s }); } };

  // The address now leads somewhere else: a different registrable domain, not just www or a path.
  const landed = canonicalDomain(home.finalUrl);
  if (landed && !landed.nonCompany && landed.domain !== site.domain.domain) {
    push({ code: 'moved_domain', detail: `${site.domain.domain} now redirects to ${landed.domain}`, other: landed.domain });
  }

  if (!facts) return signals;
  const text = scanText(facts);
  const { rules: all } = rules(namesPattern(names));
  for (const rule of all) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const sentence = quote(text, m.index, m[0].length);
      if (rule.code === 'parked_domain') {
        // A real company's page can mention a domain for sale; a parked page has nothing else on it.
        if (String(facts.text ?? '').length > 1500) continue;
        push({ code: 'parked_domain', detail: `the page looks like a parked or for-sale domain: "${sentence}"` });
        continue;
      }
      if (rule.code === 'renamed_notice') {
        if (rule.former) push({ code: 'renamed_notice', detail: `the page says the company used to be called this: "${sentence}"` });
        else {
          const to = companyAfter(m[1] ?? '');
          if (to && !names.some((n) => squash(n).toLowerCase() === to.toLowerCase())) push({ code: 'renamed_notice', detail: `the page says it has rebranded as ${to}: "${sentence}"`, other: to });
        }
        continue;
      }
      const other = rule.claim === 'defunct' ? null : companyAfter(m[1] ?? '');
      if (rule.claim !== 'defunct' && !other) continue; // "acquired by" with nobody after it is not a sentence about this company
      push({ code: rule.code, claim: rule.claim, value: rule.claim, other, detail: `the homepage says: "${sentence}"` });
    }
  }
  return signals;
}

// Signals as the rows analyzeCompanySite adds to the evidence it reports: only claims, never watches.
export const claimsOf = (signals) => signals.filter((s) => s.claim).map((s) => ({ field: 'company_status', value: s.claim, note: s.detail.length > 280 ? `${s.detail.slice(0, 277)}...` : s.detail }));

// The signals a company's status clock remembers, small and stable between checks.
export const briefSignals = (signals) => signals.slice(0, 6).map((s) => ({ code: s.code, detail: s.detail.slice(0, 200), ...(s.other ? { other: s.other } : {}) }));
