// How a row of a city's research list is read: a clean name, the other names it gives, the pages it can be checked against. Pure, so it is tested
// (tests/placesImport.test.js). The importer (import.mjs) does everything that touches the network or the data.
import { nameKey } from '../../src/models/identity.js';

export const slug = (name) => nameKey(name).replace(/ /g, '-');

export function isLinkedIn(url) {
  try { return /(^|\.)linkedin\.com$/i.test(new URL(url).hostname); } catch { return false; }
}

// A row as the importer uses it: a clean name (a name in brackets is an other name), the other names the row gives ("Previously X / Y"), the sources it can be checked
// against (a LinkedIn page is never read, so it is never one of them), and the group and relationship the research gave it.
export function rowOf(r) {
  const bracket = [...r.name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  const previously = /Previously ([^;.]+)/i.exec(r.note ?? '')?.[1]?.split('/').map((s) => s.trim()).filter(Boolean) ?? [];
  const name = r.name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const all = r.sources ?? [];
  const sources = all.filter((u) => !isLinkedIn(u));
  return {
    key: slug(name), name, aliases: [...bracket, ...previously], website: r.website ?? null, group: r.group, relationship: r.perth_relationship ?? r.melbourne_relationship ?? r.relationship ?? null, established: ['established_or_listed_tech', 'established_or_acquired'].includes(r.group), operatingStatus: r.operating_status ?? null, fundingStage: r.funding_stage ?? null, sector: r.sector ?? null, note: r.note ?? null,
    sources, skippedSources: all.filter((u) => !sources.includes(u)),
  };
}

// A page that says a business has stopped being one: closed, wound up, acquired, "now part of" another. Such a row is not published as an operating startup.
export const CLOSED = /\b(permanently closed|ceased trading|has ceased (?:trading|operating|to trade)|no longer (?:trading|operating)|has been (?:acquired|wound up|deregistered)|is now part of|we have closed|(?:has|have|was|were) (?:been )?(?:placed|put|entered|gone) (?:in|into) (?:voluntary )?(?:administration|liquidation|receivership))\b/i;

// The words two descriptions share: five letters or more, not one of the words every description has. A website found only by guessing its domain is taken for the
// company a list describes only when the list's words and the site's words meet (a name alone is not an identity: "Catalyst" and "Minerva" are many companies).
const COMMON = new Set(['australia', 'australian', 'western', 'perth', 'startup', 'startups', 'company', 'platform', 'business', 'businesses', 'based', 'their', 'which', 'about', 'helping', 'building', 'provide', 'provides', 'solutions', 'solution', 'technology', 'technologies', 'services', 'service', 'software', 'product', 'products', 'customers', 'people', 'founder', 'founders', 'program', 'programme', 'cohort', 'accelerate', 'accelerator', 'venture', 'ventures', 'digital', 'online', 'future', 'world', 'every', 'where', 'while', 'across', 'these', 'those', 'through', 'using', 'other', 'between', 'curtin', 'spacecubed', 'eight', 'welcome', 'home', 'learn', 'contact', 'launching', 'soon']);
export function sharedWords(a, b) {
  const words = (t) => new Set((String(t).toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !COMMON.has(w)));
  const wb = words(b);
  return [...words(a)].filter((w) => wb.has(w));
}

// A street address as a page wrote it, without the label and the junk before it ("Head office: 24 Hasler Road, Osborne Park, WA, 6017" -> "24 Hasler Road, Osborne Park, WA, 6017"),
// so the geocoder is asked the address and not the page's wording. Null when there is no street in it (a suburb and a postcode are not a place to put a pin).
const STREET = String.raw`(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Terrace|Tce|Highway|Hwy|Way|Place|Pl|Court|Ct|Lane|Ln|Boulevard|Blvd|Parade|Pde|Crescent|Cres|Esplanade|Circuit|Cct|Close|Loop|Mews|Parkway|Pkwy|Square|Sq|Walk|Grove|Gr)`;
const STREET_ADDRESS = new RegExp(String.raw`((?:(?:(?:Unit|Suite|Level|Lvl|Shop|Lot)\s*|L\s*(?=\d))[\d/A-Za-z-]+[,\s]+)?\d+[A-Za-z]?(?:\s*[-–/]\s*\d+[A-Za-z]?)?\s+[A-Za-z][A-Za-z'’. -]{1,40}?\s${STREET}\b.*)$`);
export function cleanAddress(text) {
  const t = String(text ?? '').replace(/[​-‏⁠﻿ ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\bSt,\s+(Kilda|Georges|George|Leonards|Helier|James|Albans|Vincent|Pauls|Marys|Johns|Andrews|Peters)\b/g, 'St $1');
  if (/\b(P\.?\s?O\.?\s*Box|GPO Box|Locked Bag)\b/i.test(t)) return null;
  const m = STREET_ADDRESS.exec(t);
  // "L1 1109 Hay St" and "Lvl 1, 1109 Hay St" are "Level 1, 1109 Hay St": the form the location code reads as a street address with a floor
  return m ? m[1].replace(/\s*,\s*/g, ', ').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').replace(/\bSt,\s+(Kilda|Georges|George|Leonards|Helier|James|Albans|Vincent|Pauls|Marys|Johns|Andrews|Peters)\b/g, 'St $1').replace(/\bVIC\s+(Street|St|Road|Rd|Avenue|Ave|Parade|Pde|Place|Pl|Lane|Ln|Court|Ct|Drive|Dr|Terrace|Highway|Hwy)\b/g, 'Victoria $1').replace(new RegExp(String.raw`(\b${STREET})\s+(?![A-Za-z'’. -]{0,40}?\b${STREET}\b)(?=[A-Z][a-z])`, 'g'), '$1, ').replace(/^(?:L|Lvl\.?)\s*(\d+)[,\s]+(?=\d)/i, 'Level $1, ').trim() : null;
}
