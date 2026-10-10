import { useEffect, useRef, useState } from 'react';
import { fetchInvestorPerson } from '../../api.js';
import { AppLink, Chips, Fact, amountText, dateText, partialDateText, plural, safeUrl } from './common.jsx';
import { investorHref } from './route.js';
import { useLoaded } from './useLoaded.js';
import { usePageTitle } from './usePageTitle.js';

let sectionIds = 0;
function Section({ title, note, children }) {
  const [id] = useState(() => `inv-person-sec-${++sectionIds}`);
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

const span = (start, end) => [start, end].map((d) => partialDateText(d)).filter(Boolean).join(' to ');

// A person who invests: what a page says about their role, their focus and the investments it attributes to them by name.
// Never a phone number or an email address: this page holds none, and links only to pages the person publishes themselves.
export default function InvestorPersonProfile({ slug, onBack, onOpenInvestor, onOpenCompany }) {
  const { status, data: p } = useLoaded(fetchInvestorPerson, slug);
  usePageTitle(status === 'ready' ? `${p.name} · Australian Startup Investors · AU Startup Map` : null);
  const heading = useRef(null);
  useEffect(() => { if (status !== 'loading') heading.current?.focus({ preventScroll: true }); }, [status]);

  if (status !== 'ready') {
    return (
      <div className="inv-profile">
        <button type="button" className="inv-back" onClick={onBack}>← All investors</button>
        <h1 id="inv-person-title" tabIndex={-1} ref={heading} className="inv-profile-state">
          {status === 'loading' && 'Loading…'}
          {status === 'missing' && 'This person is not in the directory.'}
          {status === 'error' && 'Could not load this person right now.'}
        </h1>
      </div>
    );
  }

  const links = [['LinkedIn', p.linkedin_url], ['Personal website', p.personal_website]].filter(([, url]) => safeUrl(url));
  const hasFocus = p.sector_focus.length > 0 || p.stage_focus.length > 0;
  const hasBackground = p.previous_companies.length > 0 || p.previous_investor_organisations.length > 0;
  const where = [p.current_title, p.organisation?.name].filter(Boolean);
  // The header already says who they are, where and at which firm: the box beside the page says only what it does not.
  const hasFacts = Boolean(p.investments.length || p.companies.length || p.last_verified_at);

  return (
    <article className="inv-profile" aria-labelledby="inv-person-title">
      <button type="button" className="inv-back" onClick={onBack}>← All investors</button>
      <div className="inv-profile-head">
        <span className="inv-logo inv-logo-lg" aria-hidden="true"><span className="inv-logo-initial">{p.name.trim().charAt(0).toUpperCase()}</span></span>
        <div className="inv-profile-id">
          <h1 id="inv-person-title" tabIndex={-1} ref={heading}>{p.name}</h1>
          {(where.length > 0 || p.location) && (
            <p className="inv-profile-meta">
              {p.current_title}
              {p.current_title && p.organisation && ' at '}
              {p.organisation && <AppLink className="inv-textlink" href={investorHref(p.organisation.slug)} onOpen={() => onOpenInvestor(p.organisation.slug)}>{p.organisation.name}</AppLink>}
              {p.location && ` · ${p.location}`}
            </p>
          )}
        </div>
      </div>

      <div className="inv-profile-body">
        {hasFacts && (
          <aside className="inv-profile-facts" aria-label="Facts">
            <dl className="inv-facts">
              {p.investments.length > 0 && <Fact label="Investments">{plural(p.investments.length, 'verified investment')}</Fact>}
              {p.companies.length > 0 && <Fact label="Companies">{plural(p.companies.length, 'connected company', 'connected companies')}</Fact>}
              {p.last_verified_at && <Fact label="Last verified">{dateText(p.last_verified_at)}</Fact>}
            </dl>
          </aside>
        )}

        <div className="inv-profile-main">
          {p.biography && <Section title="About"><p className="inv-prose">{p.biography}</p></Section>}

          {hasFocus && (
            <Section title="Focus">
              <dl className="inv-facts inv-facts-wide">
                {p.stage_focus.length > 0 && (<><dt>Stages</dt><dd><Chips items={p.stage_focus} label="Stages" /></dd></>)}
                {p.sector_focus.length > 0 && (<><dt>Sectors</dt><dd><Chips items={p.sector_focus} label="Sectors" /></dd></>)}
              </dl>
            </Section>
          )}

          {hasBackground && (
            <Section title="Background" note="Where a page says they worked or founded before.">
              <dl className="inv-facts inv-facts-wide">
                {p.previous_companies.length > 0 && (<><dt>Companies</dt><dd><Chips items={p.previous_companies} label="Companies" /></dd></>)}
                {p.previous_investor_organisations.length > 0 && (<><dt>Investors</dt><dd><Chips items={p.previous_investor_organisations} label="Previous investors" /></dd></>)}
              </dl>
            </Section>
          )}

          {p.roles.length > 0 && (
            <Section title="Roles">
              <ul className="inv-rows">
                {p.roles.map((r) => (
                  <li key={`${r.organisation.slug}-${r.role}`} className="inv-row">
                    <div className="inv-row-main">
                      <AppLink className="inv-textlink" href={investorHref(r.organisation.slug)} onOpen={() => onOpenInvestor(r.organisation.slug)}>{r.organisation.name}</AppLink>
                      <span className="inv-row-sub">{r.role}{r.is_current ? '' : ' · former'}{span(r.started_on, r.ended_on) ? ` · ${span(r.started_on, r.ended_on)}` : ''}</span>
                    </div>
                    <div className="inv-row-side">{r.source && <ExternalLink className="inv-row-source" url={r.source.url}>Source</ExternalLink>}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {p.investments.length > 0 && (
            <Section title={`Verified public investments (${p.investments.length})`} note="Only investments a page attributes to them by name.">
              <ul className="inv-rows">
                {p.investments.map((r) => (
                  <li key={`${r.company.slug}-${r.round ?? ''}-${r.investment_date ?? ''}`} className="inv-row">
                    <div className="inv-row-main">
                      <button type="button" className="inv-linkbtn" onClick={() => onOpenCompany(r.company)}>{r.company.name}</button>
                      <span className="inv-row-sub">{[r.company.sector, r.company.city].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="inv-row-side">
                      <span>{[r.round, partialDateText(r.investment_date)].filter(Boolean).join(' · ') || 'Date not stated'}</span>
                      {amountText(r.amount, r.currency) && <span className="inv-row-sub">{amountText(r.amount, r.currency)}</span>}
                      {r.source && <ExternalLink className="inv-row-source" url={r.source.url}>Source</ExternalLink>}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {p.companies.length > 0 && (
            <Section title={`Connected companies (${p.companies.length})`}>
              <ul className="inv-rows">
                {p.companies.map((c) => (
                  <li key={c.slug} className="inv-row">
                    <div className="inv-row-main">
                      <button type="button" className="inv-linkbtn" onClick={() => onOpenCompany(c)}>{c.name}</button>
                      <span className="inv-row-sub">{[c.sector, c.city, c.stage].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="inv-row-side">{c.hiring && <span className="inv-hiring">Hiring now</span>}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {links.length > 0 && (
            <Section title="Public links" note="Pages they publish themselves. Nothing else is held about them.">
              <ul className="inv-rows">
                {links.map(([label, url]) => (
                  <li key={label} className="inv-row">
                    <div className="inv-row-main"><ExternalLink className="inv-textlink" url={url}>{label}</ExternalLink></div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {p.sources.length > 0 && (
            <Section title="Sources" note="The pages this profile is built from.">
              <ul className="inv-rows">
                {p.sources.map((s) => (
                  <li key={s.id} className="inv-row">
                    <div className="inv-row-main">
                      <ExternalLink className="inv-textlink" url={s.url}>{s.title || s.publisher || s.url}</ExternalLink>
                      <span className="inv-row-sub">{s.publisher && s.publisher !== s.title ? s.publisher : ''}</span>
                    </div>
                    <div className="inv-row-side">{s.retrieved_at && <span className="inv-row-sub">Read {dateText(s.retrieved_at)}</span>}</div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </article>
  );
}
