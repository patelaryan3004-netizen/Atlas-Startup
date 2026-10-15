import { useCallback, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css'; // with the map's own file, not the page's: only the map needs it (it used to be a stylesheet every page waited for)
import { fetchStartup } from '../api.js';
import { logoUrl } from '../logo.js';
import { TILE_URL, TILE_OPTIONS, quietClass } from '../mapTiles.js';
import { companyPopup, institutionPopup } from '../mapPopups.js';
import { createPinIndex } from '../pinIndex.js';
import { paddedWindow, pinPayload, vcTuple, vcMarks, isVc, isVcGroup, clusterSize, CLUSTER_PX, locationQuality, areaLabel, areaMember, labelsVisible, chooseLabels, CLUSTER_MAX_ZOOM, AREA_CHIP_ZOOM } from '../mapPins.js';

// A pin's logo, over the plain initial-letter badge rendered underneath this <img>. It is the company's OWN picture (its `logo` address) when the
// record has one, and otherwise the picture its website's address gives (logo.js: the one source every card on the site uses). It appears only
// once it has loaded and is a real picture; until then, and if it never does (the service has none for that site), the first letter shows.
// The pins are what the map is for, so their pictures are asked for at once.
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
// A pin is a small rounded square with the company's logo in it (its own picture, else the one its website gives), or its first letter where
// there is none or it does not load. An investor's is the same square with "VC" on it. A suburb or a city is not an office, so the square of
// a company known to a suburb, and of every investor (a city), has a dashed edge: it is never read as an address.
function pinElement(tuple, { selected, tracked }) {
  const [, name, , , , , hiring, domain, precision, , , logo] = tuple;
  const group = isVcGroup(tuple);
  const vc = isVc(tuple) || group;
  const root = document.createElement('div');
  root.className = `custom-pin-badge pin-tile${vc ? ' pin-vc' : ''}${group ? ' pin-vcgroup' : ''}${selected ? ' pin-selected' : ''}${precision === 'SUBURB' || precision === 'CITY' ? ' pin-approx' : ''}`;
  const face = document.createElement('span');
  face.className = 'pin-face';
  const fallback = document.createElement('span');
  fallback.className = 'pin-fallback';
  fallback.textContent = group ? String(tuple[13].length) : (name || '?').trim().charAt(0).toUpperCase();
  face.append(fallback);
  const picture = group ? null : logo || (domain ? logoUrl(domain, 96) : null);
  if (picture) face.append(logoImg(picture));
  root.append(face, labelElement(name));
  if (vc) {
    const badge = document.createElement('span');
    badge.className = 'pin-vc-badge';
    badge.textContent = 'VC';
    root.append(badge);
  }
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
  if (isVcGroup(tuple)) {
    const what = document.createElement('div');
    what.className = 'tip-place';
    what.textContent = `${tuple[13].length} venture capital firms · ${place || city}`;
    const quality = document.createElement('div');
    quality.className = `tip-quality tip-${precision === 'EXACT' ? 'exact' : 'city'}`;
    quality.textContent = precision === 'EXACT' ? 'Office address from their own websites. Press to list them.' : 'City-level: the city, no address on file. Press to list them.';
    box.append(strong, what, quality);
    return box;
  }
  if (isVc(tuple)) {
    const what = document.createElement('div');
    what.className = 'tip-place';
    what.textContent = `Venture capital · ${place || city}`;
    const quality = document.createElement('div');
    quality.className = `tip-quality tip-${precision === 'EXACT' ? 'exact' : 'city'}`;
    quality.textContent = pinPayload(tuple).location.quality;
    box.append(strong, what, quality);
    return box;
  }
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
    if (isVc(tuples[i])) {
      // An investor in a list of marks at one place says what it is, so it is not taken for a startup.
      const kind = document.createElement('span');
      kind.className = 'stack-kind';
      kind.textContent = 'VC';
      button.append(kind);
    }
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

// The investors of one city (a group's list): each with its logo (or its first letter), its name and the first of what it invests in; a press opens its panel.
function vcStackList(pins, onPick) {
  const list = document.createElement('ul');
  list.className = 'stack-list stack-vclist';
  for (const pin of pins) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stack-item stack-vc';
    const logo = document.createElement('span');
    logo.className = 'stack-logo';
    const initial = document.createElement('span');
    initial.className = 'pin-fallback';
    initial.textContent = (pin.name || '?').trim().charAt(0).toUpperCase();
    logo.append(initial);
    const picture = pin.logo || (pin.domain ? logoUrl(pin.domain, 64) : null);
    if (picture) logo.append(logoImg(picture));
    const text = document.createElement('span');
    text.className = 'stack-text';
    const name = document.createElement('b');
    name.textContent = pin.name;
    text.append(name);
    const sub = [pin.sectors?.[0], pin.stages?.length ? pin.stages.join(' · ') : ''].filter(Boolean).join(' · ');
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      text.append(small);
    }
    button.append(logo, text);
    button.addEventListener('click', () => onPick(pin));
    item.append(button);
    list.append(item);
  }
  return list;
}

// A mark is a button for the keyboard (Leaflet gives it a tab stop and Enter presses it): this gives it a name to be read out. A selected mark's
// name is on it, not on its picture.
// Leaflet's own Enter key only opens a popup that is bound to a mark; these marks open a panel or a list, so Enter and Space press them here.
function named(marker, label) {
  marker.on('add', () => {
    const el = marker.getElement?.();
    if (!el) return;
    el.setAttribute('aria-label', label);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); // no keypress after it: the mark is pressed once
      marker.fire('click', { originalEvent: e });
    });
  });
}

// Defaults that are the same object every render, so an omitted prop does not look like a change each time.
const NO_MARKERS = [];
const NO_AREAS = [];
const NO_INSTITUTIONS = [];
const NO_VCS = [];

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
const PREVIEW_GAP = 32; // from a mark's centre to the edge of its preview card (the tile is 40px across)
const ZOOM_CLEARANCE = 160; // the zoom buttons take the map's bottom right corner, up to this far from its bottom

// A card grows after it opens: the company's record arrives, "More" is unfolded. Leaflet pans only as a popup opens, so it is asked to
// look again each time, and the card is not left under the search box. Returns what to call when the card's content has changed.
function keepClear(popup, element) {
  const again = () => popup.update?.();
  element.addEventListener('toggle', again, true); // "toggle" does not bubble, so it is caught on the way down
  return again;
}

// The map's tiles: one light background. With a Mapbox token the style is Mapbox's light-v11; without one the OpenStreetMap tiles are used, turned down by
// the .map-quiet-light class (mapTiles.js, styles.css).
const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
const mapboxUrl = `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`;

// markers: one compact array per company whose place is a point, an exact office or a suburb (see fetchMarkers). Only
// what is in view is ever turned into elements: pins and clusters are worked out for the window and zoom, and drawn or
// removed as the map moves, so the cost depends on what is on screen and not on how many companies there are.
// areas: one group per city or state for the companies known only to that much, drawn as a group and never as a pin
// (there are a few dozen at most, so all are drawn). Clicking one lists a few of them (onSelectStartup opens one) and
// onViewArea(area) opens the rest as a list; with neither handler (the landing page) a group is a label to hover.
// institutionPins: the firms' offices ({ id, name, lat, lng, city, place, office, website, href }), a few dozen at most, all drawn.
// vcPins: the investors' marks (an item of /api/investors/pins: a city's reference point, never an office), drawn in the same index as the companies,
// so a cluster can hold both; showCompanies, showVcs and showInstitutions are the layers' switches.
// onSelectPin(company): a pin was pressed (the page shows its card; without it the map opens its own small card), and onClearPin(): the bare map
// was. scope: what the map is narrowed to ("Melbourne", or "" for all of Australia): when it changes, the map moves to fit the pins that come next.
// focus: { key, lat, lng, id, inset, insetRight }: bring this place into view, clear of the `inset` pixels at the bottom that a sheet covers and the
// `insetRight` pixels at the right that a side panel covers, and (with `id`, the mark's own) zoomed in far enough for that mark to be drawn on its own and not
// inside a cluster; { key, home: true } goes back to all of Australia. onViewChange({ lat, lng, zoom }) says where the map is looking after each move.
// previewAt: { lat, lng } and previewCard: the compact preview of the open mark, which is drawn beside that mark and follows it as the map moves (previewKey says when it is a different
// card, so it is placed again).
export default function MapView({
  markers = NO_MARKERS, areas = NO_AREAS, onSelectStartup, onViewArea, selectedName, trackedNames, vcPins = NO_VCS, showVcs = false,
  institutionPins = NO_INSTITUTIONS, showCompanies = true, showInstitutions = true, onOpenInternal, onReportRoleClosed,
  onSelectPin, onClearPin, scope = '', focus = null, onViewChange, previewAt = null, previewCard = null, previewKey = '',
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
  // What the index holds: the companies' pins and the investors' marks, whichever layers are on. A cluster counts both.
  const items = useMemo(() => [...(showCompanies ? markers : NO_MARKERS), ...(showVcs ? vcMarks(vcPins) : NO_MARKERS)], [markers, vcPins, showCompanies, showVcs]);
  const latest = useRef({});
  latest.current = { markers: items, areas, onSelectStartup, onViewArea, selectedName, trackedNames, showCompanies, onOpenInternal, onReportRoleClosed, onSelectPin, onClearPin, onViewChange };
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
    root.classList.toggle('show-area-chips', map.getZoom() >= AREA_CHIP_ZOOM);
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
    const { markers: tuples, onSelectStartup: onSelect, selectedName: selected, trackedNames: tracked } = latest.current;
    const shown = shownRef.current;
    // The open company's mark; or the group of investors that holds the open investor, so the one that is open is always in sight.
    const isOpen = (tuple) => (isVcGroup(tuple) ? tuple[13].some((p) => p.name === selected) : tuple[1] === selected);
    const zoom = map.getZoom();
    const features = index.view(paddedWindow(map.getBounds()), zoom);
    const keep = new Set();
    const todo = [];

    for (const f of features) {
      let key;
      if (f.type === 'cluster') key = `c:${f.id}:${f.count}`;
      else if (f.type === 'stack') key = `s:${f.lat},${f.lng}:${f.members.length}`;
      else {
        const t = tuples[f.i];
        key = `p:${t[0]}:${isOpen(t) ? 1 : 0}:${tracked?.has(t[1]) ? 1 : 0}`;
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
      const pick = (p) => { map.closePopup?.(); (latest.current.onSelectPin ?? onSelect)?.(p); };
      // The investors of one city, listed where they are drawn: each opens that investor's panel.
      const openVcList = (pins, lat, lng) => L.popup({ className: 'stack-popup vc-popup', maxHeight: 320, ...POPUP_PAN }).setLatLng([lat, lng]).setContent(vcStackList(pins, (pin) => pick(pinPayload(vcTuple(pin))))).openOn(map);
      const openStack = (members, lat, lng) => L.popup({ className: 'stack-popup', maxHeight: 240 }).setLatLng([lat, lng]).setContent(stackList(members, tuples, pick)).openOn(map);
      if (f.type === 'cluster') {
        marker = L.marker([f.lat, f.lng], { icon: clusterIcon(f.count) });
        // A cluster opens to what it holds: the map moves to fit its members, and when they are all at one place (investors in one city are
        // all at that city's reference point) there is nothing to zoom to, so they are listed there.
        marker.on('click', () => {
          const members = index.leaves(f.id);
          const first = tuples[members[0]];
          if (first && members.every((i) => tuples[i][2] === first[2] && tuples[i][3] === first[3])) { openStack(members, f.lat, f.lng); return; }
          const bounds = L.latLngBounds(members.map((i) => [tuples[i][2], tuples[i][3]]));
          const narrow = typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;
          map.fitBounds(bounds, { ...(narrow ? FIT_PADDING.narrow : FIT_PADDING.desktop), maxZoom: CLUSTER_MAX_ZOOM + 1 });
        });
        clustersRef.current.set(key, { lat: f.lat, lng: f.lng });
        named(marker, `${f.count} places close together. Press to open them.`);
      } else if (f.type === 'stack') {
        marker = L.marker([f.lat, f.lng], { icon: clusterIcon(f.members.length) });
        marker.on('click', () => openStack(f.members, f.lat, f.lng));
        clustersRef.current.set(key, { lat: f.lat, lng: f.lng });
        named(marker, `${f.members.length} places at one spot. Press to list them.`);
      } else {
        const t = tuples[f.i];
        const html = pinElement(t, { selected: isOpen(t), tracked: tracked?.has(t[1]) || false });
        // The open company is drawn over its neighbours, and a company that is hiring over those that are not.
        marker = L.marker([f.lat, f.lng], { icon: L.divIcon({ className: 'custom-leaflet-marker', html, iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: isOpen(t) ? SELECTED_Z : t[6] ? HIRING_Z : 0 });
        marker.bindTooltip(tooltipContent(t), { direction: 'top', offset: [0, -20], sticky: true });
        marker.on('click', () => { marker.closeTooltip?.(); if (isVcGroup(t)) openVcList(t[13], f.lat, f.lng); else pickPin(t, f.lat, f.lng); });
        named(marker, `${t[1]}${isVc(t) ? ', venture capital firm' : ''}${t[6] ? ', hiring now' : ''}`);
        const el = html.querySelector('.pin-label');
        if (el) labelsRef.current.set(key, { el, lat: f.lat, lng: f.lng, text: t[1] || '', rank: isOpen(t) ? 0 : t[6] ? 1 : tracked?.has(t[1]) ? 2 : 3 });
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
    if (mapboxToken) {
      tilesRef.current = L.tileLayer(mapboxUrl, { attribution: '&copy; Mapbox &copy; OpenStreetMap', tileSize: 512, zoomOffset: -1, maxZoom: 18, noWrap: true }).addTo(map);
    } else {
      // No Mapbox token: the OpenStreetMap tiles of mapTiles.js, made quiet by a class.
      mapElRef.current.classList.add(quietClass());
      tilesRef.current = L.tileLayer(TILE_URL, TILE_OPTIONS).addTo(map);
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

  // New pins (a filter changed, or a layer was switched): start from nothing, because a cluster's number belongs to the index that made it.
  useEffect(() => {
    indexRef.current = createPinIndex(items);
    layerRef.current?.clearLayers();
    shownRef.current = new Map();
    for (const key of [...labelsRef.current.keys()]) if (!key.startsWith('i:')) labelsRef.current.delete(key);
    clustersRef.current = new Map();
    draw();
    if (wantsFit.current && (items.length || latest.current.areas.length)) { wantsFit.current = false; fitToPins(); }
  }, [items, draw, fitToPins]);

  // A place to bring into view (a company picked from the results or the sheet, or a pin that a panel would cover): left alone if it is already clear of
  // the edges, of the `inset` pixels at the bottom (a sheet) and of the `insetRight` pixels at the right (a side panel), and its mark is drawn on its own
  // (one inside a cluster is not in sight: the map goes in to it); otherwise the map flies there, a little way past it so it sits clear of them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    if (focus.home) { map.setView(homeRef.current.center, homeRef.current.zoom); return; }
    const { lat, lng, id, inset = 0, insetRight = 0 } = focus;
    const size = map.getSize();
    const at = map.latLngToContainerPoint([lat, lng]);
    const clear = at.x >= FOCUS_EDGE && at.x <= size.x - insetRight - FOCUS_EDGE && at.y >= FOCUS_EDGE + 40 && at.y <= size.y - inset - FOCUS_EDGE;
    // Its own mark is in sight at this zoom, or not: it may be inside a cluster, and then the map goes in until the mark stands on its own (a mark the index
    // does not hold, an investor in a city's group, gets the zoom of a street map's neighbourhood).
    const zoomNow = map.getZoom();
    let hidden = false;
    let goal = FOCUS_ZOOM;
    if (id != null) {
      const i = latest.current.markers.findIndex((t) => String(t[0]) === String(id));
      if (i >= 0 && indexRef.current) { goal = indexRef.current.aloneZoom(i, Math.floor(zoomNow)); hidden = goal > Math.floor(zoomNow); }
      else hidden = zoomNow < FOCUS_ZOOM && ![...shownRef.current.keys()].some((key) => key.startsWith(`p:${id}:`));
    }
    if (clear && !hidden) return;
    const zoom = hidden ? Math.max(zoomNow, goal) : map.getBounds().contains([lat, lng]) ? zoomNow : Math.max(zoomNow, FOCUS_ZOOM);
    map.flyTo(map.unproject(map.project([lat, lng], zoom).add([insetRight / 2, inset / 2]), zoom), zoom, { duration: 0.6 });
  }, [focus]);

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

  // The open mark's preview card, beside the mark: on its right when there is room and on its left when not, kept inside the map and clear of the zoom buttons,
  // and moved with the map. It is not inside the map's own element, so a press on it is not a press on the bare map.
  const previewRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    const box = previewRef.current;
    if (!map || !box || !previewAt) return undefined;
    const place = () => {
      const at = map.latLngToContainerPoint([previewAt.lat, previewAt.lng]);
      const size = map.getSize();
      const w = box.offsetWidth || 300;
      const h = box.offsetHeight || 150;
      let x = at.x + PREVIEW_GAP;
      let side = 'right';
      if (x + w > size.x - 12) { x = at.x - PREVIEW_GAP - w; side = 'left'; }
      x = Math.max(12, Math.min(x, size.x - w - 12));
      let y = Math.max(12, Math.min(at.y - 26, size.y - h - 12));
      if (x + w > size.x - 74 && y + h > size.y - ZOOM_CLEARANCE) y = Math.max(12, size.y - ZOOM_CLEARANCE - h);
      box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      box.dataset.side = side;
    };
    place();
    map.on('move zoom viewreset resize', place);
    const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    watcher?.observe(box);
    return () => { map.off('move zoom viewreset resize', place); watcher?.disconnect(); };
  }, [previewAt?.lat, previewAt?.lng, previewKey, Boolean(previewCard)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div id="map" ref={mapElRef} />
      {previewAt && previewCard && <div className="pin-preview" ref={previewRef}>{previewCard}</div>}
    </>
  );
}
