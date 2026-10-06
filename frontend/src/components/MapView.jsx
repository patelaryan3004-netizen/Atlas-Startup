import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import { createPinIndex, paddedWindow, pinPayload, clusterSize, showLogos, CLUSTER_MAX_ZOOM } from '../mapPins.js';

// Clearbit has near-zero coverage of small/seed-stage companies. Cascade to Google's favicon service (much
// higher hit-rate) before falling back to the plain initial-letter badge rendered underneath this <img>.
function logoImg(domain, size) {
  const img = document.createElement('img');
  img.className = 'pin-logo';
  img.alt = '';
  img.decoding = 'async';
  img.src = `https://logo.clearbit.com/${domain}?size=${size}`;
  img.onerror = () => {
    img.onerror = () => { img.style.display = 'none'; };
    img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
  };
  return img;
}

// Everything the map puts on the page is built as elements, never as an HTML string: a company's name is data.
function pinElement(tuple, { color, logos, selected, tracked }) {
  const [, name, , , , , hiring, domain] = tuple;
  const root = document.createElement('div');
  root.className = `custom-pin-badge${selected ? ' pin-selected' : ''}`;
  root.style.borderColor = color;
  const fallback = document.createElement('span');
  fallback.className = 'pin-fallback';
  fallback.style.background = color;
  fallback.textContent = (name || '?').trim().charAt(0).toUpperCase();
  root.append(fallback);
  if (logos && domain) root.append(logoImg(domain, 64));
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

function clusterElement(count) {
  const inner = document.createElement('div');
  inner.className = `marker-cluster-inner cluster-${clusterSize(count)}`;
  inner.textContent = String(count);
  return inner;
}

function tooltipContent(tuple) {
  const box = document.createElement('div');
  const strong = document.createElement('b');
  strong.textContent = tuple[1];
  box.append(strong, document.createElement('br'), document.createTextNode(`${tuple[4]} · ${tuple[5]}`));
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
const NO_COLORS = {};

// A pin is a few elements with a shadow, and a jump to street level in a dense place can put a couple of hundred on a
// phone's screen at once. Making them all in one go held a slow phone for most of a second, so a draw makes a few at a
// time and leaves the rest to the next frames: the page keeps answering touches while the pins fill in. A batch that
// took long makes the next one smaller and a quick one makes it bigger, so a fast computer still draws them all at once.
const FIRST_BATCH = 12;
const SLOW_BATCH_MS = 24;
const QUICK_BATCH_MS = 8;

// markers: one compact array per company with a confirmed location (see fetchMarkers). Only what is in view is
// ever turned into elements: pins and clusters are worked out for the window and zoom, and drawn or removed as
// the map moves, so the cost depends on what is on screen and not on how many companies there are.
export default function MapView({ markers = NO_MARKERS, sectorColors = NO_COLORS, onSelectStartup, selectedName, trackedNames }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const indexRef = useRef(null);
  const shownRef = useRef(new Map());
  const frameRef = useRef(0);
  const latest = useRef({});
  latest.current = { markers, sectorColors, onSelectStartup, selectedName, trackedNames };

  const draw = useCallback(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const index = indexRef.current;
    if (!map || !layer || !index) return;
    cancelAnimationFrame(frameRef.current); // a newer view replaces whatever the last one had left to make
    const { markers: tuples, sectorColors: colors, onSelectStartup: onSelect, selectedName: selected, trackedNames: tracked } = latest.current;
    const zoom = map.getZoom();
    const features = index.view(paddedWindow(map.getBounds()), zoom);
    const logos = showLogos(zoom, features.filter((f) => f.type === 'pin').length);
    const shown = shownRef.current;
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
      if (!keep.has(key)) { layer.removeLayer(marker); shown.delete(key); }
    }

    const make = ([key, f]) => {
      let marker;
      if (f.type === 'cluster') {
        marker = L.marker([f.lat, f.lng], { icon: L.divIcon({ html: clusterElement(f.count), className: 'marker-cluster-custom', iconSize: [40, 40] }) });
        marker.on('click', () => map.setView([f.lat, f.lng], Math.min(index.expansionZoom(f.id), CLUSTER_MAX_ZOOM + 1)));
      } else if (f.type === 'stack') {
        marker = L.marker([f.lat, f.lng], { icon: L.divIcon({ html: clusterElement(f.members.length), className: 'marker-cluster-custom', iconSize: [40, 40] }) });
        marker.on('click', () => L.popup({ className: 'stack-popup', maxHeight: 240 }).setLatLng([f.lat, f.lng]).setContent(stackList(f.members, tuples, (p) => onSelect?.(p))).openOn(map));
      } else {
        const t = tuples[f.i];
        const html = pinElement(t, { color: colors[t[4]] || '#444', logos, selected: t[1] === selected, tracked: tracked?.has(t[1]) || false });
        marker = L.marker([f.lat, f.lng], { icon: L.divIcon({ className: 'custom-leaflet-marker', html, iconSize: [36, 36], iconAnchor: [18, 18] }) });
        marker.bindTooltip(tooltipContent(t), { direction: 'top', offset: [0, -20], sticky: true });
        marker.on('click', () => onSelect?.(pinPayload(t)));
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
    };
    step();
  }, []);

  useEffect(() => {
    const map = L.map(mapElRef.current, {
      zoomControl: false,
      minZoom: 3,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1.0,
    }).setView([-33.0, 145.0], 5);
    const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
    if (mapboxToken) {
      L.tileLayer(
        `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
        { attribution: '&copy; Mapbox &copy; OpenStreetMap', tileSize: 512, zoomOffset: -1, maxZoom: 18, noWrap: true }
      ).addTo(map);
    } else {
      // No Mapbox token: standard OSM tiles, inverted to dark via the .osm-inverted class below rather than a
      // paid/key-gated dark provider.
      mapElRef.current.classList.add('osm-inverted');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
        noWrap: true,
      }).addTo(map);
    }
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    map.on('moveend', draw);
    mapRef.current = map;
    layerRef.current = layer;
    draw();
    return () => { cancelAnimationFrame(frameRef.current); map.remove(); mapRef.current = null; layerRef.current = null; shownRef.current = new Map(); };
  }, [draw]);

  // New pins (a filter changed): start from nothing, because a cluster's number belongs to the index that made it.
  useEffect(() => {
    indexRef.current = createPinIndex(markers);
    layerRef.current?.clearLayers();
    shownRef.current = new Map();
    draw();
  }, [markers, draw]);

  // A pin's look changed (selected, tracked, a sector's colour): only the pins whose look differs are rebuilt. (Not on
  // the first run: the effect above has just drawn, and drawing again would make a second batch of pins in that frame.)
  const looksSeen = useRef(false);
  useEffect(() => {
    if (!looksSeen.current) { looksSeen.current = true; return; }
    draw();
  }, [sectorColors, selectedName, trackedNames, draw]);

  return <div id="map" ref={mapElRef} />;
}
