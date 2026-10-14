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
function pinElement(tuple, { color, logos, selected, tracked }) {
  const [, name, , , , , hiring, , precision, , , logo] = tuple;
  const root = document.createElement('div');
  // A suburb is not an office: its pin is drawn as approximate (a dashed edge), so it is never read as an address.
  root.className = `custom-pin-badge${selected ? ' pin-selected' : ''}${precision === 'SUBURB' ? ' pin-approx' : ''}`;
  const fallback = document.createElement('span');
  fallback.className = 'pin-fallback';
  fallback.style.background = color;
  fallback.textContent = (name || '?').trim().charAt(0).toUpperCase();
  root.append(fallback);
  if (logos && logo) root.append(logoImg(logo));
  root.append(labelElement(name));
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
const NO_COLORS = {};
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
// The header and the search box sit over the top of the map, and the controls over the bottom: a card pans clear of them.
const POPUP_PAN = { autoPanPaddingTopLeft: [24, 150], autoPanPaddingBottomRight: [24, 96] };

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
export default function MapView({
  markers = NO_MARKERS, areas = NO_AREAS, sectorColors = NO_COLORS, onSelectStartup, onViewArea, selectedName, trackedNames,
  institutionPins = NO_INSTITUTIONS, showCompanies = true, showInstitutions = true, basemap = 'dark', onOpenInternal, onReportRoleClosed,
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
  latest.current = { markers, sectorColors, onSelectStartup, onViewArea, selectedName, trackedNames, showCompanies, basemap, onOpenInternal, onReportRoleClosed };

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

  const draw = useCallback(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const index = indexRef.current;
    if (!map || !layer || !index) return;
    cancelAnimationFrame(frameRef.current); // a newer view replaces whatever the last one had left to make
    const { markers: tuples, sectorColors: colors, onSelectStartup: onSelect, selectedName: selected, trackedNames: tracked, showCompanies: visible } = latest.current;
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
        key = `p:${t[0]}:${logos ? 1 : 0}:${t[1] === selected ? 1 : 0}:${tracked?.has(t[1]) ? 1 : 0}:${colors[t[4]] || ''}`;
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
        marker.on('click', () => L.popup({ className: 'stack-popup', maxHeight: 240 }).setLatLng([f.lat, f.lng]).setContent(stackList(f.members, tuples, (p) => onSelect?.(p))).openOn(map));
        clustersRef.current.set(key, { lat: f.lat, lng: f.lng });
      } else {
        const t = tuples[f.i];
        const html = pinElement(t, { color: colors[t[4]] || '#444', logos, selected: t[1] === selected, tracked: tracked?.has(t[1]) || false });
        marker = L.marker([f.lat, f.lng], { icon: L.divIcon({ className: 'custom-leaflet-marker', html, iconSize: [44, 44], iconAnchor: [22, 22] }) });
        marker.bindTooltip(tooltipContent(t), { direction: 'top', offset: [0, -20], sticky: true });
        marker.on('click', () => openCompanyCard(t, f.lat, f.lng));
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
  }, [placeLabels, openCompanyCard]);

  useEffect(() => {
    const map = L.map(mapElRef.current, {
      zoomControl: false,
      minZoom: 3,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1.0,
    }).setView([-33.0, 145.0], 5);
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
    // Groups sit under the pins, in a pane of their own between the tiles and the markers, so the ring of a city never
    // hides a pin or a cluster in it.
    map.createPane('areas').style.zIndex = '450';
    const areaLayer = L.layerGroup().addTo(map);
    const layer = L.layerGroup().addTo(map);
    const instLayer = L.layerGroup().addTo(map);
    map.on('moveend', draw);
    mapRef.current = map;
    layerRef.current = layer;
    areaLayerRef.current = areaLayer;
    instLayerRef.current = instLayer;
    draw();
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

  // New pins (a filter changed): start from nothing, because a cluster's number belongs to the index that made it.
  useEffect(() => {
    indexRef.current = createPinIndex(markers);
    layerRef.current?.clearLayers();
    shownRef.current = new Map();
    for (const key of [...labelsRef.current.keys()]) if (!key.startsWith('i:')) labelsRef.current.delete(key);
    clustersRef.current = new Map();
    draw();
  }, [markers, draw]);

  // The companies' layer was switched on or off.
  const visibleSeen = useRef(false);
  useEffect(() => {
    if (!visibleSeen.current) { visibleSeen.current = true; return; }
    shownRef.current = new Map();
    layerRef.current?.clearLayers();
    draw();
  }, [showCompanies, draw]);

  // A pin's look changed (selected, tracked, a sector's colour): only the pins whose look differs are rebuilt. (Not on
  // the first run: the effect above has just drawn, and drawing again would make a second batch of pins in that frame.)
  const looksSeen = useRef(false);
  useEffect(() => {
    if (!looksSeen.current) { looksSeen.current = true; return; }
    draw();
  }, [sectorColors, selectedName, trackedNames, draw]);

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
