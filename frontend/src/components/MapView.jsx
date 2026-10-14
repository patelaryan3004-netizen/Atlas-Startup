import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css'; // with the map's own file, not the page's: only the map needs it (it used to be a stylesheet every page waited for)
import { fetchStartup } from '../api.js';
import { companyPopup, institutionPopup } from '../mapPopups.js';
import { createPinIndex } from '../pinIndex.js';
import { paddedWindow, pinPayload, clusterSize, CLUSTER_PX, showLogos, locationQuality, areaLabel, areaMember, labelsVisible, chooseLabels, CLUSTER_MAX_ZOOM } from '../mapPins.js';

// A pin's logo, over the plain initial-letter badge rendered underneath this <img>. It is the company's OWN picture (its `logo` address) and
// nobody else's: no logo is asked of a third-party service. It appears only once it has loaded; until then, and if it never does, the first
// letter shows. The pins are what the map is for, so their pictures are asked for at once.
function logoImg(src) {
  const img = document.createElement('img');
  img.className = 'pin-logo';
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => { if (img.naturalWidth > 0) img.classList.add('pin-logo-ready'); else img.style.display = 'none'; };
  img.onerror = () => { img.style.display = 'none'; };
  img.src = src;
  return img;
}

// The name under a pin. It starts hidden: the map shows it (placeLabels) once zoomed in and only where it fits. The hover tooltip and the
// company's card carry the name for everyone else, so the label is for looking, not for reading out.
function labelElement(name) {
  const label = document.createElement('span');
  label.className = 'pin-label';
  label.setAttribute('aria-hidden', 'true');
  label.textContent = name || '';
  return label;
}

// Everything the map puts on the page is built as elements, never as an HTML string: a company's name is data.
// A pin is a small dot. The ones worth seeing from afar are a white tile with the company's own logo, or its first letter: a company that is
// hiring now, one that is saved, the one that is open, and any company whose own logo is known and close enough to draw. (No logo is asked
// of a third-party service: a tile without a logo of its own is its letter.)
const isTile = ({ hiring, selected, tracked, logos, logo }) => Boolean(hiring || selected || tracked || (logos && logo));

function pinElement(tuple, { logos, selected, tracked }) {
  const [, name, , , , , hiring, , precision, , , logo] = tuple;
  const tile = isTile({ hiring, selected, tracked, logos, logo });
  const root = document.createElement('div');
  // A suburb is not an office: its pin is drawn as approximate (a dashed edge), so it is never read as an address.
  root.className = `custom-pin-badge ${tile ? 'pin-tile' : 'pin-dot'}${selected ? ' pin-selected' : ''}${precision === 'SUBURB' ? ' pin-approx' : ''}`;
  const face = document.createElement('span');
  face.className = 'pin-face';
  if (tile) {
    const fallback = document.createElement('span');
    fallback.className = 'pin-fallback';
    fallback.textContent = (name || '?').trim().charAt(0).toUpperCase();
    face.append(fallback);
    if (logos && logo) face.append(logoImg(logo));
  }
  root.append(face, labelElement(name));
  if (hiring) {
    const dot = document.createElement('span');
    dot.className = 'pin-hiring-dot';
    dot.title = 'Hiring now';
    root.append(dot);
  }
  if (tracked) {
    const star = document.createElement('span');
    star.className = 'pin-tracked-star';
    star.textContent = '★';
    root.append(star);
  }
  return root;
}

// A firm's office: a rounded square with the accent as its outline and the firm's initial in it, so it is never taken for a company.
function institutionElement(pin) {
  const root = document.createElement('div');
  root.className = 'inst-pin';
  const initial = document.createElement('span');
  initial.className = 'inst-initial';
  initial.textContent = (pin.name || '?').trim().charAt(0).toUpperCase();
  root.append(initial, labelElement(pin.name));
  return root;
}

// A cluster is a ring like a pin's: the same dark fill, the one accent for its number, and a size that says how many it holds.
function clusterElement(count) {
  const inner = document.createElement('div');
  inner.className = `marker-cluster-inner cluster-${clusterSize(count)}`;
  inner.textContent = String(count);
  return inner;
}
const clusterIcon = (count) => {
  const px = CLUSTER_PX[clusterSize(count)];
  return L.divIcon({ html: clusterElement(count), className: 'marker-cluster-custom', iconSize: [px, px] });
};

// Name, where, and how well that is known: "Example Startup / 123 Example Street, Melbourne / Verified office". A pin from
// a server that does not say how well a place is known gets what it always got: the name, the sector and the city.
function tooltipContent(tuple) {
  const [, name, , , sector, city, , , precision, place, checked] = tuple;
  const box = document.createElement('div');
  const strong = document.createElement('b');
  strong.textContent = name;
  if (!precision) {
    box.append(strong, document.createElement('br'), document.createTextNode(`${sector} · ${city}`));
    return box;
  }
  const where = document.createElement('div');
  where.className = 'tip-place';
  where.textContent = place || city;
  const quality = document.createElement('div');
  quality.className = `tip-quality tip-${precision.toLowerCase()}`;
  quality.textContent = locationQuality(precision, checked === 1 || checked === true);
  box.append(strong, where, quality);
  return box;
}

// ---------- groups: companies known only to a city or a state ----------

// A group is drawn as a dashed ring at the city, with a label under it: it says "somewhere in this city", and it
// looks nothing like a company's pin or a cluster of them. Built as elements, like everything here.
function areaElement(area) {
  const root = document.createElement('div');
  root.className = `area-marker area-${area.kind.toLowerCase()}`;
  const ring = document.createElement('span');
  ring.className = 'area-ring';
  ring.setAttribute('aria-hidden', 'true');
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'area-chip';
  chip.setAttribute('aria-label', areaLabel(area));
  const name = document.createElement('b');
  name.textContent = area.label;
  const count = document.createElement('span');
  count.className = 'area-count';
  count.textContent = String(area.count);
  const level = document.createElement('span');
  level.className = 'area-level';
  level.textContent = area.kind === 'STATE' ? 'state-level' : 'city-level';
  chip.append(name, count, level);
  root.append(ring, chip);
  return root;
}

// What a click on a group opens: what it is, a few of its companies by name, and the rest one click away.
function areaPopup(area, { onPick, onViewAll }) {
  const box = document.createElement('div');
  box.className = 'area-pop';
  const title = document.createElement('b');
  title.className = 'area-pop-title';
  title.textContent = areaLabel(area);
  const note = document.createElement('p');
  note.className = 'area-pop-note';
  note.textContent = 'We know the place, not the office, so these companies have no pin of their own.';
  const list = document.createElement('ul');
  list.className = 'stack-list';
  for (const member of area.sample ?? []) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stack-item';
    button.textContent = member.name;
    button.addEventListener('click', () => onPick(areaMember(area, member)));
    item.append(button);
    list.append(item);
  }
  box.append(title, note, list);
  if (area.count > 0) {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'area-viewall';
    all.textContent = `View all ${area.count} in the list`;
    all.addEventListener('click', () => onViewAll(area));
    box.append(all);
  }
  return box;
}

// Companies at one place (they cannot be told apart on a map): a short list to pick from.
function stackList(members, tuples, onPick) {
  const list = document.createElement('ul');
  list.className = 'stack-list';
  members.slice(0, 50).forEach((i) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stack-item';
    button.textContent = tuples[i][1];
    button.addEventListener('click', () => onPick(pinPayload(tuples[i])));
    item.append(button);
    list.append(item);
  });
  if (members.length > 50) {
    const more = document.createElement('li');
    more.className = 'stack-more';
    more.textContent = `and ${members.length - 50} more`;
    list.append(more);
  }
  return list;
}

// Defaults that are the same object every render, so an omitted prop does not look like a change each time.
const NO_MARKERS = [];
const NO_AREAS = [];
const NO_INSTITUTIONS = [];

// A pin is a few elements with a shadow, and a jump to street level in a dense place can put a couple of hundred on a
// phone's screen at once. Making them all in one go held a slow phone for most of a second, so a draw makes a few at a
// time and leaves the rest to the next frames: the page keeps answering touches while the pins fill in. A batch that
// took long makes the next one smaller and a quick one makes it bigger, so a fast computer still draws them all at once.
// Below this width (a phone) names appear from a deeper zoom, because a name is a bigger part of a small screen.
const NARROW = '(max-width: 639px)';
const FIRST_BATCH = 12;
const SLOW_BATCH_MS = 24;
const QUICK_BATCH_MS = 8;
// The toolbar is above the map, not over it: a card (a group's list, a firm's) pans clear of what floats at the top and the bottom.
const POPUP_PAN = { autoPanPaddingTopLeft: [24, 64], autoPanPaddingBottomRight: [24, 96] };
// Where the map starts, and goes back to for all of Australia: where nearly every startup is (the south-east), a country's width on a phone.
const HOME = { center: [-33.0, 145.0], zoom: 5 };
const HOME_NARROW = { center: [-31.0, 145.5], zoom: 4 };
// A city's pins are fitted to the window with room for what floats over the map, and never closer than street level.
const FIT_PADDING = { desktop: { paddingTopLeft: [48, 72], paddingBottomRight: [48, 120] }, narrow: { paddingTopLeft: [32, 56], paddingBottomRight: [32, 150] } };
const FIT_MAX_ZOOM = 13;
const AREA_FIT_MAX_ZOOM = 10; // a city known only as a group is a place, not an office: the map shows the city, not a street
// What a pressed pin's place is brought clear of at the edges of the map, in pixels, and how close the map comes to one it has to fly to.
const FOCUS_EDGE = 28;
const SELECTED_Z = 1000; // how far over the rest the open company's pin, and one that is hiring, are drawn
const HIRING_Z = 400;
const FOCUS_ZOOM = 12;

// A card grows after it opens: the company's record arrives, "More" is unfolded. Leaflet pans only as a popup opens, so it is asked to
// look again each time, and the card is not left under the search box. Returns what to call when the card's content has changed.
function keepClear(popup, element) {
  const again = () => popup.update?.();
  element.addEventListener('toggle', again, true); // "toggle" does not bubble, so it is caught on the way down
  return again;
}

// The map's tiles. With a Mapbox token the styles are Mapbox's (dark-v11, light-v11); without one the free OpenStreetMap tiles are used,
// inverted to dark by the .osm-inverted class (styles.css) or left as they are for the light map.
const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
const mapboxUrl = (basemap) => `https://api.mapbox.com/styles/v1/mapbox/${basemap === 'light' ? 'light-v11' : 'dark-v11'}/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`;

// markers: one compact array per company whose place is a point, an exact office or a suburb (see fetchMarkers). Only
// what is in view is ever turned into elements: pins and clusters are worked out for the window and zoom, and drawn or
// removed as the map moves, so the cost depends on what is on screen and not on how many companies there are.
// areas: one group per city or state for the companies known only to that much, drawn as a group and never as a pin
// (there are a few dozen at most, so all are drawn). Clicking one lists a few of them (onSelectStartup opens one) and
// onViewArea(area) opens the rest as a list; with neither handler (the landing page) a group is a label to hover.
// institutionPins: the firms' offices ({ id, name, lat, lng, city, place, office, website, href }), a few dozen at most, all drawn.
// showCompanies and showInstitutions are the two layers' switches; basemap is 'dark' or 'light'.
// onSelectPin(company): a pin was pressed (the page shows its card; without it the map opens its own small card), and onClearPin(): the bare map
// was. scope: what the map is narrowed to ("Melbourne", or "" for all of Australia): when it changes, the map moves to fit the pins that come next.
// focus: { key, lat, lng, inset }: bring this place into view, clear of the `inset` pixels at the bottom that a sheet covers; { key, home: true }
// goes back to all of Australia. onViewChange({ lat, lng, zoom }) says where the map is looking after each move.
export default function MapView({
  markers = NO_MARKERS, areas = NO_AREAS, onSelectStartup, onViewArea, selectedName, trackedNames,
  institutionPins = NO_INSTITUTIONS, showCompanies = true, showInstitutions = true, basemap = 'dark', onOpenInternal, onReportRoleClosed,
  onSelectPin, onClearPin, scope = '', focus = null, onViewChange,
}) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const tilesRef = useRef(null);
  const layerRef = useRef(null);
  const areaLayerRef = useRef(null);
  const instLayerRef = useRef(null);
  const indexRef = useRef(null);
  const shownRef = useRef(new Map());
  const labelsRef = useRef(new Map()); // for each pin on the map: where it is, its name, and the element that says it
  const clustersRef = useRef(new Map()); // for each cluster on the map: where it is (a name is kept clear of it)
  const frameRef = useRef(0);
  const latest = useRef({});
  latest.current = { markers, areas, onSelectStartup, onViewArea, selectedName, trackedNames, showCompanies, basemap, onOpenInternal, onReportRoleClosed, onSelectPin, onClearPin, onViewChange };
  const scopeRef = useRef(scope);
  const wantsFit = useRef(Boolean(scope)); // the map opened on a city: it goes there once the pins are in
  const homeRef = useRef(HOME);

  // Writes the names under the pins that have room for one. From zoom 7 (9 on a phone) the pins on screen are looked at in the
  // order worth naming (the open one, then those hiring, then the rest): a name is written only where it covers no other name
  // and no other pin. Below that zoom the map shows circles only.
  const placeLabels = useCallback(() => {
    const map = mapRef.current;
    const root = mapElRef.current;
    if (!map || !root) return;
    const narrow = typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;
    const on = labelsVisible(map.getZoom(), narrow);
    root.classList.toggle('show-pin-labels', on);
    if (!on) return;
    const pins = [];
    for (const [id, p] of labelsRef.current) {
      const at = map.latLngToContainerPoint([p.lat, p.lng]);
      pins.push({ id, x: at.x, y: at.y, text: p.text, rank: p.rank });
    }
    const blockers = [];
    for (const c of clustersRef.current.values()) blockers.push(map.latLngToContainerPoint([c.lat, c.lng]));
    const named = chooseLabels(pins, { blockers });
    for (const [id, p] of labelsRef.current) p.el.classList.toggle('pin-label-on', named.has(id));
  }, []);

  // A company's card: what the pin knows at once, and what the full record says when it arrives. Its one call to action opens the company.
  const openCompanyCard = useCallback((tuple, lat, lng) => {
    const map = mapRef.current;
    if (!map) return;
    const card = companyPopup(tuple, {
      onOpen: () => { map.closePopup?.(); latest.current.onSelectStartup?.(pinPayload(tuple)); },
      // The link is left out of the card when the page gave no way to report (a tuple's name is the company's name).
      onReport: latest.current.onReportRoleClosed ? () => { map.closePopup?.(); latest.current.onReportRoleClosed?.(tuple[1]); } : undefined,
    });
    const popup = L.popup({ className: 'pin-popup', minWidth: 230, maxWidth: 290, offset: [0, -16], ...POPUP_PAN }).setLatLng([lat, lng]).setContent(card.element).openOn(map);
    const again = keepClear(popup, card.element);
    fetchStartup(tuple[0]).then((record) => { card.fill(record); again(); }, () => { /* the card keeps what the pin knows */ });
  }, []);

  // A pin was pressed: the page shows the company's card. A page that has no card for it (it gave no onSelectPin) gets the map's own popup.
  const pickPin = useCallback((tuple, lat, lng) => {
    const { onSelectPin: pick } = latest.current;
    if (pick) pick(pinPayload(tuple)); else openCompanyCard(tuple, lat, lng);
  }, [openCompanyCard]);

  const draw = useCallback(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const index = indexRef.current;
    if (!map || !layer || !index) return;
    cancelAnimationFrame(frameRef.current); // a newer view replaces whatever the last one had left to make
    const { markers: tuples, onSelectStartup: onSelect, selectedName: selected, trackedNames: tracked, showCompanies: visible } = latest.current;
    const shown = shownRef.current;
    if (!visible) {
      // The companies' layer is switched off: nothing of theirs is on the map (the firms' offices, if on, are untouched).
      layer.clearLayers();
      shown.clear();
      for (const key of [...labelsRef.current.keys()]) if (!key.startsWith('i:')) labelsRef.current.delete(key);
      clustersRef.current.clear();
      placeLabels();
      return;
    }
    const zoom = map.getZoom();
    const features = index.view(paddedWindow(map.getBounds()), zoom);
    const logos = showLogos(zoom, features.filter((f) => f.type === 'pin').length);
    const keep = new Set();
    const todo = [];

    for (const f of features) {
      let key;
      if (f.type === 'cluster') key = `c:${f.id}:${f.count}`;
      else if (f.type === 'stack') key = `s:${f.lat},${f.lng}:${f.members.length}`;
      else {
        const t = tuples[f.i];
        key = `p:${t[0]}:${logos ? 1 : 0}:${t[1] === selected ? 1 : 0}:${tracked?.has(t[1]) ? 1 : 0}`;
      }
      keep.add(key);
      if (!shown.has(key)) todo.push([key, f]);
    }
    // What left the view goes at once (it is cheap and it is what a nudge of the map mostly does)...
    for (const [key, marker] of shown) {
      if (!keep.has(key)) { layer.removeLayer(marker); shown.delete(key); labelsRef.current.delete(key); clustersRef.current.delete(key); }
    }

    const make = ([key, f]) => {
      let marker;
      if (f.type === 'cluster') {
        marker = L.marker([f.lat, f.lng], { icon: clusterIcon(f.count) });
        marker.on('click', () => map.setView([f.lat, f.lng], Math.min(index.expansionZoom(f.id), CLUSTER_MAX_ZOOM + 1)));
        clustersRef.current.set(key, { lat: f.lat, lng: f.lng });
      } else if (f.type === 'stack') {
        marker = L.marker([f.lat, f.lng], { icon: clusterIcon(f.members.length) });
        marker.on('click', () => L.popup({ className: 'stack-popup', maxHeight: 240 }).setLatLng([f.lat, f.lng]).setContent(stackList(f.members, tuples, (p) => { map.closePopup?.(); (latest.current.onSelectPin ?? onSelect)?.(p); })).openOn(map));
        clustersRef.current.set(key, { lat: f.lat, lng: f.lng });
      } else {
        const t = tuples[f.i];
        const html = pinElement(t, { logos, selected: t[1] === selected, tracked: tracked?.has(t[1]) || false });
        // The open company is drawn over its neighbours, and a company that is hiring over those that are not.
        marker = L.marker([f.lat, f.lng], { icon: L.divIcon({ className: 'custom-leaflet-marker', html, iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: t[1] === selected ? SELECTED_Z : t[6] ? HIRING_Z : 0 });
        marker.bindTooltip(tooltipContent(t), { direction: 'top', offset: [0, -20], sticky: true });
        marker.on('click', () => pickPin(t, f.lat, f.lng));
        const el = html.querySelector('.pin-label');
        if (el) labelsRef.current.set(key, { el, lat: f.lat, lng: f.lng, text: t[1] || '', rank: t[1] === selected ? 0 : t[6] ? 1 : tracked?.has(t[1]) ? 2 : 3 });
      }
      marker.addTo(layer);
      shown.set(key, marker);
    };
    // ...and what arrives is made a batch at a time: the first batch now, so a small change (a nudge, a selection) is
    // drawn in the same frame, and the rest on the next frames if there are more.
    let batch = FIRST_BATCH;
    const step = () => {
      const started = performance.now();
      for (const entry of todo.splice(0, batch)) make(entry);
      const took = performance.now() - started;
      if (took > SLOW_BATCH_MS) batch = Math.max(4, batch >> 1); else if (took < QUICK_BATCH_MS) batch = Math.min(96, batch * 2);
      if (todo.length) frameRef.current = requestAnimationFrame(step);
      else placeLabels(); // every pin of this view is on the map: now see which have room for their name
    };
    step();
  }, [placeLabels, pickPin]);

  useEffect(() => {
    const narrow = typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;
    const map = L.map(mapElRef.current, {
      zoomControl: false,
      attributionControl: false, // added below, without Leaflet's own name in front of the credit
      minZoom: 3,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1.0,
    }).setView(narrow ? HOME_NARROW.center : HOME.center, narrow ? HOME_NARROW.zoom : HOME.zoom);
    homeRef.current = narrow ? HOME_NARROW : HOME;
    const start = latest.current.basemap;
    mapElRef.current.dataset.basemap = start;
    if (mapboxToken) {
      tilesRef.current = L.tileLayer(mapboxUrl(start), { attribution: '&copy; Mapbox &copy; OpenStreetMap', tileSize: 512, zoomOffset: -1, maxZoom: 18, noWrap: true }).addTo(map);
    } else {
      // No Mapbox token: the free OpenStreetMap tiles. The dark map is those tiles inverted by the .osm-inverted class (styles.css), not a
      // paid or key-gated dark provider; the light map is the tiles as they are.
      mapElRef.current.classList.toggle('osm-inverted', start === 'dark');
      tilesRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
        noWrap: true,
      }).addTo(map);
    }
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map); // takes the tile layer's credit
    // Groups sit under the pins, in a pane of their own between the tiles and the markers, so the ring of a city never
    // hides a pin or a cluster in it.
    map.createPane('areas').style.zIndex = '450';
    const areaLayer = L.layerGroup().addTo(map);
    const layer = L.layerGroup().addTo(map);
    const instLayer = L.layerGroup().addTo(map);
    map.on('moveend', draw);
    // Where the map is looking, for the little map of Australia in its corner; a press on the bare map puts the open card away.
    const reportView = () => { const c = map.getCenter(); latest.current.onViewChange?.({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }); };
    map.on('moveend', reportView);
    map.on('click', () => latest.current.onClearPin?.());
    mapRef.current = map;
    layerRef.current = layer;
    areaLayerRef.current = areaLayer;
    instLayerRef.current = instLayer;
    draw();
    reportView();
    return () => {
      cancelAnimationFrame(frameRef.current); map.remove();
      mapRef.current = null; layerRef.current = null; areaLayerRef.current = null; instLayerRef.current = null; tilesRef.current = null;
      shownRef.current = new Map(); labelsRef.current = new Map(); clustersRef.current = new Map();
    };
  }, [draw]);

  // The basemap was changed: Mapbox's styles are a new address for the tiles; the free tiles are the same, inverted or not.
  const basemapSeen = useRef(false);
  useEffect(() => {
    if (!basemapSeen.current) { basemapSeen.current = true; return; }
    const root = mapElRef.current;
    if (!root) return;
    root.dataset.basemap = basemap;
    if (mapboxToken) tilesRef.current?.setUrl?.(mapboxUrl(basemap));
    else root.classList.toggle('osm-inverted', basemap === 'dark');
  }, [basemap]);

  // The groups (a filter changed, or the companies' layer was switched): they are few and do not depend on the window or the zoom, so all
  // are drawn each time.
  useEffect(() => {
    const map = mapRef.current;
    const layer = areaLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!showCompanies) return;
    for (const area of areas) {
      const label = areaLabel(area);
      const marker = L.marker([area.lat, area.lng], {
        pane: 'areas', title: label, keyboard: false, // the label inside is a button: it is the tab stop
        icon: L.divIcon({ className: 'area-marker-icon', html: areaElement(area), iconSize: [0, 0] }),
      });
      marker.bindTooltip(label, { direction: 'top', offset: [0, 18] });
      marker.on('click', () => {
        const { onSelectStartup: pick, onViewArea: viewAll } = latest.current;
        if (!pick && !viewAll) return;
        L.popup({ className: 'stack-popup area-popup', maxHeight: 380, ...POPUP_PAN }).setLatLng([area.lat, area.lng])
          .setContent(areaPopup(area, { onPick: (member) => pick?.(member), onViewAll: (a) => viewAll?.(a) })).openOn(map);
      });
      marker.addTo(layer);
    }
  }, [areas, showCompanies]);

  // The map moves to the pins of a city: fitted to them, with room for what floats over the map. Without a city it goes back to Australia.
  const fitToPins = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const { markers: tuples, areas: groups } = latest.current;
    const points = tuples.length ? tuples.map((t) => [t[2], t[3]]) : groups.map((g) => [g.lat, g.lng]);
    if (!points.length) return;
    const narrow = typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;
    map.fitBounds(L.latLngBounds(points), { ...(narrow ? FIT_PADDING.narrow : FIT_PADDING.desktop), maxZoom: tuples.length ? FIT_MAX_ZOOM : AREA_FIT_MAX_ZOOM });
  }, []);

  // The scope changed (a city was picked, or cleared): the pins of that city are not here yet, so the fit waits for them (below).
  useEffect(() => {
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;
    wantsFit.current = Boolean(scope);
    if (!scope) mapRef.current?.setView(homeRef.current.center, homeRef.current.zoom);
  }, [scope]);

  // New pins (a filter changed): start from nothing, because a cluster's number belongs to the index that made it.
  useEffect(() => {
    indexRef.current = createPinIndex(markers);
    layerRef.current?.clearLayers();
    shownRef.current = new Map();
    for (const key of [...labelsRef.current.keys()]) if (!key.startsWith('i:')) labelsRef.current.delete(key);
    clustersRef.current = new Map();
    draw();
    if (wantsFit.current && (markers.length || latest.current.areas.length)) { wantsFit.current = false; fitToPins(); }
  }, [markers, draw, fitToPins]);

  // A place to bring into view (a company picked from the sheet, or a pin that a card would cover): left alone if it is already clear of the edges
  // and of the `inset` pixels at the bottom; otherwise the map flies there, a little way past it so it sits above the sheet.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    if (focus.home) { map.setView(homeRef.current.center, homeRef.current.zoom); return; }
    const { lat, lng, inset = 0 } = focus;
    const size = map.getSize();
    const at = map.latLngToContainerPoint([lat, lng]);
    const clear = at.x >= FOCUS_EDGE && at.x <= size.x - FOCUS_EDGE && at.y >= FOCUS_EDGE + 40 && at.y <= size.y - inset - FOCUS_EDGE;
    if (clear) return;
    const zoom = map.getBounds().contains([lat, lng]) ? map.getZoom() : Math.max(map.getZoom(), FOCUS_ZOOM);
    map.flyTo(map.unproject(map.project([lat, lng], zoom).add([0, inset / 2]), zoom), zoom, { duration: 0.6 });
  }, [focus]);

  // The companies' layer was switched on or off.
  const visibleSeen = useRef(false);
  useEffect(() => {
    if (!visibleSeen.current) { visibleSeen.current = true; return; }
    shownRef.current = new Map();
    layerRef.current?.clearLayers();
    draw();
  }, [showCompanies, draw]);

  // A pin's look changed (selected, tracked): only the pins whose look differs are rebuilt. (Not on
  // the first run: the effect above has just drawn, and drawing again would make a second batch of pins in that frame.)
  const looksSeen = useRef(false);
  useEffect(() => {
    if (!looksSeen.current) { looksSeen.current = true; return; }
    draw();
  }, [selectedName, trackedNames, draw]);

  // The firms' offices: few enough that all are drawn, each time they change or the layer is switched.
  useEffect(() => {
    const map = mapRef.current;
    const layer = instLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const key of [...labelsRef.current.keys()]) if (key.startsWith('i:')) labelsRef.current.delete(key);
    if (showInstitutions) {
      for (const pin of institutionPins) {
        const html = institutionElement(pin);
        const marker = L.marker([pin.lat, pin.lng], { icon: L.divIcon({ className: 'custom-leaflet-marker', html, iconSize: [44, 44], iconAnchor: [22, 22] }) });
        marker.bindTooltip(pin.office ? `${pin.name} — ${pin.office}` : pin.name, { direction: 'top', offset: [0, -20], sticky: true });
        marker.on('click', () => {
          const card = institutionPopup(pin, { onOpen: (href) => { map.closePopup?.(); latest.current.onOpenInternal?.(href); } });
          const popup = L.popup({ className: 'pin-popup', minWidth: 230, maxWidth: 290, offset: [0, -16], ...POPUP_PAN }).setLatLng([pin.lat, pin.lng]).setContent(card.element).openOn(map);
          keepClear(popup, card.element);
        });
        marker.addTo(layer);
        const el = html.querySelector('.pin-label');
        if (el) labelsRef.current.set(`i:${pin.id}`, { el, lat: pin.lat, lng: pin.lng, text: pin.name || '', rank: 3 });
      }
    }
    placeLabels();
  }, [institutionPins, showInstitutions, placeLabels]);

  return <div id="map" ref={mapElRef} />;
}
