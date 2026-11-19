import { CLUSTER_MEDIUM, CLUSTER_LARGE } from '../mapPins.js';

// One mark and what it means. The marks are drawn with the map's own classes (shrunk in explore.css), so the key shows what the
// map draws and cannot fall behind it.
function Row({ mark, children }) {
  return (
    <div className="mk-row">
      <span className="mk-mark" aria-hidden="true">{mark}</span>
      <p className="mk-text">{children}</p>
    </div>
  );
}

function Pin({ extra = '', children }) {
  return (
    <span className={`custom-pin-badge pin-tile ${extra}`.trim()}>
      <span className="pin-face"><span className="pin-fallback">A</span></span>
      {children}
    </span>
  );
}

// The key to the map's marks, in the filter panel's Map tab (so it is out of the way until it is wanted). It is for the map: the list has no marks. `places` is whether the map groups
// places into numbered rings and draws a dashed ring for a city (the older map does; the map page does neither: a company is its logo, and one known only to its city is in the list).
export default function MapKey({ showInstitutions = false, places = true }) {
  return (
    <section className="mk" aria-label="Map key">
      <div className="mk-group">
        <h3 className="mk-label">A startup</h3>
        <Row mark={<Pin />}>A rounded square with the company&rsquo;s logo, or its first letter when it has none or the logo does not load. Press it for its panel.</Row>
        <Row mark={<Pin><span className="pin-hiring-dot" /></Pin>}>A mint dot: hiring now (an open role was checked).</Row>
        <Row mark={<Pin><span className="pin-tracked-star">&#9733;</span></Pin>}>A star: a company you saved (kept in this browser).</Row>
        <Row mark={<Pin extra="pin-approx" />}>A dashed edge: placed at the suburb, not at the office.</Row>
        {!places && <Row mark={<span className="pin-dot" />}>A small dot: there is no room for its logo at this zoom. Zoom in, or open it from the list.</Row>}
      </div>

      <div className="mk-group">
        <h3 className="mk-label">A venture capital firm</h3>
        <Row mark={<Pin extra="pin-vc"><span className="pin-vc-badge">VC</span></Pin>}>A square with VC on it and a solid edge: an office, drawn at the street address the firm&rsquo;s own page gives.</Row>
        {places && (
          <Row mark={<Pin extra="pin-vc pin-approx"><span className="pin-vc-badge">VC</span></Pin>}>A square with VC on it and a dashed edge: only the firm&rsquo;s city. Its record gives no street address for it that could be placed, so it is drawn at the city&rsquo;s centre and is not an office.</Row>
        )}
        {!places && <Row mark={<span className="pin-dot pin-dot-vc" />}>A small yellow dot: a firm with no room for its logo at this zoom.</Row>}
        {!places && <p className="mk-note">A firm known only to its city has no mark: it is in the list beside the map.</p>}
      </div>

      {(places || showInstitutions) && (
        <div className="mk-group">
          <h3 className="mk-label">Places</h3>
          {places && (
            <>
              <Row mark={<span className="marker-cluster-inner cluster-small">12</span>}>
                A numbered ring: places close together. The bigger the ring, the more it holds. Press it to open them (VCs in one city are listed, since they share a point).
              </Row>
              <p className="mk-sizes">
                <span><i className="mk-dot cluster-small" aria-hidden="true" />under {CLUSTER_MEDIUM}</span>
                <span><i className="mk-dot cluster-medium" aria-hidden="true" />{CLUSTER_MEDIUM} to {CLUSTER_LARGE - 1}</span>
                <span><i className="mk-dot cluster-large" aria-hidden="true" />{CLUSTER_LARGE} or more</span>
              </p>
              <Row mark={<span className="mk-ring" />}>A dashed ring: companies known only to a city or a state, so no pin. Press its label to open them.</Row>
            </>
          )}
          {showInstitutions && <Row mark={<span className="inst-pin"><span className="inst-initial">B</span></span>}>A rounded square: an investor&rsquo;s office, with the firm&rsquo;s first letter.</Row>}
        </div>
      )}

      <p className="mk-note">Names appear under the pins as you zoom in, where there is room for them.</p>
    </section>
  );
}
