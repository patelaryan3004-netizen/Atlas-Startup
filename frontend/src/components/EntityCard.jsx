import { useEffect, useRef, useState } from 'react';
import { logoUrl } from '../logo.js';
import { present } from '../freshness.js';

const domainOf = (website) => {
  if (!website) return null;
  try { return new URL(website).hostname.replace(/^www\./, ''); } catch (e) { return null; }
};

// The picture beside a name: a company's or a firm's logo once it has loaded, and until then (or if there is none) the first letter of
// its name. A person has no picture (their initial), and none is ever fetched for one. The letter is always drawn underneath, so a
// logo that arrives late does not move anything. `size` is the picture's side in pixels (40 for a card; the map's company card draws a
// larger one, and then asks for a sharper picture), and `className` is for the one place that draws it as something other than a circle.
export function Avatar({ name, website = null, domain = null, size = 40, className = '' }) {
  const host = domain ?? domainOf(website);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const [state, setState] = useState('pending');
  const img = useRef(null);
  // A picture of a page that was pre-rendered may have finished loading before the page was hydrated, and then its load event has come and
  // gone: ask the picture itself once the page is up. (One that failed stays invisible over the letter, which is what a failed one does.)
  useEffect(() => {
    const el = img.current;
    if (el?.complete && el.naturalWidth > 0) setState('loaded');
  }, []);
  return (
    <span className={className ? `entity-avatar ${className}` : 'entity-avatar'} aria-hidden="true">
      <span className="entity-initial">{initial}</span>
      {host && state !== 'failed' && (
        <img
          ref={img}
          className={state === 'loaded' ? 'is-loaded' : undefined}
          src={size > 48 ? logoUrl(host, 96) : logoUrl(host, 64)}
          width={size}
          height={size}
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
