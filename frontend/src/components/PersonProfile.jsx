import { useEscapeClose } from '../hooks/useEscapeClose.js';

function initialsOf(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name || '?').slice(0, 2).toUpperCase();
}

function externalLinkLabel(url) {
  if (/linkedin\.com/.test(url)) return 'View on LinkedIn ↗';
  if (/wikipedia\.org/.test(url)) return 'View on Wikipedia ↗';
  return 'View profile ↗';
}

// person is the shape returned by people.js's getPersonProfile().
export default function PersonProfile({ person, onClose }) {
  useEscapeClose(onClose);

  const linkedInSearch = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
    `${person.name} ${person.currentCompany || ''}`.trim()
  )}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel person-profile-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>

        <div className="person-profile-head">
          <span className="pc-founder-avatar person-profile-avatar">{initialsOf(person.name)}</span>
          <div>
            <h2>{person.name}</h2>
            {person.role && <div className="modal-sub person-profile-role">{person.role}</div>}
          </div>
        </div>

        {person.roles.length > 0 && (
          <div className="pc-badges-row person-profile-roles">
            {person.roles.map((r) => (
              <span className="taskgate-badge" key={r}>{r.toUpperCase()}</span>
            ))}
          </div>
        )}

        {person.currentCompany && (
          <div className="sdp-section">
            <div className="pc-section-label">Current company</div>
            <p className="pc-desc">{person.currentCompany}</p>
          </div>
        )}

        {person.foundedAt.length > 0 && (
          <div className="sdp-section">
            <div className="pc-section-label">{person.foundedAt.length > 1 ? 'Founder of' : 'Founder at'}</div>
            <div className="pc-founders">
              {person.foundedAt.map((f) => (
                <div className="pc-founder" key={f.company}>
                  <span className="pc-founder-name">
                    {f.website ? (
                      <a href={f.website} target="_blank" rel="noopener noreferrer">{f.company}</a>
                    ) : f.company}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {person.notableWork && (
          <div className="sdp-section">
            <div className="pc-section-label">Notable work</div>
            <p className="pc-desc">{person.notableWork}</p>
          </div>
        )}

        <a
          className="pc-link sdp-website-link"
          href={person.link || linkedInSearch}
          target="_blank"
          rel="noopener noreferrer"
        >
          {person.link ? externalLinkLabel(person.link) : 'Search LinkedIn ↗'}
        </a>

        <p className="person-profile-footnote">
          Industry, location and previous companies aren&rsquo;t tracked for people yet - shown here once real data exists.
        </p>
      </div>
    </div>
  );
}
