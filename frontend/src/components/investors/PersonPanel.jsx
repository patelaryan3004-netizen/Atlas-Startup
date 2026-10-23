import { useEffect, useId, useRef, useState } from 'react';
import { fetchInvestorPerson } from '../../api.js';
import { useEscapeClose } from '../../hooks/useEscapeClose.js';
import {
  AppLink, Chips, DIRECTORY_NOTE, GLOBAL_NOTE, InvestorLogo, PersonAvatar, SaveButton, Stated, VerifiedMark, listText, needsGlobalNote, safeUrl, stageText,
} from './common.jsx';
import { useLoaded } from './useLoaded.js';
import { usePageTitle } from './usePageTitle.js';
import { ExternalLink, InvestmentRows, Section, SourceRows } from './profileParts.jsx';
import { investorHref } from './route.js';
import Tabs from './Tabs.jsx';
import SuggestPersonCorrection from './SuggestPersonCorrection.jsx';
import { CloseIcon, ExternalIcon } from '../explore/icons.jsx';

// One person opened beside the results (a full-screen drawer on a phone): their role, their firm, where they are, what they invest in, and the public
// pages they and their firm publish. It is drawn at once from the row the directory already holds; the rest arrives with the person's record. It is a
// directory profile and says so: not a member, a partner or an endorsement of this site, and no one here is available for introductions through it.
// "Open full profile" is the long page at /investors/people/<slug>/profile.
const TABS = [['overview', 'Overview'], ['investments', 'Investments']];
const NOOP = () => {};

export default function PersonPanel({ slug, card, mode = 'side', saved, onToggleSaved, onClose, onOpenFull, onOpenInvestor, onOpenCompany }) {
  const { status, data: d } = useLoaded(fetchInvestorPerson, slug);
  usePageTitle(status === 'ready' ? `${d.name} · Investors · Still Early` : null);
  const [tab, setTab] = useState('overview');
  const [suggesting, setSuggesting] = useState(false);
  const heading = useRef(null);
  const base = useId();
  const drawer = mode === 'drawer';
  useEscapeClose(drawer && !suggesting ? onClose : NOOP);
  const insideKey = (e) => { if (!drawer && !suggesting && e.key === 'Escape') { e.stopPropagation(); onClose(); } };

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
            {status === 'missing' && 'This person is not in the directory.'}
            {status === 'error' && 'Could not load this person right now.'}
          </h2>
          {status === 'missing' && <p className="inv-lead">They may not have been published yet, or the link may be mistyped. The directory lists everyone who has.</p>}
        </div>
      </aside>
    );
  }

  const ready = status === 'ready';
  const title = d?.current_title ?? card?.title ?? null;
  const org = d?.organisation ?? card?.organisation ?? null;
  const roleLabel = (d?.role_class ?? card?.role_class) && (d?.role_class ?? card?.role_class) !== 'investment' ? (d?.role_label ?? card?.role_label) : null;
  const location = d?.location ?? card?.location?.label ?? null;
  const scope = d?.scope ?? card?.scope ?? 'global';
  // Their own focus where the record states one; otherwise the firm's, and it says whose it is.
  const ownSectors = d?.sector_focus ?? [];
  const ownStages = d?.stage_focus ?? [];
  const own = ownSectors.length > 0 || ownStages.length > 0;
  const sectors = own ? ownSectors : (d?.organisation?.sectors ?? card?.sectors ?? []);
  const stages = own ? ownStages : (d?.organisation?.stages ?? card?.stages ?? []);
  const focusOf = sectors.length > 0 || stages.length > 0 ? (own ? 'their own' : org?.name ? `the focus of ${org.name}` : null) : null;
  const links = [['Professional profile', d?.linkedin_url], ['Personal website', d?.personal_website], [org ? `${org.name} website` : 'Firm website', d?.organisation?.website]].filter(([, url]) => safeUrl(url));
  const hasBackground = Boolean(d) && (d.previous_companies.length > 0 || d.previous_investor_organisations.length > 0);
  const investments = d?.investments ?? [];
  const counts = { investments: investments.length || null };

  return (
    <aside className={`inv-panel inv-panel-${mode}`} aria-labelledby={`${base}-title`} role={drawer ? 'dialog' : undefined} aria-modal={drawer ? 'true' : undefined} onKeyDown={insideKey}>
      <div className="inv-panel-bar">
        <button type="button" className="inv-panel-back" onClick={onClose}>
          {drawer ? '← Back to investors' : <><CloseIcon size={16} aria-hidden="true" /><span>Close</span></>}
        </button>
      </div>

      <div className="inv-panel-body">
        <div className="inv-panel-head">
          <PersonAvatar name={p.name} photo={d?.photo ?? card?.photo ?? null} size="lg" />
          <div className="inv-panel-id">
            <h2 id={`${base}-title`} tabIndex={-1} ref={heading}>{p.name}</h2>
            <p className="inv-panel-sub">
              <Stated>{title}</Stated>
              {org && <>{' at '}<AppLink className="inv-textlink" href={investorHref(org.slug)} onOpen={() => onOpenInvestor(org.slug)}>{org.name}</AppLink></>}
            </p>
            <p className="inv-panel-flags">
              <span className="inv-panel-type">Directory profile</span>
              {roleLabel && <span className="inv-tag">{roleLabel}</span>}
              <VerifiedMark at={d?.last_verified_at ?? card?.verified_at} />
            </p>
          </div>
          <div className="inv-panel-actions">
            <SaveButton name={p.name} saved={saved} onToggle={() => onToggleSaved(`people/${slug}`)} withText />
            <button type="button" className="inv-panel-full" onClick={() => onOpenFull(slug)}>
              <span>Open full profile</span>
              <ExternalIcon size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <dl className="inv-panel-facts inv-panel-facts-person" aria-label="At a glance">
          <div><dt>Role</dt><dd><Stated>{title}</Stated></dd></div>
          <div><dt>Location</dt><dd><Stated>{location}</Stated></dd></div>
          <div className="inv-fact-firm">
            <dt>Firm</dt>
            <dd>{org ? <span className="inv-inline-firm"><InvestorLogo domain={org.domain} name={org.name} /><AppLink className="inv-textlink" href={investorHref(org.slug)} onOpen={() => onOpenInvestor(org.slug)}>{org.name}</AppLink></span> : <Stated>{null}</Stated>}</dd>
          </div>
        </dl>

        <Tabs prefix={base} tabs={TABS.map(([id, text]) => [id, text, counts[id]])} value={tab} onChange={setTab} label="About this person" />

        <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${tab}`} className="inv-tabpanel">
          {status === 'loading' && <p className="inv-panel-note" role="status">Loading…</p>}
          {status === 'error' && <p className="inv-panel-note" role="alert">Could not load the rest of this profile right now.</p>}

          {ready && tab === 'overview' && (
            <>
              <Section title="Investment interests" level={3} note={focusOf === 'their own' ? undefined : focusOf ? `The record states none for them, so this is ${focusOf}.` : undefined}>
                {sectors.length > 0 || stages.length > 0 ? (
                  <dl className="inv-facts inv-facts-wide">
                    {stages.length > 0 && (<><dt>Stage</dt><dd title={stageText(stages)}><Chips items={stages} label="Stages" /></dd></>)}
                    {sectors.length > 0 && (<><dt>Focus</dt><dd title={listText(sectors, 12)}><Chips items={sectors} label="Sectors" max={6} /></dd></>)}
                  </dl>
                ) : <p className="inv-panel-note">No public page states what they invest in, so none is shown.</p>}
              </Section>
              {d.biography && <Section title="About" level={3}><p className="inv-prose">{d.biography}</p></Section>}
              {hasBackground && (
                <Section title="Background" level={3} note="Where a page says they worked or founded before.">
                  <dl className="inv-facts inv-facts-wide">
                    {d.previous_companies.length > 0 && (<><dt>Companies</dt><dd><Chips items={d.previous_companies} label="Companies" /></dd></>)}
                    {d.previous_investor_organisations.length > 0 && (<><dt>Investors</dt><dd><Chips items={d.previous_investor_organisations} label="Previous investors" /></dd></>)}
                  </dl>
                </Section>
              )}
              {links.length > 0 && (
                <Section title="Public links" level={3} note="Pages they or their firm publish. Nothing else is held about them: no email address, no phone number.">
                  <ul className="inv-rows">
                    {links.map(([label, url]) => <li key={label} className="inv-row"><div className="inv-row-main"><ExternalLink className="inv-textlink" url={url}>{label}</ExternalLink></div></li>)}
                  </ul>
                </Section>
              )}
              {d.sources.length > 0 && (
                <Section title="Sources" level={3} note="The pages this profile is built from. A claim no page backs is not shown.">
                  <SourceRows sources={d.sources} />
                </Section>
              )}
              <div className="inv-notes">
                <p className="inv-panel-note">{DIRECTORY_NOTE}</p>
                {needsGlobalNote(scope, d.organisation?.inclusion_basis ?? null) && <p className="inv-panel-note">{GLOBAL_NOTE}</p>}
              </div>
              <div className="inv-correct inv-panel-correct">
                <h3>Not right, or not you?</h3>
                <p>Tell us what is wrong, or ask for this profile to be corrected or removed. A person checks it before anything changes.</p>
                <div className="inv-correct-actions">
                  <button type="button" className="hdrbtn" onClick={() => setSuggesting(true)}>Suggest a correction or removal</button>
                </div>
              </div>
            </>
          )}

          {ready && tab === 'investments' && (
            investments.length > 0 ? (
              <Section title={`Verified public investments (${investments.length})`} level={3} note="Only investments a page attributes to them by name.">
                <InvestmentRows rows={investments} onOpenCompany={onOpenCompany} />
              </Section>
            ) : <p className="inv-panel-note">No page attributes an investment to {p.name} by name, so none is shown. That does not mean they have made none.</p>
          )}
        </div>

        {(safeUrl(d?.organisation?.website) || safeUrl(d?.linkedin_url)) && (
          <div className="inv-panel-foot">
            {safeUrl(d?.organisation?.website) && <ExternalLink className="inv-panel-visit" url={d.organisation.website}>Visit {d.organisation.name}’s website <ExternalIcon size={16} aria-hidden="true" /></ExternalLink>}
            {safeUrl(d?.linkedin_url) && <ExternalLink className="inv-panel-visit" url={d.linkedin_url}>Professional profile <ExternalIcon size={16} aria-hidden="true" /></ExternalLink>}
          </div>
        )}
      </div>

      {suggesting && d && <SuggestPersonCorrection person={d} onClose={() => setSuggesting(false)} />}
    </aside>
  );
}
