import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

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

function pinIcon(s, color) {
  const initial = (s.name || '?').trim().charAt(0).toUpperCase();
  const domain = domainOf(s.website);
  return L.divIcon({
    className: 'custom-leaflet-marker',
    html: `
      <div class="custom-pin-badge" style="border-color:${color};">
        <span class="pin-fallback" style="background:${color};">${initial}</span>
        ${logoImgHtml(domain, 'pin-logo', 64)}
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

function initialsOf(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name || '?').slice(0, 2).toUpperCase();
}

// We only ever show a founder's real, sourced name. No photos (we have none,
// and won't fabricate a picture of a real person) and no guessed LinkedIn
// profile URL (a wrong guess would point at a stranger) — a LinkedIn people
// search for "name + company" is real, functional, and honest about what it is.
function foundersHtml(s) {
  if (!s.founders || !s.founders.length) return '';
  return `
    <div class="pc-section-label">Founders</div>
    <div class="pc-founders">
      ${s.founders.map((f) => {
        const search = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${f} ${s.name}`)}`;
        return `
          <div class="pc-founder">
            <span class="pc-founder-avatar">${initialsOf(f)}</span>
            <span class="pc-founder-name">${f}</span>
            <a class="pc-founder-li" href="${search}" target="_blank" rel="noopener" title="Search LinkedIn for ${f}">in</a>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function popupHtml(s, color) {
  const domain = domainOf(s.website);
  const initial = (s.name || '?').trim().charAt(0).toUpperCase();

  const gateHtml = s.taskGate.enabled
    ? `<span class="taskgate-badge">TASK-GATE · ${s.taskGate.type}</span>`
    : `<span class="taskgate-badge taskgate-locked">NO GATE</span>`;

  const verifyHtml = s.address
    ? `<div class="pc-verify is-address">✓ Address on file</div>`
    : `<div class="pc-verify is-approx">◐ Location approximate — city level</div>`;

  const investorsHtml = s.investors.length
    ? `
      <div class="pc-section-label">Investors</div>
      <div class="pc-investors">
        ${s.investors.map((inv) => `
          <div class="pc-inv">
            <span class="pc-inv-avatar">${initialsOf(inv)}</span>
            <span class="pc-inv-name">${inv}</span>
          </div>
        `).join('')}
      </div>
    `
    : '';

  const subLine = `${s.stage} · ${s.city}${s.foundedYear ? ` · Founded ${s.foundedYear}` : ''}`;

  return `
    <div class="pc">
      <div class="pc-hero" style="background:${color};">
        <div class="pc-hero-top">
          <div class="pc-avatar">
            <span class="pc-avatar-fallback">${initial}</span>
            ${logoImgHtml(domain, 'pc-avatar-logo', 96)}
          </div>
          <div class="pc-hero-text">
            <h4>${s.name}</h4>
            <div class="pc-sub">${subLine}</div>
          </div>
        </div>
        <div class="pc-badges">
          <span class="pc-badge">${s.sector}</span>
          ${gateHtml}
        </div>
      </div>
      <div class="pc-body">
        ${s.blurb ? `<p class="pc-desc">${s.blurb}</p>` : ''}
        ${s.website ? `<a class="pc-link" href="${s.website}" target="_blank" rel="noopener">🌐 ${s.website.replace(/^https?:\/\//, '')} ↗</a>` : ''}
        <div class="pc-facts">
          <div><span class="pc-fact-label">Sector</span>${s.sectorFull || s.sector}</div>
          <div><span class="pc-fact-label">Stage</span>${s.stage}</div>
          <div><span class="pc-fact-label">Hiring</span><span class="${s.hiring ? 'hiring' : 'notHiring'}">${s.hiring ? 'Yes' : 'No'}</span></div>
        </div>
        ${verifyHtml}
        ${foundersHtml(s)}
        ${investorsHtml}
        ${s.hiring ? `<button class="taskbtn">${s.taskGate.enabled ? 'Start task → Apply' : 'Apply now'}</button>` : ''}
        <button class="pc-suggest-edit" data-name="${escAttr(s.name)}" onclick="window.__auMapSuggestEdit && window.__auMapSuggestEdit(this.dataset.name)">✎ Suggest an edit</button>
      </div>
    </div>
  `;
}

export default function MapView({ startups, sectorColors, onSuggestEdit }) {
  useEffect(() => {
    window.__auMapSuggestEdit = onSuggestEdit;
    return () => { delete window.__auMapSuggestEdit; };
  }, [onSuggestEdit]);

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
        `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
        { attribution: '&copy; Mapbox &copy; OpenStreetMap', tileSize: 512, zoomOffset: -1, maxZoom: 18, noWrap: true }
      ).addTo(map);
    } else {
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
        const marker = L.marker([s.lat, s.lng], { icon: pinIcon(s, color) });
        marker.bindTooltip(tooltipHtml(s), { direction: 'top', offset: [0, -20], sticky: true });
        marker.bindPopup(popupHtml(s, color), { maxWidth: 280, minWidth: 260, className: 'pc-popup' });
        return marker;
      });

    cluster.addLayers(markers);
  }, [startups, sectorColors]);

  return <div id="map" ref={mapElRef} />;
}
