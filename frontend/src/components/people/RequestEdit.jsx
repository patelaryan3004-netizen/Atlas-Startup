import { useState } from 'react';
import TallyDialog from './TallyDialog.jsx';
import { REMOVAL_URL, isConfigured, removalHref } from '../../tally.js';

// "Request edit or removal", on every card. With the removal form set up it is a link that opens it in a new tab, about this
// card; without, it is a button that says the form is not set up yet, so it is never a link to nowhere.
export default function RequestEdit({ entry, url = REMOVAL_URL }) {
  const [open, setOpen] = useState(false);
  if (isConfigured(url)) {
    return (
      <a className="person-request" href={removalHref(url, entry)} target="_blank" rel="noopener noreferrer" aria-label={`Request edit or removal: ${entry.name}`}>
        Request edit or removal<span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <>
      <button type="button" className="person-request" aria-label={`Request edit or removal: ${entry.name}`} onClick={() => setOpen(true)}>Request edit or removal</button>
      {open && <TallyDialog title="Request an edit or removal" url={url} intro={`About ${entry.name}.`} onClose={() => setOpen(false)} />}
    </>
  );
}
