import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

function domainOf(website) {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

// Clearbit has near-zero coverage of small/seed-stage companies. Cascade to
// Google's favicon service (much higher hit-rate) before ever falling back
// to the plain initial-letter badge rendered underneath this <img>.
function logoImgHtml(domain, cssClass, size) {
  if (!domain) return '';
  const clearbit = `https://logo.clearbit.com/${domain}?size=${size}`;
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
  return `<img class="${cssClass}" src="${clearbit}" alt="" onerror="this.onerror=function(){this.style.display='none';};this.src='${favicon}';" />`;
}

function pinIcon(s, color, { selected, tracked } = {}) {
  const initial = (s.name || '?').trim().charAt(0).toUpperCase();
  const domain = domainOf(s.website);
  const classes = ['custom-pin-badge'];
  if (selected) classes.push('pin-selected');
  return L.divIcon({
    className: 'custom-leaflet-marker',
    html: `
      <div class="${classes.join(' ')}" style="border-color:${color};">
        <span class="pin-fallback" style="background:${color};">${initial}</span>
        ${logoImgHtml(domain, 'pin-logo', 64)}
        ${s.hiring ? '<span class="pin-hiring-dot" title="Hiring now"></span>' : ''}
        ${tracked ? '<span class="pin-tracked-star">★</span>' : ''}
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function clusterSizeClass(count) {
  if (count < 10) return 'cluster-small';
  if (count < 50) return 'cluster-medium';
  return 'cluster-large';
}

function clusterIcon(cluster) {
  const count = cluster.getChildCount();
  return L.divIcon({
    html: `<div class="marker-cluster-inner ${clusterSizeClass(count)}">${count}</div>`,
    className: 'marker-cluster-custom',
    iconSize: [40, 40],
  });
}

function tooltipHtml(s) {
  return `<b>${s.name}</b><br>${s.sectorFull || s.sector} · ${s.city}`;
}

export default function MapView({ startups, sectorColors, onSelectStartup, selectedName, trackedNames }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const clusterRef = useRef(null);

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
      // No Mapbox token: standard OSM tiles, inverted to dark via the
      // .osm-inverted class below rather than a paid/key-gated dark provider.
      mapElRef.current.classList.add('osm-inverted');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
        noWrap: true,
      }).addTo(map);
    }
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: clusterIcon,
    });
    cluster.addTo(map);

    mapRef.current = map;
    clusterRef.current = cluster;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;

    cluster.clearLayers();

    const markers = startups
      .filter((s) => s.verified)
      .map((s) => {
        const color = sectorColors[s.sector] || '#444';
        const selected = s.name === selectedName;
        const tracked = trackedNames?.has(s.name) || false;
        const marker = L.marker([s.lat, s.lng], { icon: pinIcon(s, color, { selected, tracked }) });
        marker.bindTooltip(tooltipHtml(s), { direction: 'top', offset: [0, -20], sticky: true });
        marker.on('click', () => onSelectStartup(s));
        return marker;
      });

    cluster.addLayers(markers);
  }, [startups, sectorColors, selectedName, trackedNames, onSelectStartup]);

  return <div id="map" ref={mapElRef} />;
}
