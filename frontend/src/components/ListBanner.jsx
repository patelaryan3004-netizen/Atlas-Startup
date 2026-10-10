import { useState } from 'react';

// Over the list of one curated list (its own address, /lists/<slug>): what the list is, how many companies are in it, and how to
// share it. Changing a filter makes it no longer that list, and the banner goes (the App leaves the list's address).
export default function ListBanner({ list, count, url, onAllLists }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { /* clipboard unavailable */ }
  };
  return (
    <section className="list-banner" aria-label={`List: ${list.name}`}>
      <div className="list-banner-text">
        <p className="list-banner-kicker">Curated list</p>
        <h2 className="list-banner-title">{list.name}</h2>
        <p className="list-banner-desc">{list.description}</p>
      </div>
      <div className="list-banner-side">
        <span className="list-banner-count">{count == null ? '' : `${count} ${count === 1 ? 'company' : 'companies'}`}</span>
        <button type="button" className="hdrbtn" onClick={share}>{copied ? 'Link copied' : 'Share this list'}</button>
        <button type="button" className="linkbtn" onClick={onAllLists}>All lists</button>
      </div>
    </section>
  );
}
