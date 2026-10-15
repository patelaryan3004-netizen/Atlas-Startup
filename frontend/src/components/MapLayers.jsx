// The map's layers and its look, in the filter panel's Map tab: the Institutions switch (only here when there are firms' offices to draw), and the
// basemap, Dark or Light. (Which of the startups and the VCs are drawn is the toolbar's All / Startups / VCs.) Both basemaps are here so the two can be compared side by side with
// the pins on them; the choice is kept in this browser.
export const BASEMAPS = ['dark', 'light'];

export default function MapLayers({ institutionCount = 0, showInstitutions, onToggleInstitutions, basemap, onBasemap }) {
  return (
    <div className="ml" role="group" aria-label="Map layers">
      {institutionCount > 0 && (
        <>
          <div className="fsection-label">Layers</div>
          <div className="ml-row">
            <button type="button" className="ml-btn" aria-pressed={showInstitutions} onClick={onToggleInstitutions}>
              <span className="ml-swatch ml-swatch-firm" aria-hidden="true" />Institutions <span className="ml-count">{institutionCount}</span>
            </button>
          </div>
        </>
      )}
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
