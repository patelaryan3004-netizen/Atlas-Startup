// What each page that is pre-rendered says about itself to a search engine and to a link preview (title, description, address), and what the
// whole site is. The build writes these into each page's head (scripts/prerender.mjs); nothing here is read by the browser at run time except
// the owner's profile link.

// The address the site is served from. Canonical addresses, the sitemap and the preview image are made from it, so a site moved to its own
// domain sets VITE_SITE_URL (a build setting on Vercel) and nothing else changes.
export const SITE_URL = String(import.meta.env.VITE_SITE_URL || 'https://au-startup-map.vercel.app').replace(/\/$/, '');
import { BRAND } from './brand.js';
export const SITE_NAME = BRAND.name;

// The owner's own profile: a link to it, shown in the footer and on About. Nothing is read from it.
export const LINKEDIN_URL = 'https://www.linkedin.com/in/aryaninspires';

// The preview image links show (1200 x 630), made by scripts/make-og-image.mjs.
export const OG_IMAGE = { path: '/og-image.png', width: 1200, height: 630, alt: 'still early. The next big thing is someone. Australia’s startup community.' };

// path -> { title, description }. Each title is its own; none repeats another page's.
export const PAGE_META = {
  '/': {
    title: `${SITE_NAME} · Australian startups on a map`,
    description: 'Australian startups on a map and in a list: where they are, who is hiring now, and the page each fact came from. A beta, independent project.',
  },
  '/welcome': {
    title: `${SITE_NAME} · Australia’s startup community`,
    description: 'Meet the founders, operators and investors of Australia, and see what they are building. A community in the making, with a directory of startups and investors you can use today.',
  },
  '/lists': {
    title: `Curated lists of Australian startups · ${SITE_NAME}`,
    description: 'Lists of Australian startups by industry, city and what they are doing now.',
  },
  '/investors': {
    title: `Australian startup investors · ${SITE_NAME}`,
    description: 'Investors in Australian startups: what each invests in and where, with the pages that back every claim.',
  },
  '/methodology': {
    title: `How we verify · ${SITE_NAME}`,
    description: 'How entries are checked: company websites, careers pages and public job boards only. What “Verified” and “Roles unverified” mean, and how to ask for a correction or removal.',
  },
  '/about': {
    title: `About · ${SITE_NAME}`,
    description: 'Who runs Still Early, why it exists, and what is live and what is not yet.',
  },
  '/contact': {
    title: `Contact · ${SITE_NAME}`,
    description: 'Send a correction, a removal request or a question about Still Early. A person reads every message.',
  },
};

export const absolute = (path) => `${SITE_URL}${path === '/' ? '/' : path}`;
