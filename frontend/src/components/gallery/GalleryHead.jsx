import ViewToggle from './ViewToggle.jsx';

// The top of the gallery page: what it is, a line on how to use it, and the switch to the map. The heading is the map page's ("Startup atlas.") in the same
// serif, so the two read as two views of one thing.
function Sunburst() {
  return (
    <svg className="gl-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
    </svg>
  );
}

export default function GalleryHead({ onView, fromMap = false }) {
  return (
    <header className="gl-head">
      <div className="gl-head-copy">
        <p className="gl-kicker"><Sunburst /><span>Still Early field guide</span></p>
        <h1 className="gl-title">Startup <em>gallery.</em></h1>
        <p className="gl-lede">Australian startups, by what they make. Choose a city or an industry, or take the same search to the map.</p>
      </div>
      <ViewToggle value="gallery" onChange={onView} mapLabel={fromMap ? 'Back to map' : 'Map'} />
    </header>
  );
}
