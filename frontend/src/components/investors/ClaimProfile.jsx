import { useEscapeClose } from '../../hooks/useEscapeClose.js';

// "Claim this profile" is not open yet, and says why. A claim has to prove that whoever asks speaks for the investor, and
// this site has no accounts and takes nobody's word (or email address) for it. Until it can, a correction with a page is the
// way to change a profile.
export default function ClaimProfile({ investor, onClose, onSuggest }) {
  useEscapeClose(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="inv-claim-title" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2 id="inv-claim-title">Claiming a profile is not open yet</h2>
        <p className="modal-sub">
          Claiming <b>{investor.name}</b>&rsquo;s profile would let someone change it, so it has to prove that they speak for the investor.
          This site has no accounts yet, and an email address or a name is not proof, so claiming stays closed until it can be done properly.
        </p>
        <p className="modal-sub">
          Meanwhile, anyone can suggest a correction. A person checks it against a page, such as the investor&rsquo;s own site, before anything changes.
        </p>
        <div className="form-actions">
          <button type="button" className="taskbtn" onClick={onSuggest}>Suggest a correction</button>
          <button type="button" className="linkbtn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
