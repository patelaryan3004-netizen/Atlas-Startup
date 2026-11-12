// The national view, drawn inside the map page's own Leaflet map: the land and its coast, the state borders, the lines of latitude and longitude, the names on
// the sea and the states, and a badge for each city that has published pins. It is the same map the pins are on (same projection, same coordinates), so a badge
// is a place on the real map, and zooming into it is zooming the real map. The pieces below fade as the visitor zooms: from the badges and the drawn land,
// through the clusters, to the street map and the single pins (MapView sets the classes; atlas.css does the fading).
import L from 'leaflet';
import { LAND, STATE_LINES, STATE_LABELS, SEA_LABELS, GRATICULE_LINES, PARALLELS, MERIDIANS, tickText } from './geo.js';
import { layoutBadges, labelWidth } from './cities.js';

const HATCH = 'atlas-hatch';

// The drawing. Returns what the map page needs to drive it.
export function createAtlas(map, { onPickCity } = {}) {
  map.createPane('atlas-ground').style.zIndex = '260';
  map.createPane('atlas-names').style.zIndex = '270';
  map.createPane('atlas-badges').style.zIndex = '620';
  const renderer = L.svg({ pane: 'atlas-ground', padding: 0.4 });
  const common = { renderer, pane: 'atlas-ground', interactive: false, bubblingMouseEvents: true };

  // The hatch the land is filled with, in the same <svg> as the land.
  renderer.addTo(map);
  const svg = renderer._container;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `<pattern id="${HATCH}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" class="atlas-hatch-line" stroke-width="1"/></pattern>`;
  svg.prepend(defs);

  const group = L.layerGroup().addTo(map);
  for (const line of GRATICULE_LINES) L.polyline(line, { ...common, className: 'atlas-grid', weight: 1, fill: false }).addTo(group);
  const rings = LAND.map((ring) => [ring]);
  // The glow round the coast: wide, faint strokes stacked under the land, each narrower and brighter than the last.
  [46, 30, 18, 9].forEach((weight, i) => L.polygon(rings, { ...common, className: `atlas-glow atlas-glow-${i + 1}`, weight, fill: false, lineJoin: 'round', smoothFactor: 1.5 }).addTo(group));
  L.polygon(rings, { ...common, className: 'atlas-land', weight: 1, smoothFactor: 0.6 }).addTo(group);
  L.polygon(rings, { ...common, className: 'atlas-hatch', weight: 0, fill: true, smoothFactor: 0.6 }).addTo(group);
  L.polygon(rings, { ...common, className: 'atlas-coast', weight: 1.1, fill: false, smoothFactor: 0.6 }).addTo(group);
  for (const line of STATE_LINES) L.polyline(line, { ...common, className: 'atlas-border', weight: 1, fill: false }).addTo(group);

  const label = (item, className) => L.marker([item.lat, item.lng], {
    pane: 'atlas-names', interactive: false, keyboard: false,
    icon: L.divIcon({ className: 'atlas-name-icon', html: `<span class="${className}">${item.name}</span>`, iconSize: [0, 0] }),
  });
  for (const item of STATE_LABELS) label(item, 'atlas-state').addTo(group);
  for (const item of SEA_LABELS) label(item, 'atlas-sea').addTo(group);

  // The ticks on the edges of the map: where the lines of latitude and longitude run off it. HTML on the map's own element, moved with the map.
  const ticks = document.createElement('div');
  ticks.className = 'atlas-ticks';
  ticks.setAttribute('aria-hidden', 'true');
  const tickEls = [];
  for (const lat of PARALLELS) { const el = document.createElement('span'); el.className = 'atlas-tick atlas-tick-lat'; el.textContent = tickText.lat(lat); tickEls.push({ el, lat }); }
  for (const lng of MERIDIANS) { const el = document.createElement('span'); el.className = 'atlas-tick atlas-tick-lng'; el.textContent = tickText.lng(lng); tickEls.push({ el, lng }); }
  ticks.append(...tickEls.map((t) => t.el));
  map.getContainer().append(ticks);
  const placeTicks = () => {
    const size = map.getSize();
    for (const t of tickEls) {
      if (t.lat != null) {
        const y = map.latLngToContainerPoint([t.lat, 133]).y;
        t.el.style.transform = `translate(0, ${Math.round(y)}px)`;
        t.el.hidden = y < 190 || y > size.y - 90; // the heading is over the top of the left edge, the way back and the zoom buttons over the bottom
      } else {
        const x = map.latLngToContainerPoint([-30, t.lng]).x;
        t.el.style.transform = `translate(${Math.round(x)}px, 0)`;
        t.el.hidden = x < 230 || x > size.x - 110;
      }
    }
  };

  // ----- the city badges -----
  const badgeLayer = L.layerGroup().addTo(map);
  let badges = [];
  let drawn = new Map(); // city -> { el, chip }
  const prefer = {};

  const place = () => {
    const size = map.getSize();
    const at = badges.map((b) => { const p = map.latLngToContainerPoint([b.lat, b.lng]); return { city: b.city, x: p.x, y: p.y, w: labelWidth(b.city, b.count) }; });
    for (const spot of layoutBadges(at, size, { prefer })) {
      const entry = drawn.get(spot.city);
      if (!entry) continue;
      entry.el.hidden = Boolean(spot.hidden); // (a label with nowhere to go is left off; its anchor stays)
      entry.chip.hidden = Boolean(spot.hidden);
      if (spot.hidden) continue;
      entry.el.dataset.side = spot.side;
      if (spot.dy) entry.el.dataset.lead = ''; else delete entry.el.dataset.lead;
      entry.el.style.setProperty('--dy', `${spot.dy}px`);
      entry.el.style.setProperty('--lead-top', `${Math.min(0, spot.dy)}px`);
      entry.el.style.setProperty('--lead-h', `${Math.abs(spot.dy)}px`);
    }
  };

  const setBadges = (next) => {
    badges = next;
    badgeLayer.clearLayers();
    drawn = new Map();
    for (const b of badges) {
      const el = document.createElement('div');
      el.className = 'atlas-badge';
      el.dataset.side = b.lng < 125 ? 'left' : 'right';
      const anchor = document.createElement('span');
      anchor.className = 'atlas-anchor';
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'atlas-chip';
      chip.setAttribute('aria-label', `${b.city}, ${b.count} ${b.count === 1 ? 'organisation' : 'organisations'} on the map. Zoom to ${b.city}.`);
      const name = document.createElement('b');
      name.textContent = b.city;
      const count = document.createElement('span');
      count.className = 'atlas-n';
      count.textContent = String(b.count);
      chip.append(name, count);
      el.append(anchor, chip);
      chip.addEventListener('click', (event) => { event.stopPropagation(); onPickCity?.(b.city); });
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      L.marker([b.lat, b.lng], { pane: 'atlas-badges', keyboard: false, icon: L.divIcon({ className: 'atlas-badge-icon', html: el, iconSize: [0, 0] }) }).addTo(badgeLayer);
      drawn.set(b.city, { el, chip });
      if (b.lng < 125) prefer[b.city] = 'left';
    }
    place();
  };

  const relayout = () => { place(); placeTicks(); };
  map.on('zoomend moveend resize', relayout);
  relayout();

  return {
    setBadges,
    relayout,
    destroy() {
      map.off('zoomend moveend resize', relayout);
      ticks.remove();
      group.remove();
      badgeLayer.remove();
      renderer.remove();
    },
  };
}
