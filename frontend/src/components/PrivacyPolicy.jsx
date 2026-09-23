export default function PrivacyPolicy({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>Privacy</h2>

        <div className="pc-section-label">What we collect</div>
        <p className="modal-sub">
          The &ldquo;Submit a startup&rdquo; and &ldquo;Suggest an edit&rdquo; forms send whatever you
          type — including your email if you choose to give one — to our review queue. We use
          it only to follow up on that submission and to consider it for the map. We don&rsquo;t sell
          it, and we don&rsquo;t use it for marketing.
        </p>

        <div className="pc-section-label">What we don&rsquo;t collect</div>
        <p className="modal-sub">
          No account, no tracking cookies, no analytics pixel. Your browser may cache map data locally
          (localStorage) purely to remember UI preferences like whether the news panel is open.
        </p>

        <div className="pc-section-label">Business details</div>
        <p className="modal-sub form-error" style={{ marginBottom: 0 }}>
          Placeholder — operator name, ABN, and contact details go here before this site is public.
          Not filled in yet.
        </p>
      </div>
    </div>
  );
}
