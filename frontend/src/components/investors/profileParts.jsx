import { useState } from 'react';
import { present } from '../../freshness.js';
import {
  AppLink, Chips, Fact, LEAD_WORDS, amountText, chequeText, dateText, partialDateText, plural, safeUrl,
} from './common.jsx';
import { investorHref, personHref } from './route.js';

// The parts of an investor's profile, shared by its full page (InvestorProfile.jsx) and the panel beside the directory (InvestorPanel.jsx), so
// the two say the same thing in the same words: what a page backs, the portfolio, the team, the funds, who it invests alongside, and its sources.
// A part is drawn only when something a page backs fills it: there are no empty headings, and a blank means no public page says it.

// What a page backs, in the words a visitor uses.
const BACKS = {
  name: 'its name', website: 'its website', investor_type: 'its type', inclusion_basis: 'why it is listed', headquarters_city: 'where it is based', state: 'where it is based',
  country: 'where it is based', other_offices: 'its offices', office_addresses: 'its office addresses', stages: 'its stages', sectors: 'its sectors', geographies: 'where it invests', typical_cheque: 'its cheque size',
  lead_or_follow: 'whether it leads', active_status: 'whether it is investing', application_url: 'how to apply', jobs_url: 'its jobs page', description: 'its description',
  investment_thesis: 'its thesis', portfolio: 'its portfolio', team: 'its team',
};
// A page that backs a dozen claims says the first few and counts the rest.
function backsText(backs) {
  const words = [...new Set(backs.map((b) => BACKS[b] ?? b))];
  return words.length > 4 ? `${words.slice(0, 4).join(', ')} and ${words.length - 4} more` : words.join(', ');
}

let sectionIds = 0;
// A titled part. `level` is the heading's level: 2 on the full page, 3 inside the panel (whose own name is the heading above them).
export function Section({ title, note, level = 2, children }) {
  const [id] = useState(() => `inv-sec-${++sectionIds}`);
  const Heading = `h${level}`;
  return (
    <section className="inv-section" aria-labelledby={id}>
      <Heading id={id}>{title}</Heading>
      {note && <p className="inv-section-note">{note}</p>}
      {children}
    </section>
  );
}

export function ExternalLink({ url, children, className }) {
  const href = safeUrl(url);
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

// One verified investment: the company (it opens over the map), the round and date, whether the investor led it, and the page that says so.
export function InvestmentRow({ r, onOpenCompany }) {
  return (
    <li className="inv-row">
      <div className="inv-row-main">
        <button type="button" className="inv-linkbtn" onClick={() => onOpenCompany(r.company)}>{r.company.name}</button>
        <span className="inv-row-sub">{present(r.company.sector, r.company.city).join(' · ')}</span>
      </div>
      <div className="inv-row-side">
        <span>{[r.round, partialDateText(r.investment_date)].filter(Boolean).join(' · ') || 'Date not stated'}</span>
        {(r.lead_status === 'lead' || amountText(r.amount, r.currency)) && (
          <span className="inv-row-sub">{[r.lead_status === 'lead' ? 'Led the round' : null, amountText(r.amount, r.currency)].filter(Boolean).join(' · ')}</span>
        )}
        {r.source && <ExternalLink className="inv-row-source" url={r.source.url}>Source</ExternalLink>}
      </div>
    </li>
  );
}
const rowKey = (r) => `${r.company.slug}-${r.round ?? ''}-${r.investment_date ?? ''}`;

export function InvestmentRows({ rows, onOpenCompany }) {
  return <ul className="inv-rows">{rows.map((r) => <InvestmentRow key={rowKey(r)} r={r} onOpenCompany={onOpenCompany} />)}</ul>;
}

export function HiringRows({ companies, onOpenCompany }) {
  return (
    <ul className="inv-rows">
      {companies.map((c) => (
        <li key={c.slug} className="inv-row">
          <div className="inv-row-main">
            <button type="button" className="inv-linkbtn" onClick={() => onOpenCompany(c)}>{c.name}</button>
            <span className="inv-row-sub">{present(c.sector, c.city).join(' · ')}</span>
          </div>
          <div className="inv-row-side"><span className="inv-hiring">Hiring now</span></div>
        </li>
      ))}
    </ul>
  );
}

export function TeamRows({ team, onOpenPerson }) {
  return (
    <ul className="inv-rows">
      {team.map((t) => (
        <li key={`${t.person.slug}-${t.role}`} className="inv-row">
          <div className="inv-row-main">
            <AppLink className="inv-textlink" href={personHref(t.person.slug)} onOpen={() => onOpenPerson(t.person.slug)}>{t.person.name}</AppLink>
            <span className="inv-row-sub">{t.role}{t.is_current ? '' : ' · former'}</span>
          </div>
          <div className="inv-row-side">{t.source && <ExternalLink className="inv-row-source" url={t.source.url}>Source</ExternalLink>}</div>
        </li>
      ))}
    </ul>
  );
}

export function FundRows({ funds }) {
  return (
    <ul className="inv-rows">
      {funds.map((f) => (
        <li key={f.slug} className="inv-row">
          <div className="inv-row-main">
            <span className="inv-row-title">{f.name}</span>
            <span className="inv-row-sub">{[f.vintage_year, f.size ? amountText(f.size.amount, f.size.currency) : null, f.stage_focus?.length ? f.stage_focus.join(', ') : null].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="inv-row-side">{f.portfolio_count > 0 && <span>{plural(f.portfolio_count, 'company', 'companies')}</span>}</div>
        </li>
      ))}
    </ul>
  );
}

export function RelatedRows({ related, onOpenInvestor }) {
  return (
    <ul className="inv-rows">
      {related.map((r) => (
        <li key={r.slug} className="inv-row">
          <div className="inv-row-main">
            <AppLink className="inv-textlink" href={investorHref(r.slug)} onOpen={() => onOpenInvestor(r.slug)}>{r.name}</AppLink>
            <span className="inv-row-sub">{r.companies.join(', ')}{r.shared > r.companies.length ? ` and ${r.shared - r.companies.length} more` : ''}</span>
          </div>
          <div className="inv-row-side"><span>{plural(r.shared, 'company in common', 'companies in common')}</span></div>
        </li>
      ))}
    </ul>
  );
}

export function SourceRows({ sources }) {
  return (
    <ul className="inv-rows">
      {sources.map((s) => (
        <li key={s.id} className="inv-row">
          <div className="inv-row-main">
            <ExternalLink className="inv-textlink" url={s.url}>{s.title || s.publisher || s.url}</ExternalLink>
            <span className="inv-row-sub">{[s.publisher && s.publisher !== s.title ? s.publisher : null, s.backs?.length ? `backs ${backsText(s.backs)}` : null].filter(Boolean).join(' · ')}</span>
          </div>
          <div className="inv-row-side">{s.retrieved_at && <span className="inv-row-sub">Read {dateText(s.retrieved_at)}</span>}</div>
        </li>
      ))}
    </ul>
  );
}

// What the profile states about the investor, as a list of labelled facts. `d` is the profile; `skip` names facts the page already shows elsewhere.
export function profileHasFacts(d) {
  return Boolean(d.type_label || d.location?.label || d.other_offices.length || d.office_addresses?.length || d.stages.length || d.sectors.length || d.geographies.length || chequeText(d.cheque) || d.lead_or_follow || d.active_status);
}

export function FactList({ d, skip = [] }) {
  const inactive = d.status === 'inactive' || d.active_status === 'inactive';
  const cheque = chequeText(d.cheque);
  const show = (name) => !skip.includes(name);
  return (
    <dl className="inv-facts">
      {show('type') && d.type_label && <Fact label="Type">{d.type_label}</Fact>}
      {show('location') && d.location?.label && <Fact label="Based in">{d.location.label}</Fact>}
      {d.other_offices.length > 0 && <Fact label="Other offices" wide><Chips items={d.other_offices} label="Other offices" /></Fact>}
      {d.office_addresses?.length > 0 && (
        <Fact label="Office addresses" wide>
          <ul className="inv-addresses" aria-label="Office addresses">
            {d.office_addresses.map((a) => <li key={`${a.city}: ${a.address}`}><b>{a.city}</b> {a.address}</li>)}
          </ul>
          <span className="inv-fact-note">As its own pages state them</span>
        </Fact>
      )}
      {show('stages') && d.stages.length > 0 && <Fact label="Stages" wide><Chips items={d.stages} label="Stages" /></Fact>}
      {show('sectors') && d.sectors.length > 0 && <Fact label="Sectors" wide><Chips items={d.sectors} label="Sectors" /></Fact>}
      {d.geographies.length > 0 && <Fact label="Where it invests" wide><Chips items={d.geographies} label="Where it invests" /></Fact>}
      {cheque && <Fact label="Typical cheque">{cheque}<span className="inv-fact-note">As a public page states it</span></Fact>}
      {d.lead_or_follow && <Fact label="Leads or follows">{LEAD_WORDS[d.lead_or_follow] ?? d.lead_or_follow}</Fact>}
      {d.active_status && <Fact label="Investing">{inactive ? 'No longer investing' : 'Investing now'}</Fact>}
      {d.verified_at && <Fact label="Last verified">{dateText(d.verified_at)}</Fact>}
    </dl>
  );
}
