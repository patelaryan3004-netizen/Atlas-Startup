import { useState } from 'react';
import { logoUrl } from '../logo.js';
import { present } from '../freshness.js';

const domainOf = (website) => {
  if (!website) return null;
  try { return new URL(website).hostname.replace(/^www\./, ''); } catch (e) { return null; }
};

// The picture beside a name: a company's or a firm's logo once it has loaded, and until then (or if there is none) the first letter of
// its name. A person has no picture (their initial), and none is ever fetched for one. The letter is always drawn underneath, so a
// logo that arrives late does not move anything.
export function Avatar({ name, website = null, domain = null }) {
  const host = domain ?? domainOf(website);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const [state, setState] = useState('pending');
  return (
    <span className="entity-avatar" aria-hidden="true">
      <span className="entity-initial">{initial}</span>
      {host && state !== 'failed' && (
        <img
          className={state === 'loaded' ? 'is-loaded' : undefined}
          src={logoUrl(host, 64)}
          width="40"
          height="40"
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      )}
    </span>
  );
}

// "Sector · Stage · City": what is known, in order, with a dot between. A blank or "Unknown" is left out, never shown, and with nothing
// left there is no row. The dots are drawn by the stylesheet, so a screen reader hears a list of words, not punctuation.
export function MetaRow({ items = [], label }) {
  const shown = present(...items);
  if (shown.length === 0) return null;
  return <ul className="meta-row" aria-label={label}>{shown.map((text, i) => <li key={`${i}-${text}`}>{text}</li>)}</ul>;
}

// The one card, for a company, a person and a firm: a picture or initial, the name, a two-line description, and a row of what it is.
// What only some of them have (a badge, a link, a verified date) goes in `aside` (beside the name) or in the children (under the row).
// `as` is what the card is: a link, a button, or a plain box (a div, or an li in a list). `level` is the heading level of the name.
export default function EntityCard({ as: Tag = 'div', level = 3, className = '', avatar = null, name, aside = null, blurb = null, meta = [], metaLabel, children, ...rest }) {
  // A heading cannot sit inside a button, so a card that is a button says "heading" with a role instead.
  const heading = Tag === 'button'
    ? <span className="entity-name" role="heading" aria-level={level}>{name}</span>
    : (() => { const H = `h${level}`; return <H className="entity-name">{name}</H>; })();
  return (
    <Tag className={`card entity-card${className ? ` ${className}` : ''}`} {...(Tag === 'button' ? { type: 'button' } : {})} {...rest}>
      <div className="entity-top">
        {avatar}
        {heading}
        {aside}
      </div>
      {blurb && <p className="entity-blurb" title={blurb}>{blurb}</p>}
      <MetaRow items={meta} label={metaLabel} />
      {children}
    </Tag>
  );
}
