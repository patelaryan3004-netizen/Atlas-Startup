import { useEffect, useRef, useState } from 'react';
import { fetchInvestor } from '../../api.js';
import {
  AppLink, Chips, Fact, InvestorLogo, VerifiedMark, LEAD_WORDS, amountText, chequeText, dateText, partialDateText, plural, safeUrl,
} from './common.jsx';
import { investorHref, personHref } from './route.js';
import { useLoaded } from './useLoaded.js';
import { usePageTitle } from './usePageTitle.js';
import SuggestCorrection from './SuggestCorrection.jsx';
import ClaimProfile from './ClaimProfile.jsx';

// What a page backs, in the words a visitor uses.
const BACKS = {
  name: 'its name', website: 'its website', investor_type: 'its type', inclusion_basis: 'why it is listed', headquarters_city: 'where it is based', state: 'where it is based',
  country: 'where it is based', other_offices: 'its offices', stages: 'its stages', sectors: 'its sectors', geographies: 'where it invests', typical_cheque: 'its cheque size',
  lead_or_follow: 'whether it leads', active_status: 'whether it is investing', application_url: 'how to apply', jobs_url: 'its jobs page', description: 'its description',
  investment_thesis: 'its thesis', portfolio: 'its portfolio', team: 'its team',
};
// A page that backs a dozen claims says the first few and counts the rest.
function backsText(backs) {
  const words = [...new Set(backs.map((b) => BACKS[b] ?? b))];
  return words.length > 4 ? `${words.slice(0, 4).join(', ')} and ${words.length - 4} more` : words.join(', ');
}

let sectionIds = 0;
function Section({ title, note, children }) {
  const [id] = useState(() => `inv-sec-${++sectionIds}`);
  return (
    <section className="inv-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {note && <p className="inv-section-note">{note}</p>}
      {children}
    </section>
  );
}

function ExternalLink({ url, children, className }) {
  const href = safeUrl(url);
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

// One investor in full. A section appears only when something a page backs fills it: there are no empty headings, and a
// blank means no public page says it.
export default function InvestorProfile({ slug, onBack, onOpenInvestor, onOpenPerson, onOpenCompany }) {
  const { status, data: d } = useLoaded(fetchInvestor, slug);
  usePageTitle(status === 'ready' ? `${d.name} · Australian Startup Investors · AU Startup Map` : null);
  const [suggesting, setSuggesting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const heading = useRef(null);

  useEffect(() => { if (status !== 'loading') heading.current?.focus({ preventScroll: true }); }, [status]);

  if (status !== 'ready') {
    return (
      <div className="inv-profile">
        <button type="button" className="inv-back" onClick={onBack}>← All investors</button>
        <h1 id="inv-profile-title" tabIndex={-1} ref={heading} className="inv-profile-state">
          {status === 'loading' && 'Loading…'}
          {status === 'missing' && 'This investor is not in the directory.'}
          {status === 'error' && 'Could not load this investor right now.'}
        </h1>
        {status === 'missing' && <p className="inv-lead">It may not have been published yet, or the link may be mistyped. The directory lists every investor that has.</p>}
      </div>
    );
  }

  const inactive = d.status === 'inactive' || d.active_status === 'inactive';
  const cheque = chequeText(d.cheque);
  const jobsUrl = safeUrl(d.jobs?.url);
  const hiring = d.jobs?.hiring ?? [];
  const showRecent = d.recent.length > 0 && d.portfolio.length > d.recent.length;
  const hasFacts = d.type_label || d.location?.label || d.other_offices.length || d.stages.length || d.sectors.length || d.geographies.length || cheque || d.lead_or_follow || d.active_status;

  const investmentRow = (r) => (
    <li key={`${r.company.slug}-${r.round ?? ''}-${r.investment_date ?? ''}`} className="inv-row">
      <div className="inv-row-main">
        <button type="button" className="inv-linkbtn" onClick={() => onOpenCompany(r.company)}>{r.company.name}</button>
        <span className="inv-row-sub">{[r.company.sector, r.company.city].filter(Boolean).join(' · ')}</span>
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

  return (
    <article className="inv-profile" aria-labelledby="inv-profile-title">
      <button type="button" className="inv-back" onClick={onBack}>← All investors</button>

      <div className="inv-profile-head">
        <InvestorLogo domain={d.domain} name={d.name} large />
        <div className="inv-profile-id">
          <h1 id="inv-profile-title" tabIndex={-1} ref={heading}>{d.name}</h1>
          {(d.type_label || d.location?.label) && <p className="inv-profile-meta">{[d.type_label, d.location?.label].filter(Boolean).join(' · ')}</p>}
          <p className="inv-profile-flags">
            <VerifiedMark at={d.verified_at} />
            {inactive && <span className="inv-tag">No longer investing</span>}
          </p>
        </div>
        <div className="inv-profile-actions">
          {safeUrl(d.website) && <ExternalLink className="hdrbtn" url={d.website}>Visit website</ExternalLink>}
          {safeUrl(d.application_url) && <ExternalLink className="hdrbtn hdrbtn-accent" url={d.application_url}>How to apply</ExternalLink>}
        </div>
      </div>

      <div className="inv-profile-body">
        {hasFacts && (
          <aside className="inv-profile-facts" aria-label="Facts">
            <dl className="inv-facts">
              {d.type_label && <Fact label="Type">{d.type_label}</Fact>}
              {d.location?.label && <Fact label="Based in">{d.location.label}</Fact>}
              {d.other_offices.length > 0 && <Fact label="Other offices" wide><Chips items={d.other_offices} label="Other offices" /></Fact>}
              {d.stages.length > 0 && <Fact label="Stages" wide><Chips items={d.stages} label="Stages" /></Fact>}
              {d.sectors.length > 0 && <Fact label="Sectors" wide><Chips items={d.sectors} label="Sectors" /></Fact>}
              {d.geographies.length > 0 && <Fact label="Where it invests" wide><Chips items={d.geographies} label="Where it invests" /></Fact>}
              {cheque && <Fact label="Typical cheque">{cheque}<span className="inv-fact-note">As a public page states it</span></Fact>}
              {d.lead_or_follow && <Fact label="Leads or follows">{LEAD_WORDS[d.lead_or_follow] ?? d.lead_or_follow}</Fact>}
              {d.active_status && <Fact label="Investing">{inactive ? 'No longer investing' : 'Investing now'}</Fact>}
              {d.verified_at && <Fact label="Last verified">{dateText(d.verified_at)}</Fact>}
            </dl>
          </aside>
        )}

        <div className="inv-profile-main">
          {d.description && <Section title="About"><p className="inv-prose">{d.description}</p></Section>}
          {d.investment_thesis && <Section title="Investment thesis"><p className="inv-prose">{d.investment_thesis}</p></Section>}

          {showRecent && (
            <Section title="Recent verified investments" note="The latest ones with a date, each with the page that says so.">
              <ul className="inv-rows">{d.recent.map(investmentRow)}</ul>
            </Section>
          )}

          {d.portfolio.length > 0 && (
            <Section title={`Portfolio (${d.portfolio.length})`} note="Only companies a page says this investor backed. A company that lists an investor in its own record is not shown here until a page backs it.">
              <ul className="inv-rows">{d.portfolio.map(investmentRow)}</ul>
            </Section>
          )}

          {(hiring.length > 0 || jobsUrl) && (
            <Section title="Portfolio jobs">
              {hiring.length > 0 && (
                <ul className="inv-rows">
                  {hiring.map((c) => (
                    <li key={c.slug} className="inv-row">
                      <div className="inv-row-main">
                        <button type="button" className="inv-linkbtn" onClick={() => onOpenCompany(c)}>{c.name}</button>
                        <span className="inv-row-sub">{[c.sector, c.city].filter(Boolean).join(' · ')}</span>
                      </div>
                      <div className="inv-row-side"><span className="inv-hiring">Hiring now</span></div>
                    </li>
                  ))}
                </ul>
              )}
              {jobsUrl && <p className="inv-prose inv-after"><ExternalLink className="inv-textlink" url={jobsUrl}>Browse jobs across {d.name}’s portfolio</ExternalLink></p>}
            </Section>
          )}

          {d.team.length > 0 && (
            <Section title="Team">
              <ul className="inv-rows">
                {d.team.map((t) => (
                  <li key={`${t.person.slug}-${t.role}`} className="inv-row">
                    <div className="inv-row-main">
                      <AppLink className="inv-textlink" href={personHref(t.person.slug)} onOpen={() => onOpenPerson(t.person.slug)}>{t.person.name}</AppLink>
                      <span className="inv-row-sub">{t.role}{t.is_current ? '' : ' · former'}</span>
                    </div>
                    <div className="inv-row-side">{t.source && <ExternalLink className="inv-row-source" url={t.source.url}>Source</ExternalLink>}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {d.funds.length > 0 && (
            <Section title="Funds">
              <ul className="inv-rows">
                {d.funds.map((f) => (
                  <li key={f.slug} className="inv-row">
                    <div className="inv-row-main">
                      <span className="inv-row-title">{f.name}</span>
                      <span className="inv-row-sub">{[f.vintage_year, f.size ? amountText(f.size.amount, f.size.currency) : null, f.stage_focus?.length ? f.stage_focus.join(', ') : null].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="inv-row-side">{f.portfolio_count > 0 && <span>{plural(f.portfolio_count, 'company', 'companies')}</span>}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {d.related.length > 0 && (
            <Section title="Invests alongside" note="Other investors a page says backed the same companies.">
              <ul className="inv-rows">
                {d.related.map((r) => (
                  <li key={r.slug} className="inv-row">
                    <div className="inv-row-main">
                      <AppLink className="inv-textlink" href={investorHref(r.slug)} onOpen={() => onOpenInvestor(r.slug)}>{r.name}</AppLink>
                      <span className="inv-row-sub">{r.companies.join(', ')}{r.shared > r.companies.length ? ` and ${r.shared - r.companies.length} more` : ''}</span>
                    </div>
                    <div className="inv-row-side"><span>{plural(r.shared, 'company in common', 'companies in common')}</span></div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {d.sources.length > 0 && (
            <Section title="Sources" note="The pages this profile is built from. A claim no page backs is not shown.">
              <ul className="inv-rows">
                {d.sources.map((s) => (
                  <li key={s.id} className="inv-row">
                    <div className="inv-row-main">
                      <ExternalLink className="inv-textlink" url={s.url}>{s.title || s.publisher || s.url}</ExternalLink>
                      <span className="inv-row-sub">{[s.publisher && s.publisher !== s.title ? s.publisher : null, s.backs?.length ? `backs ${backsText(s.backs)}` : null].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="inv-row-side">{s.retrieved_at && <span className="inv-row-sub">Read {dateText(s.retrieved_at)}</span>}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <aside className="inv-correct" aria-label="Corrections">
          <h2>Something wrong or missing?</h2>
          <p>Tell us what, and give a page that shows it. A person checks every suggestion against a page before anything changes.</p>
          <div className="inv-correct-actions">
            <button type="button" className="hdrbtn" onClick={() => setSuggesting(true)}>Suggest a correction</button>
            <button type="button" className="linkbtn" onClick={() => setClaiming(true)}>Claim this profile</button>
          </div>
        </aside>
      </div>

      {suggesting && <SuggestCorrection investor={d} onClose={() => setSuggesting(false)} />}
      {claiming && <ClaimProfile investor={d} onClose={() => setClaiming(false)} onSuggest={() => { setClaiming(false); setSuggesting(true); }} />}
    </article>
  );
}
