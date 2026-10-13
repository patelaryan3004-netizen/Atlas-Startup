import { verifiedLabel } from '../freshness.js';

// When a company's facts were last checked, in the one wording every card and the company's page share: "Verified 3 days ago", and once
// the check is over 60 days old a muted, slanted "Needs re-check". A company with no check date says nothing: no placeholder.
export default function VerifiedNote({ at }) {
  const fresh = verifiedLabel(at);
  if (!fresh) return null;
  return <div className={fresh.stale ? 'verified-note verified-note-stale' : 'verified-note'}>{fresh.text}</div>;
}

// "Unverified" for a company nobody has verified yet (verified: false); nothing for one that is, or whose state is not known.
export function UnverifiedBadge({ company }) {
  return company?.verified === false ? <span className="badge-unverified">Unverified</span> : null;
}
