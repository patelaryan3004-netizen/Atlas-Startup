import { DIRECTORY_URL } from '../api.js';

export default function AboutSources({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h3>About &amp; sources</h3>
        <p className="modal-sub">
          AU Startup Map is an independent, unofficial directory of Australian startups. It is not
          affiliated with, endorsed by, or operated on behalf of any company listed.
        </p>

        <div className="pc-section-label">Where the data comes from</div>
        <p className="modal-sub">
          Based on public sources — company websites, LinkedIn, press coverage, and VC/accelerator
          portfolio pages — plus direct submissions from founders and the public via the
          &ldquo;Submit a startup&rdquo; and &ldquo;Suggest an edit&rdquo; forms. Every submission is
          reviewed by a person before it changes the map; nothing is auto-published.
        </p>

        <div className="pc-section-label">Accuracy</div>
        <p className="modal-sub">
          This is a beta, best-effort project. Locations are geocoded from the most specific address
          we have on file; where only a city is confirmed, the pin sits at that city&rsquo;s centre
          and the popup says so. Companies we couldn&rsquo;t confirm a real Australian HQ for are
          listed under &ldquo;Unconfirmed&rdquo; rather than guessed. Company names and logos are
          used for identification only, under fair use — no ownership is claimed. If anything is
          wrong, use &ldquo;Suggest an edit&rdquo; on that company&rsquo;s pin.
        </p>

        <div className="pc-section-label">Full list</div>
        <p className="modal-sub">
          Prefer a plain list? <a className="pc-link" href={DIRECTORY_URL}>Browse every company without JavaScript</a>.
        </p>
      </div>
    </div>
  );
}
