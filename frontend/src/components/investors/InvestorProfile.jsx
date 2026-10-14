import { useEffect, useRef, useState } from 'react';
import { fetchInvestor } from '../../api.js';
import { InvestorLogo, VerifiedMark, chequeText, safeUrl } from './common.jsx';
import { useLoaded } from './useLoaded.js';
import { usePageTitle } from './usePageTitle.js';
import {
  ExternalLink, FactList, FundRows, HiringRows, InvestmentRows, RelatedRows, Section, SourceRows, TeamRows, profileHasFacts,
} from './profileParts.jsx';
import SuggestCorrection from './SuggestCorrection.jsx';
import ClaimProfile from './ClaimProfile.jsx';

// One investor in full, as a page of its own (the directory shows the same parts in a panel beside the results). A section appears only when
// something a page backs fills it: there are no empty headings, and a blank means no public page says it.
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
  const jobsUrl = safeUrl(d.jobs?.url);
  const hiring = d.jobs?.hiring ?? [];
  const showRecent = d.recent.length > 0 && d.portfolio.length > d.recent.length;

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
        {profileHasFacts(d) && (
          <aside className="inv-profile-facts" aria-label="Facts">
            <FactList d={d} />
          </aside>
        )}

        <div className="inv-profile-main">
          {d.description && <Section title="About"><p className="inv-prose">{d.description}</p></Section>}
          {d.investment_thesis && <Section title="Investment thesis"><p className="inv-prose">{d.investment_thesis}</p></Section>}

          {showRecent && (
            <Section title="Recent verified investments" note="The latest ones with a date, each with the page that says so.">
              <InvestmentRows rows={d.recent} onOpenCompany={onOpenCompany} />
            </Section>
          )}

          {d.portfolio.length > 0 && (
            <Section title={`Portfolio (${d.portfolio.length})`} note="Only companies a page says this investor backed. A company that lists an investor in its own record is not shown here until a page backs it.">
              <InvestmentRows rows={d.portfolio} onOpenCompany={onOpenCompany} />
            </Section>
          )}

          {(hiring.length > 0 || jobsUrl) && (
            <Section title="Portfolio jobs">
              {hiring.length > 0 && <HiringRows companies={hiring} onOpenCompany={onOpenCompany} />}
              {jobsUrl && <p className="inv-prose inv-after"><ExternalLink className="inv-textlink" url={jobsUrl}>Browse jobs across {d.name}’s portfolio</ExternalLink></p>}
            </Section>
          )}

          {d.team.length > 0 && <Section title="Team"><TeamRows team={d.team} onOpenPerson={onOpenPerson} /></Section>}

          {d.funds.length > 0 && <Section title="Funds"><FundRows funds={d.funds} /></Section>}

          {d.related.length > 0 && (
            <Section title="Invests alongside" note="Other investors a page says backed the same companies.">
              <RelatedRows related={d.related} onOpenInvestor={onOpenInvestor} />
            </Section>
          )}

          {d.sources.length > 0 && (
            <Section title="Sources" note="The pages this profile is built from. A claim no page backs is not shown.">
              <SourceRows sources={d.sources} />
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
