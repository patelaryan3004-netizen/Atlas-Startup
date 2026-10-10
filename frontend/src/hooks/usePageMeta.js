import { useEffect } from 'react';

// What a page says about itself to the tab, a search engine and a link preview: its title, a line describing it, its own address,
// and (for a company) structured data. The pages of one visit nest (the directory, then an investor in it), so the newest page's
// fields win, each field falls back to the page under it, and the last to go gives the document back as it found it.
//
// meta: { title, description, path, jsonLd } (all optional); null does nothing.
const stack = [];
let found = null; // the document as it was before any page took over, and what this file added to it

const DESCRIPTION = 'meta[name="description"]';
const CANONICAL = 'link[rel="canonical"]';
const JSON_LD = 'script[data-page-jsonld]';
const OG = { 'og:title': 'title', 'og:description': 'description', 'og:url': 'url' };

const read = (selector, attr) => document.head.querySelector(selector)?.getAttribute(attr) ?? null;

function tag(selector, make) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = make();
    document.head.append(el);
    found.added.add(el);
  }
  return el;
}

function put(selector, make, attr, value) {
  if (value == null) return;
  tag(selector, make).setAttribute(attr, value);
}

function begin() {
  found = {
    title: document.title,
    description: read(DESCRIPTION, 'content'),
    canonical: read(CANONICAL, 'href'),
    og: Object.fromEntries(Object.keys(OG).map((p) => [p, read(`meta[property="${p}"]`, 'content')])),
    added: new Set(),
  };
}

function restore() {
  if (!found) return;
  document.title = found.title;
  const back = (selector, attr, value) => { const el = document.head.querySelector(selector); if (el && !found.added.has(el) && value != null) el.setAttribute(attr, value); };
  back(DESCRIPTION, 'content', found.description);
  back(CANONICAL, 'href', found.canonical);
  for (const [p, value] of Object.entries(found.og)) back(`meta[property="${p}"]`, 'content', value);
  for (const el of found.added) el.remove();
  document.head.querySelector(JSON_LD)?.remove();
  found = null;
}

function apply() {
  if (!stack.length) { restore(); return; }
  if (!found) begin();
  const top = {};
  for (const entry of stack) for (const [key, value] of Object.entries(entry)) if (value != null) top[key] = value;
  if (top.title) document.title = top.title;
  const url = top.path != null ? new URL(top.path, window.location.origin).href : null;
  put(DESCRIPTION, () => Object.assign(document.createElement('meta'), { name: 'description' }), 'content', top.description);
  put(CANONICAL, () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', url);
  const ogValues = { title: top.title, description: top.description, url };
  for (const [property, field] of Object.entries(OG)) {
    put(`meta[property="${property}"]`, () => { const m = document.createElement('meta'); m.setAttribute('property', property); return m; }, 'content', ogValues[field]);
  }
  document.head.querySelector(JSON_LD)?.remove();
  if (top.jsonLd) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-page-jsonld', '');
    script.textContent = JSON.stringify(top.jsonLd).replace(/</g, '\\u003c');
    document.head.append(script);
  }
}

export function usePageMeta(meta) {
  const key = meta ? JSON.stringify(meta) : null;
  useEffect(() => {
    if (!key) return undefined;
    const entry = JSON.parse(key);
    stack.push(entry);
    apply();
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      apply();
    };
  }, [key]);
}

export const usePageTitle = (title) => usePageMeta(title ? { title } : null);
