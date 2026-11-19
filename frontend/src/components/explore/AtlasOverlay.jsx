// What is drawn over the map on the map page: the compass, in a corner. The city menu, the kicker, the line that said what the picture was and the hint have gone: the
// city is picked in the panel's own row (or on the map by its name), and the map says the rest by being the map.
export default function AtlasOverlay() {
  return (
    <svg className="at-compass" viewBox="0 0 52 52" width="46" height="46" aria-hidden="true" focusable="false">
      <circle cx="26" cy="26" r="25" className="at-compass-disc" />
      <text x="26" y="14" textAnchor="middle" className="at-compass-n">N</text>
      <path d="M26 17 31 30 26 27.5 21 30Z" className="at-compass-needle" />
      <path d="M26 27.5 31 30 26 42 21 30Z" className="at-compass-tail" />
    </svg>
  );
}
