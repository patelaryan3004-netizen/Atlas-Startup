import { useState } from 'react';

// Small pieces the investor pages share: a logo, a verified mark, a list of chips, and how a date, a cheque size and an
// address are written.

// A name as two writings of it would agree (no accents, case, "&" or punctuation), so a company's "Blackbird Ventures" finds the
// investor page that calls itself "blackbird  ventures". The server matches names the same way.
export const nameKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

export function domainOf(website) {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

// Only http(s) is ever followed: an address from data we do not control is shown as text if it is anything else.
export function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch (e) {
    return null;
  }
}

// An investor's logo from its website's domain (Clearbit, then Google's favicon, as the rest of the site does), with its
// initial under it for when neither answers. Each failure moves one step on, so a blocked address is tried once.
export function InvestorLogo({ domain, name, large = false }) {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const src = step === 0 ? `https://logo.clearbit.com/${domain}?size=96` : `https://www.google.com/s2/favicons?domain=${domain}&sz=96`;
  // A picture too small to be a logo is the favicon service's stand-in for a site it does not know: it counts as no answer.
  const loaded = (e) => { if (e.currentTarget.naturalWidth >= 24) setReady(true); else setStep((s) => s + 1); };
  return (
    <span className={`inv-logo${large ? ' inv-logo-lg' : ''}`} aria-hidden="true">
      <span className="inv-logo-initial">{initial}</span>
      {domain && step < 2 && (
        <img key={step} className={`inv-logo-img${ready ? ' inv-logo-img-ready' : ''}`} src={src} alt="" loading="lazy" decoding="async" onLoad={loaded} onError={() => setStep((s) => s + 1)} />
      )}
    </span>
  );
}

const DATE = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const MONTH = new Intl.DateTimeFormat('en-AU', { month: 'short', year: 'numeric' });

// "2026-10-08T…" -> "8 Oct 2026".
export function dateText(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : DATE.format(new Date(t));
}

// An investment's date may be only a year or a month: "2025" -> "2025", "2025-03" -> "Mar 2025", "2025-03-14" -> "14 Mar 2025".
export function partialDateText(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y) return null;
  if (!m) return String(y);
  if (!d) return MONTH.format(new Date(Date.UTC(y, m - 1, 1)));
  return DATE.format(new Date(Date.UTC(y, m - 1, d)));
}

function money(amount, currency = 'AUD') {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch (e) {
    return `${currency} ${amount}`;
  }
}

// A cheque range as a source states it: "$500,000 to $2,000,000", "from $250,000", "up to $1,000,000".
export function chequeText(cheque) {
  if (!cheque || (cheque.min == null && cheque.max == null)) return null;
  const cur = cheque.currency || 'AUD';
  if (cheque.min != null && cheque.max != null) return `${money(cheque.min, cur)} to ${money(cheque.max, cur)}`;
  return cheque.min != null ? `from ${money(cheque.min, cur)}` : `up to ${money(cheque.max, cur)}`;
}

export const amountText = (amount, currency) => (amount == null ? null : money(amount, currency || 'AUD'));

export const LEAD_WORDS = { lead: 'Leads rounds', follow: 'Follows other investors', both: 'Leads or follows' };

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The stages an investor can state, in the order a company moves through them (the server's list, models/investor.js).
export const STAGE_ORDER = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Growth'];

// "Pre-seed → Series A". Stages that run on from one another are written as their two ends, and only then: an investor that states
// Pre-seed and Series B is not said to back the stages between, so those are listed as stated ("Pre-seed · Series B"). A stage this
// list does not know is listed too, after the others.
export function stageText(stages = []) {
  const known = STAGE_ORDER.filter((stage) => stages.includes(stage));
  const other = [...new Set(stages)].filter((stage) => !STAGE_ORDER.includes(stage));
  if (known.length >= 2 && !other.length) {
    const first = STAGE_ORDER.indexOf(known[0]);
    const last = STAGE_ORDER.indexOf(known[known.length - 1]);
    if (last - first + 1 === known.length) return `${known[0]} → ${known[known.length - 1]}`;
  }
  return [...known, ...other].join(' · ');
}

// "AI · SaaS · Fintech", and a count of what does not fit.
export function listText(items = [], max = 3) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(' · ')} · +${rest} more` : shown.join(' · ');
}

// A short list of chips; the rest are counted, not hidden without a word.
export function Chips({ items, max = items.length, label }) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <ul className="inv-chips" aria-label={label}>
      {shown.map((item) => <li key={item} className="inv-chip">{item}</li>)}
      {rest > 0 && <li className="inv-chip inv-chip-more" title={items.slice(max).join(', ')}>+{rest} more</li>}
    </ul>
  );
}

// One fact in a profile's side box: a label and what it says. A wide one (a list of chips) has the whole row on a phone, where the
// facts sit two to a row.
export function Fact({ label, children, wide = false }) {
  return (
    <div className={`inv-fact${wide ? ' inv-fact-wide' : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// "Verified 8 Oct 2026": a drawn tick, and words, so it never rests on colour alone. Compact, it says "Verified" and keeps the date
// for the tooltip, which is what a page of cards wants.
export function VerifiedMark({ at, compact = false }) {
  const when = dateText(at);
  const how = 'Checked against pages the investor publishes, then published by a person';
  return (
    <span className="inv-verified" title={compact && when ? `Verified ${when}. ${how}` : how}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="m5.2 8.3 1.9 1.9 3.7-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {when && !compact ? `Verified ${when}` : 'Verified'}
    </span>
  );
}

// A link that opens an investor, a person or a company in this app when clicked plainly, and is still a real address (open in
// a new tab, copy it, share it).
export function AppLink({ href, onOpen, className, children }) {
  return (
    <a
      className={className}
      href={href}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onOpen();
      }}
    >
      {children}
    </a>
  );
}
