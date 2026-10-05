// Two questions asked of every new candidate: is it Australian, and is it a
// startup? Each answer is a verdict plus the signals behind it, stored with the
// candidate so a reviewer can see why.
//
//   yes      enough positive signals
//   likely   some
//   unknown  too little to say: the usual case, and it goes to a person
//   no       explicit evidence against, and not outweighed
//
// "no" needs a negative signal. Having nothing in favour is "unknown", never "no",
// so a gate rejects a candidate only when something says it does not belong (a
// foreign address, a fund, an ordinary business), and a rejection is kept and
// reversible, not deleted. These are heuristics for ordering and filtering the
// work, not a substitute for the person who approves.
import { AU_STATES } from '../models/company.js';
import { isValidABN, isValidACN } from '../models/identity.js';

const round2 = (n) => Math.round(n * 100) / 100;
const STATE_RE = AU_STATES.join('|');
const AU_CITIES = 'Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|Newcastle|Wollongong|Geelong';

const THRESHOLDS = {
  australian: { yes: 0.6, likely: 0.3, no: -0.2 },
  startup: { yes: 0.5, likely: 0.2, no: -0.2 },
};

// A score and verdict from a set of signals.
export function summarize(signals, kind) {
  const score = round2(Math.max(-1, Math.min(1, signals.reduce((n, s) => n + s.weight, 0))));
  const { yes, likely, no } = THRESHOLDS[kind];
  const hasNegative = signals.some((s) => s.weight < 0);
  let verdict = 'unknown';
  if (score >= yes) verdict = 'yes';
  else if (score >= likely) verdict = 'likely';
  else if (score <= no && hasNegative) verdict = 'no';
  return { verdict, score, signals };
}

// Assessments only ever gain evidence: what an earlier look found (say, a phrase in
// an excerpt that is no longer kept) is not lost when the candidate is looked at again
// with more information. A signal seen twice counts once, at its larger weight.
export function accumulate(previous, next, kind) {
  const byCode = new Map();
  for (const s of [...(previous?.signals ?? []), ...next.signals]) {
    const prior = byCode.get(s.code);
    if (!prior || Math.abs(s.weight) > Math.abs(prior.weight)) byCode.set(s.code, s);
  }
  return summarize([...byCode.values()], kind);
}

export function assessAustralian(subject) {
  const { domain, state, city, address = '', aliases = [], external_ids: ids = {}, regions = [], phones = 0, text = '', name = '' } = subject;
  const signals = [];
  const add = (code, weight, detail) => signals.push({ code, weight, detail });
  const corpus = `${address} ${text}`;

  if (domain && /\.au$/i.test(domain)) add('au_domain', 0.35, domain);
  const auAddress = new RegExp(`\\b(?:${STATE_RE})\\s+\\d{4}\\b`).test(address);
  if (auAddress) add('au_address', 0.35, address);
  else if (state && AU_STATES.includes(state) && city && !/^unknown$/i.test(city)) add('au_location', 0.25, `${city}, ${state}`);
  if ((ids.abn && isValidABN(ids.abn)) || (ids.acn && isValidACN(ids.acn))) add('registry_number', 0.4, 'a valid ABN or ACN is stated (not checked against the register)');
  if ([name, ...aliases].some((n) => /\bPty\.?\s+(?:Ltd|Limited)\b/i.test(n))) add('pty_ltd', 0.2, 'an Australian company form');
  if (phones > 0) add('au_phone', 0.15, 'an Australian phone number');
  if (regions.includes('AU')) add('au_source', 0.15, 'found by a source that covers Australia');
  const mention = /\b(?:Australian|Aussie|Australia)\b/.exec(corpus) ?? new RegExp(`\\b(?:${AU_CITIES})[- ](?:based|founded|headquartered)\\b`).exec(corpus);
  if (mention) add('au_mention', 0.2, mention[0]);

  if (domain && /\.(?:co\.uk|uk|de|fr|nl|ie|es|it|se|no|dk|fi|ch|at|be|pl|ca|us|in|sg|hk|jp|kr|cn|br|mx|za|ae|il|nz)$/i.test(domain)) add('foreign_domain', -0.25, domain);
  const foreignAddress = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.exec(address) ?? /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/.exec(address) ?? /\bNew Zealand\b/.exec(address);
  if (foreignAddress && !auAddress) add('foreign_address', -0.35, foreignAddress[0]);
  const foreignHq = /\b(?:US|U\.S\.|American|UK|British|Singapore|New Zealand|Kiwi|San Francisco|New York|London|Silicon Valley|Auckland|Wellington)[- ]based\b/i.exec(corpus);
  if (foreignHq) add('foreign_hq', -0.3, foreignHq[0]);

  return summarize(signals, 'australian');
}

const FUNDING = /\b(?:raises?|raised|secures?|secured|closes?|closed|lands?|landed|grabs?|bags?|banks?|pockets?|nabs?|snags?|nails?|cements?)\b[^.]{0,40}?(?:A\$|US\$|\$|£|€)\s?\d|\b(?:pre-?seed|seed round|series\s+[a-e]|funding round|venture capital|backed by|investment from|capital raise)\b/i;
const STARTUP_WORDS = /\b(?:start-?ups?|scale-?ups?|co-?founders?|founders?|saas|platform|app|marketplace|AI|machine learning|deep ?tech|fintech|health ?tech|climate ?tech|ag ?tech|edtech|proptech|API|software)\b/;
const FUND = /\b(?:debut|new|first|second|third|maiden)\s+(?:venture\s+)?fund\b|\b(?:ventures|capital|partners|investments|equity|fund)$/i;
const ORDINARY_BUSINESS = /\b(?:franchis(?:e|es|ing)|plumb(?:er|ers|ing)|electricians?|restaurants?|caf[eé]s?|bakery|butcher|dentists?|dental clinic|law firm|solicitors|accountants?|accounting firm|real estate agen(?:cy|t)|estate agents?|builders?|landscap(?:er|ing)|cleaning services?|mechanics?|hairdress(?:er|ing)|beauty salon|gym|childcare|supermarket)\b/i;
const ESTABLISHED = /\b(?:ASX[- ]listed|listed on the ASX|founded in (?:18|19)\d{2}|since (?:18|19)\d{2}|family[- ]owned)\b/i;
const PUBLIC_BODY = /\b(?:council|university|department of|charity|not-for-profit|school)\b/i;

export function assessStartup(subject, { knownInvestors = [], asOfYear = new Date().getUTCFullYear() } = {}) {
  const { name = '', text = '', investors = [], foundedYear = null } = subject;
  const signals = [];
  const add = (code, weight, detail) => signals.push({ code, weight, detail });

  const funding = FUNDING.exec(text);
  if (funding) add('funding_language', 0.35, funding[0].slice(0, 60));
  const named = unique([...investors, ...knownInvestors.filter((k) => k.length >= 4 && new RegExp(`(?<![\\w])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`).test(text))]);
  if (named.length) add('known_investor', 0.3, named.slice(0, 3).join(', '));
  const words = STARTUP_WORDS.exec(text);
  if (words) add('startup_words', 0.15, words[0]);
  if (foundedYear && foundedYear >= asOfYear - 12) add('recent_founding', 0.1, String(foundedYear));

  const fund = FUND.exec(name) ?? FUND.exec(text);
  if (fund) add('fund_or_investor', -0.8, fund[0]);
  const ordinary = ORDINARY_BUSINESS.exec(`${name} ${text}`);
  if (ordinary) add('ordinary_business', -0.4, ordinary[0]);
  const established = ESTABLISHED.exec(text);
  if (established) add('established_company', -0.3, established[0]);
  const body = PUBLIC_BODY.exec(name);
  if (body) add('public_body', -0.3, body[0]);

  return summarize(signals, 'startup');
}

function unique(list) { return [...new Set(list)]; }
