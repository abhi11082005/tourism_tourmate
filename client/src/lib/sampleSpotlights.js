/*
 * SAMPLE spotlight cards — placeholder content, NOT backend data.
 *
 * Explore renders these with a visible "Sample" badge so nobody mistakes them for
 * live listings. When a real endpoint exists (e.g. GET /api/spotlights), fetch it
 * with React Query and pass the result to <SpotlightSection spotlights={...}
 * isSample={false} />. The card shape below is the contract the component reads:
 *
 *   { id, title, city, image }      // image optional — a fallback tile is drawn
 */
export const SAMPLE_SPOTLIGHTS = [
  { id: 1, title: 'Nahargarh Sunset Point', city: 'Jaipur', image: '/nahargarh.jpg' },
  { id: 2, title: 'Amber Fort', city: 'Jaipur', image: '/amber-fort.jpg' },
];
