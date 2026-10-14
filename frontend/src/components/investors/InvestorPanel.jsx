import { useEffect, useId, useRef, useState } from 'react';
import { fetchInvestor } from '../../api.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import { InvestorLogo, SaveButton, VerifiedMark, listText, plural, safeUrl, stageText } from './common.jsx';
import { useLoaded } from './useLoaded.js';
import { usePageTitle } from './usePageTitle.js';
import {
  ExternalLink, FactList, FundRows, HiringRows, InvestmentRows, RelatedRows, Section, SourceRows, TeamRows,
} from './profileParts.jsx';
import Tabs from './Tabs.jsx';
import SuggestCorrection from './SuggestCorrection.jsx';
import ClaimProfile from './ClaimProfile.jsx';
import { CloseIcon, ExternalIcon } from '../explore/icons.jsx';

// What a blank fact says: nothing is known, which is not the same as none.
const Stated = ({ children }) => (children ? <>{children}</> : <><span aria-hidden="true">–</span><span className="sr-only">Not stated</span></>);

// One investor opened beside the results (a full-screen drawer on a phone): who it is, its focus, stage and place, and three tabs, Overview,
// Portfolio and People, each filled only from what a page backs. It is drawn at once from the card the directory already holds; the rest
// arrives with the investor's record. "Open full profile" is the long page, the one at /investors/<slug>/profile.
const TABS = [['overview', 'Overview'], ['portfolio', 'Portfolio'], ['people', 'People']];
const NOOP = () => {};

export default function InvestorPanel({ slug, card, mode = 'side', saved, onToggleSaved, onClose, onOpenFull, onOpenInvestor, onOpenPerson, onOpenCompany }) {
  const { status, data: d } = useLoaded(fetchInvestor, slug);
  // The tab names the investor that is open, and gives the directory's name back when it is shut.
  usePageTitle(status === 'ready' ? `${d.name} · Australian Startup Investors · AU Startup Map` : null);
  const [tab, setTab] = useState('overview');
  const [suggesting, setSuggesting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const heading = useRef(null);
  const base = useId();
  const drawer = mode === 'drawer';
  // A drawer is a dialog over the page, so Escape shuts it wherever focus is; beside the results Escape shuts it from inside the panel only (it is
  // not taken from the search box, where it clears the text), and not while a dialog of its own (a correction) is open over it.
  const dialogOpen = suggesting || claiming;
  useEscapeClose(drawer && !dialogOpen ? onClose : NOOP);
  const insideKey = (e) => { if (!drawer && !dialogOpen && e.key === 'Escape') { e.stopPropagation(); onClose(); } };

  // Another investor starts at its overview, at the top, and takes focus: a screen reader is told who is open.
  useEffect(() => { setTab('overview'); }, [slug]);
  const named = Boolean(d || card);
  useEffect(() => { if (named) heading.current?.focus({ preventScroll: true }); }, [slug, named]);

  const p = d ?? card;
  if (!p) {
    return (
      <aside className={`inv-panel inv-panel-${mode}`} aria-label="Investor details" role={drawer ? 'dialog' : undefined} aria-modal={drawer ? 'true' : undefined} onKeyDown={insideKey}>
        <div className="inv-panel-bar">
          <button type="button" className="inv-panel-back" onClick={onClose}>{drawer ? '← Back to investors' : 'Close'}</button>
        </div>
        <div className="inv-panel-body">
          <h2 id={`${base}-title`} tabIndex={-1} ref={heading} className="inv-panel-state">
            {status === 'loading' && 'Loading…'}
            {status === 'missing' && 'This investor is not in the directory.'}
            {status === 'error' && 'Could not load this investor right now.'}
          </h2>
          {status === 'missing' && <p className="inv-lead">It may not have been published yet, or the link may be mistyped. The directory lists every investor that has.</p>}
        </div>
      </aside>
    );
  }

  const inactive = p.status === 'inactive' || p.active_status === 'inactive';
  const focus = listText(p.sectors, 3);
  const stage = stageText(p.stages);
  const place = p.location?.label;
  const headline = [focus, place].filter(Boolean).join(' · ') || p.type_label || '';
  const website = safeUrl(p.website);
  const portfolio = d?.portfolio ?? [];
  const team = d?.team ?? [];
  const hiring = d?.jobs?.hiring ?? [];
  const jobsUrl = safeUrl(d?.jobs?.url);
  const showRecent = Boolean(d) && d.recent.length > 0 && d.portfolio.length > d.recent.length;
  const counts = { portfolio: d ? portfolio.length : p.portfolio_count, people: d ? team.length : null };
  const ready = status === 'ready';

  return (
    <aside
      className={`inv-panel inv-panel-${mode}`}
      aria-labelledby={`${base}-title`}
      role={drawer ? 'dialog' : undefined}
      aria-modal={drawer ? 'true' : undefined}
      onKeyDown={insideKey}
    >
      <div className="inv-panel-bar">
        <button type="button" className="inv-panel-back" onClick={onClose}>
          {drawer ? '← Back to investors' : <><CloseIcon size={16} aria-hidden="true" /><span>Close</span></>}
        </button>
      </div>

      <div className="inv-panel-body">
        <div className="inv-panel-head">
          <InvestorLogo domain={p.domain} name={p.name} large />
          <div className="inv-panel-id">
            <h2 id={`${base}-title`} tabIndex={-1} ref={heading}>{p.name}</h2>
            {headline && <p className="inv-panel-sub">{headline}</p>}
            <p className="inv-panel-flags">
              {p.type_label && <span className="inv-panel-type">{p.type_label}</span>}
              <VerifiedMark at={p.verified_at} />
              {inactive && <span className="inv-tag">No longer investing</span>}
            </p>
          </div>
          <div className="inv-panel-actions">
            <SaveButton name={p.name} saved={saved} onToggle={() => onToggleSaved(slug)} withText />
            <button type="button" className="inv-panel-full" onClick={() => onOpenFull(slug)}>
              <span>Open full profile</span>
              <ExternalIcon size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <dl className="inv-panel-facts" aria-label="At a glance">
          <div><dt>Focus</dt><dd title={p.sectors.join(', ') || undefined}><Stated>{focus}</Stated></dd></div>
          <div><dt>Stage</dt><dd><Stated>{stage}</Stated></dd></div>
          <div><dt>Location</dt><dd><Stated>{place}</Stated></dd></div>
        </dl>

        <Tabs prefix={base} tabs={TABS.map(([id, text]) => [id, text, counts[id]])} value={tab} onChange={setTab} label="About this investor" />

        <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${tab}`} className="inv-tabpanel">
          {status === 'loading' && <p className="inv-panel-note" role="status">Loading…</p>}
          {status === 'error' && <p className="inv-panel-note" role="alert">Could not load the rest of this profile right now.</p>}

          {ready && tab === 'overview' && (
            <>
              {d.description && <Section title="About" level={3}><p className="inv-prose">{d.description}</p></Section>}
              {d.investment_thesis && <Section title="Investment thesis" level={3}><p className="inv-prose">{d.investment_thesis}</p></Section>}
              <Section title="Details" level={3}><FactList d={d} skip={['location', 'stages', 'sectors']} /></Section>
              {d.funds.length > 0 && <Section title="Funds" level={3}><FundRows funds={d.funds} /></Section>}
              {showRecent && (
                <Section title="Recent verified investments" level={3}>
                  <InvestmentRows rows={d.recent} onOpenCompany={onOpenCompany} />
                </Section>
              )}
              {d.sources.length > 0 && (
                <Section title="Sources" level={3} note="The pages this profile is built from. A claim no page backs is not shown.">
                  <SourceRows sources={d.sources} />
                </Section>
              )}
              <div className="inv-correct inv-panel-correct">
                <h3>Something wrong or missing?</h3>
                <p>Tell us what, and give a page that shows it. A person checks every suggestion against a page before anything changes.</p>
                <div className="inv-correct-actions">
                  <button type="button" className="hdrbtn" onClick={() => setSuggesting(true)}>Suggest a correction</button>
                  <button type="button" className="linkbtn" onClick={() => setClaiming(true)}>Claim this profile</button>
                </div>
              </div>
            </>
          )}

          {ready && tab === 'portfolio' && (
            <>
              {portfolio.length > 0 ? (
                <Section title={`Portfolio (${portfolio.length})`} level={3} note="Only companies a page says this investor backed. A company that lists an investor in its own record is not shown here until a page backs it.">
                  <InvestmentRows rows={portfolio} onOpenCompany={onOpenCompany} />
                </Section>
              ) : (
                <p className="inv-panel-note">No company has been linked to {p.name} by a page yet. A company is listed here only when a public page says this investor backed it.</p>
              )}
              {(hiring.length > 0 || jobsUrl) && (
                <Section title="Portfolio jobs" level={3}>
                  {hiring.length > 0 && <HiringRows companies={hiring} onOpenCompany={onOpenCompany} />}
                  {jobsUrl && <p className="inv-prose inv-after"><ExternalLink className="inv-textlink" url={jobsUrl}>Browse jobs across {p.name}’s portfolio</ExternalLink></p>}
                </Section>
              )}
              {d.related.length > 0 && (
                <Section title="Invests alongside" level={3} note="Other investors a page says backed the same companies.">
                  <RelatedRows related={d.related} onOpenInvestor={onOpenInvestor} />
                </Section>
              )}
            </>
          )}

          {ready && tab === 'people' && (
            team.length > 0 ? (
              <Section title={`People (${plural(team.length, 'person', 'people')})`} level={3}>
                <TeamRows team={team} onOpenPerson={onOpenPerson} />
              </Section>
            ) : (
              <p className="inv-panel-note">No one from {p.name} has been published yet. A person is listed only once a public page names their role at the fund.</p>
            )
          )}
        </div>

        {(website || safeUrl(d?.application_url)) && (
          <div className="inv-panel-foot">
            {website && <ExternalLink className="inv-panel-visit" url={p.website}>Visit website <ExternalIcon size={16} aria-hidden="true" /></ExternalLink>}
            {safeUrl(d?.application_url) && <ExternalLink className="inv-panel-apply" url={d.application_url}>How to apply</ExternalLink>}
          </div>
        )}
      </div>

      {suggesting && d && <SuggestCorrection investor={d} onClose={() => setSuggesting(false)} />}
      {claiming && d && <ClaimProfile investor={d} onClose={() => setClaiming(false)} onSuggest={() => { setClaiming(false); setSuggesting(true); }} />}
    </aside>
  );
}
