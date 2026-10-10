import { useEscapeClose } from '../hooks/useEscapeClose.js';

// A link that names a company or a list the directory does not have: said plainly, with the way back.
export default function PageNotFound({ title, children, onClose }) {
  useEscapeClose(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="notfound-title" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>&#10005;</button>
        <h2 id="notfound-title">{title}</h2>
        <p className="modal-sub">{children}</p>
        <button type="button" className="hdrbtn hdrbtn-accent" onClick={onClose}>Back to the map</button>
      </div>
    </div>
  );
}
