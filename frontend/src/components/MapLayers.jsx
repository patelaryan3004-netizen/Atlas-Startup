// The map's layers, in the filter panel's Map tab: the Institutions switch, only there when there are firms' offices to draw. (Which of the startups and the
// VCs are drawn is the toolbar's All / Startups / VCs; the map's background is one light one.)
export default function MapLayers({ institutionCount = 0, showInstitutions, onToggleInstitutions }) {
  if (institutionCount === 0) return null;
  return (
    <div className="ml" role="group" aria-label="Map layers">
      <div className="fsection-label">Layers</div>
      <div className="ml-row">
        <button type="button" className="ml-btn" aria-pressed={showInstitutions} onClick={onToggleInstitutions}>
          <span className="ml-swatch ml-swatch-firm" aria-hidden="true" />Institutions <span className="ml-count">{institutionCount}</span>
        </button>
      </div>
    </div>
  );
}
