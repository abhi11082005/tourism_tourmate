/*
 * DOM content for Google Advanced Markers.
 *
 * AdvancedMarkerElement renders any HTMLElement, so each marker is a small
 * hand-built node rather than a React tree: hundreds of React roots would be the
 * expensive "DOM marker" case, while plain nodes handed to the clusterer are cheap.
 * All text goes in via textContent — place names come from Google and from admins.
 *
 * Styling is inline for the colours (they are data) and Tailwind-free so a marker
 * looks the same in the admin console, the tour page and Explore.
 */

export const CATEGORY_STYLE = {
  MUST_VISIT: { label: 'Must visit', color: '#3b5bdb', glyph: 'star' },
  MUST_EAT: { label: 'Must eat', color: '#e8590c', glyph: 'eat' },
  FAMOUS_RIDE: { label: 'Famous ride', color: '#0ca678', glyph: 'ride' },
  // External (Google) discoveries get their own, deliberately different, look.
  restaurant: { label: 'Restaurant', color: '#c2255c', glyph: 'eat' },
  attraction: { label: 'Place', color: '#7048e8', glyph: 'pin' },
  museum: { label: 'Museum', color: '#1971c2', glyph: 'museum' },
  temple: { label: 'Temple', color: '#c2410c', glyph: 'temple' },
  cafe: { label: 'Cafe', color: '#8b5e34', glyph: 'cup' },
  street_food: { label: 'Street food', color: '#d97706', glyph: 'bowl' },
  shopping: { label: 'Shopping', color: '#0891b2', glyph: 'bag' },
  ride: { label: 'Ride', color: '#0ca678', glyph: 'ride' },
  experience: { label: 'Experience', color: '#2f9e44', glyph: 'tree' },
};
const FALLBACK_STYLE = { label: 'Place', color: '#868e96', glyph: 'pin' };

export const styleFor = (item) => CATEGORY_STYLE[item?.kind ?? item?.category] ?? FALLBACK_STYLE;

const NS = 'http://www.w3.org/2000/svg';

// 24x24 stroke glyphs.
const GLYPHS = {
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z',
  eat: 'M8 3v7M5.5 3v4.5a2.5 2.5 0 0 0 5 0V3M8 10.5V21M17 3c-2.2 1.2-3 3.6-3 6.2 0 2 1 3 3 3V21',
  ride: 'M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M12 6v12M6 12h12M7.8 7.8l8.4 8.4M16.2 7.8l-8.4 8.4M8 21l4-9 4 9',
  museum: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  temple: 'M12 3v3M8 21V12l4-4 4 4v9M4 21h16M10 21v-4h4v4',
  cup: 'M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 9h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M12 3v2',
  bowl: 'M3 12h18a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8zM8 8c0-1.5 1-1.5 1-3M13 8c0-1.5 1-1.5 1-3',
  bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  tree: 'M12 21v-6M12 3l5 7h-3l4 6H6l4-6H7z',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z',
};

function glyph(name, color, size) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', color);
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', GLYPHS[name] ?? GLYPHS.pin);
  svg.append(path);
  return svg;
}

const px = (n) => `${n}px`;

/**
 * Category pin. Curated TourMate places are solid discs with a white glyph;
 * Google discoveries are white discs with a coloured ring — so the two sources are
 * tell-apart-able at a glance, not only in the legend.
 *
 * `selected` grows the pin and adds a ring; it is toggled in place by
 * `setPinSelected` so a selection change never rebuilds the marker.
 */
export function createPinContent(item) {
  const style = styleFor(item);
  const external = item?.source === 'google';
  const wrap = document.createElement('div');
  wrap.dataset.pin = '1';
  Object.assign(wrap.style, {
    width: px(34),
    height: px(34),
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    background: external ? '#ffffff' : style.color,
    border: external ? `2.5px solid ${style.color}` : '2.5px solid #ffffff',
    boxShadow: '0 2px 8px rgba(18,20,31,.35)',
    cursor: 'pointer',
    transition: 'transform .18s ease, box-shadow .18s ease',
    transformOrigin: '50% 100%',
  });
  wrap.append(glyph(style.glyph, external ? style.color : '#ffffff', 18));
  return wrap;
}

export function setPinSelected(content, selected) {
  if (!content) return;
  content.style.transform = selected ? 'scale(1.35)' : 'scale(1)';
  content.style.boxShadow = selected
    ? '0 0 0 4px rgba(255,122,69,.55), 0 6px 14px rgba(18,20,31,.45)'
    : '0 2px 8px rgba(18,20,31,.35)';
}

/** Numbered itinerary stop (TourDetail). A real <button>, so it is keyboard-focusable. */
export function createStopContent(number, name) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = String(number);
  el.setAttribute('aria-label', `Stop ${number}${name ? `: ${name}` : ''}`);
  Object.assign(el.style, {
    display: 'grid',
    placeItems: 'center',
    border: '2px solid #fff',
    borderRadius: '50%',
    color: '#fff',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(18,20,31,.4)',
    transition: 'all .2s ease',
    padding: '0',
  });
  setStopSelected(el, false);
  return el;
}

export function setStopSelected(el, selected) {
  if (!el) return;
  const size = selected ? 40 : 28;
  Object.assign(el.style, {
    width: px(size),
    height: px(size),
    fontSize: selected ? '14px' : '12px',
    background: selected ? '#ff7a45' : '#1d2135',
    boxShadow: selected ? '0 0 0 4px rgba(255,255,255,.9), 0 6px 14px rgba(18,20,31,.45)' : '0 2px 8px rgba(18,20,31,.4)',
  });
  el.setAttribute('aria-pressed', selected ? 'true' : 'false');
}

let styleInjected = false;
function ensurePulseStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  const tag = document.createElement('style');
  tag.textContent = `
    @keyframes tm-pulse { 0% { transform: scale(.6); opacity: .65 } 100% { transform: scale(2.4); opacity: 0 } }
    @media (prefers-reduced-motion: reduce) { .tm-pulse-ring { animation: none !important; opacity: .25 } }`;
  document.head.append(tag);
}

/** The visitor's own GPS position: blue dot with a soft pulse. Never used for a fallback. */
export function createUserContent() {
  ensurePulseStyle();
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'relative', width: px(20), height: px(20) });
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', 'Your current location');

  const ring = document.createElement('span');
  ring.className = 'tm-pulse-ring';
  Object.assign(ring.style, {
    position: 'absolute',
    inset: '0',
    borderRadius: '50%',
    background: '#4285f4',
    animation: 'tm-pulse 2s ease-out infinite',
  });
  const dot = document.createElement('span');
  Object.assign(dot.style, {
    position: 'absolute',
    inset: '2px',
    borderRadius: '50%',
    background: '#4285f4',
    border: '3px solid #ffffff',
    boxShadow: '0 2px 6px rgba(0,0,0,.4)',
  });
  wrap.append(ring, dot);
  return wrap;
}

/** Cluster bubble for @googlemaps/markerclusterer. */
export function createClusterContent(count) {
  const el = document.createElement('div');
  el.textContent = String(count);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${count} places, zoom in to see them`);
  const size = count < 10 ? 36 : count < 50 ? 44 : 52;
  Object.assign(el.style, {
    width: px(size),
    height: px(size),
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    background: '#1d2135',
    color: '#fff',
    fontWeight: '700',
    fontSize: '13px',
    border: '3px solid #ff7a45',
    boxShadow: '0 3px 10px rgba(18,20,31,.45)',
    cursor: 'pointer',
  });
  return el;
}

/** Draggable draft pin in the admin console. */
export function createDraftContent() {
  ensurePulseStyle();
  const el = document.createElement('div');
  Object.assign(el.style, {
    width: px(22),
    height: px(22),
    borderRadius: '50%',
    background: '#ff7a45',
    border: '3px solid #fff',
    boxShadow: '0 0 0 4px rgba(255,122,69,.35), 0 3px 8px rgba(0,0,0,.4)',
    cursor: 'grab',
  });
  return el;
}
