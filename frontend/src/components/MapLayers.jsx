// The map's layers and its look, in the filter panel's Map tab: Companies and Institutions switch on and off (the Institutions switch is only here
// when there are firms' offices to draw), and the basemap is Dark or Light. Both basemaps are here so the two can be compared side by side with
// the pins on them; the choice is kept in this browser.
export const BASEMAPS = ['dark', 'light'];

export default function MapLayers({ showCompanies, onToggleCompanies, institutionCount = 0, showInstitutions, onToggleInstitutions, basemap, onBasemap }) {
  return (
    <div className="ml" role="group" aria-label="Map layers">
      <div className="fsection-label">Layers</div>
      <div className="ml-row">
        <button type="button" className="ml-btn" aria-pressed={showCompanies} onClick={onToggleCompanies}>
          <span className="ml-swatch ml-swatch-company" aria-hidden="true" />Companies
        </button>
        {institutionCount > 0 && (
          <button type="button" className="ml-btn" aria-pressed={showInstitutions} onClick={onToggleInstitutions}>
            <span className="ml-swatch ml-swatch-firm" aria-hidden="true" />Institutions <span className="ml-count">{institutionCount}</span>
          </button>
        )}
      </div>
      <div className="fsection-label">Basemap</div>
      <div className="ml-row" role="group" aria-label="Basemap">
        {BASEMAPS.map((name) => (
          <button key={name} type="button" className="ml-btn ml-basemap" aria-pressed={basemap === name} onClick={() => onBasemap(name)}>
            {name === 'dark' ? 'Dark map' : 'Light map'}
          </button>
        ))}
      </div>
    </div>
  );
}
