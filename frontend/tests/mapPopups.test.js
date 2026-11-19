import { describe, it, expect, vi } from 'vitest';
import { companyPopup, institutionPopup } from '../src/mapPopups.js';

// [slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked, logo, metro, sectorGroup, suburb]
const tuple = (over = {}) => {
  const base = ['acme', 'Acme', -33.87, 151.21, 'HealthTech', 'Sydney', 0, 'acme.example', 'EXACT', '1 George Street, Surry Hills, Sydney', 1, null, 'Sydney', 'Health & Biotech', 'Surry Hills'];
  for (const [i, v] of Object.entries(over)) base[i] = v;
  return base;
};
const text = (el, selector) => el.querySelector(selector).textContent;

describe('a company\'s card', () => {
  it('is the name, one plain sentence, the sector and the suburb and city, and one way on: nothing else', () => {
    const card = companyPopup(tuple(), { onOpen: vi.fn() });
    card.fill({ blurb: 'Makes clinical software. It is used in 200 hospitals.', stage: 'Seed', website: 'https://acme.example', last_verified_at: '2026-11-01T00:00:00Z', hiring: true });
    const { element } = card;
    expect(text(element, '.pin-pop-name')).toBe('Acme');
    expect(element.querySelector('h3')).not.toBeNull();
    expect(text(element, '.pin-pop-blurb')).toBe('Makes clinical software.'); // the first sentence
    expect(text(element, '.pin-pop-facts')).toBe('Health & Biotech · Surry Hills, Sydney'); // the display sector, never the street
    expect(element.querySelectorAll('.pin-pop-cta')).toHaveLength(1);
    expect(text(element, '.pin-pop-cta')).toBe('View company');
    // none of what is on the company's own page
    expect(element.querySelector('details')).toBeNull();
    expect(element.querySelector('a')).toBeNull(); // no website link, no source link
    expect(element.querySelector('.pin-pop-status,.pin-pop-fresh,.pin-pop-report,.pin-pop-site,.pin-pop-more')).toBeNull();
    expect(element.textContent).not.toMatch(/verified|checked|source|office address|suburb-level|precision|hiring|Seed|report/i);
    expect(element.textContent).not.toContain('George Street');
  });

  it('puts the one call to action to work', () => {
    const onOpen = vi.fn();
    const { element } = companyPopup(tuple(), { onOpen });
    element.querySelector('.pin-pop-cta').click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('says only what the pin knows before the record arrives, and leaves out what it does not know', () => {
    const quiet = companyPopup(tuple(), { onOpen: vi.fn() }).element;
    expect(quiet.querySelector('.pin-pop-blurb').hidden).toBe(true); // no sentence until the record gives one
    expect(text(quiet, '.pin-pop-facts')).toBe('Health & Biotech · Surry Hills, Sydney');
    // no sector, no suburb: only the city; no city either: nothing is written
    const noSector = companyPopup(tuple({ 4: 'Unknown', 13: null, 14: null }), { onOpen: vi.fn() }).element;
    expect(text(noSector, '.pin-pop-facts')).toBe('Sydney');
    const nothing = companyPopup(tuple({ 4: '', 5: '', 13: null, 14: null }), { onOpen: vi.fn() }).element;
    expect(nothing.querySelector('.pin-pop-facts').hidden).toBe(true);
  });

  it('says the sector the source gave where the server sent no display sector (an older answer), and never "Unknown"', () => {
    const older = companyPopup(['a', 'A', 0, 0, 'Fintech', 'Perth', 0, ''], { onOpen: vi.fn() }).element;
    expect(text(older, '.pin-pop-facts')).toBe('Fintech · Perth');
    const unknown = companyPopup(['b', 'B', 0, 0, 'Unknown', 'Perth', 0, ''], { onOpen: vi.fn() }).element;
    expect(text(unknown, '.pin-pop-facts')).toBe('Perth');
  });

  it('says a suburb that is the city once', () => {
    const card = companyPopup(tuple({ 5: 'Yatala', 14: 'Yatala', 13: 'Deep Tech & Space' }), { onOpen: vi.fn() });
    expect(text(card.element, '.pin-pop-facts')).toBe('Deep Tech & Space · Yatala');
  });

  it('takes the sentence, and a sector or suburb the pin lacked, from the record when it arrives', () => {
    const card = companyPopup(tuple({ 13: null, 14: null }), { onOpen: vi.fn() });
    card.fill({ blurb: 'Link-in-bio pages for creators', sectorGroup: 'Consumer & Commerce', suburb: 'Collingwood' });
    expect(text(card.element, '.pin-pop-blurb')).toBe('Link-in-bio pages for creators');
    expect(card.element.querySelector('.pin-pop-blurb').hidden).toBe(false);
    expect(text(card.element, '.pin-pop-facts')).toBe('Consumer & Commerce · Collingwood, Sydney'); // (the city is the pin's own)
  });

  it('cuts a long first sentence at a word, with an ellipsis, and never invents one', () => {
    const card = companyPopup(tuple(), { onOpen: vi.fn() });
    card.fill({ blurb: `${'Builds software that helps clinics book, bill and follow up with patients across Australia and New Zealand '.repeat(4)}end.` });
    const line = text(card.element, '.pin-pop-blurb');
    expect(line.length).toBeLessThanOrEqual(170);
    expect(line.endsWith('…')).toBe(true);
    expect(line).not.toMatch(/\s…$/);
    const empty = companyPopup(tuple(), { onOpen: vi.fn() });
    empty.fill({ blurb: '   ' });
    expect(empty.element.querySelector('.pin-pop-blurb').hidden).toBe(true);
  });

  it('writes a hostile name and line as text only', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const card = companyPopup(['e', evil, 0, 0, 'AI', 'Sydney', 0, ''], { onOpen: vi.fn() });
    card.fill({ blurb: evil });
    expect(card.element.querySelector('img')).toBeNull();
    expect(text(card.element, '.pin-pop-name')).toBe(evil);
    expect(text(card.element, '.pin-pop-blurb')).toBe(evil);
  });

  it('does nothing when filled with nothing', () => {
    const card = companyPopup(tuple(), { onOpen: vi.fn() });
    expect(() => card.fill(null)).not.toThrow();
    expect(card.element.querySelector('.pin-pop-blurb').hidden).toBe(true);
  });
});

describe('a firm\'s card', () => {
  const pin = (over = {}) => ({ id: 'f#0', institution: 'f', name: 'Example Capital', city: 'Sydney', office: 'Sydney HQ', place: 'Level 2, 12 Example Street, Sydney NSW 2000', website: 'https://capital.example', href: null, ...over });

  it('has the name, where the office is, one way in and "More"', () => {
    const { element } = institutionPopup(pin(), { onOpen: vi.fn() });
    expect(text(element, '.pin-pop-name')).toBe('Example Capital');
    expect(text(element, '.pin-pop-blurb')).toBe('Sydney HQ · Sydney');
    expect(element.querySelectorAll('.pin-pop-cta')).toHaveLength(1);
    expect(element.querySelector('details.pin-pop-more').open).toBe(false);
    expect(text(element, '.pin-pop-more')).toContain('Level 2, 12 Example Street');
  });

  it('opens the firm\'s page in the app from a plain click, and leaves a click that means "elsewhere" to the browser', () => {
    const onOpen = vi.fn();
    const { element } = institutionPopup(pin({ href: '/investors/example-capital' }), { onOpen });
    const cta = element.querySelector('a.pin-pop-cta');
    expect(cta.textContent).toBe('View investor');
    expect(cta.getAttribute('href')).toBe('/investors/example-capital');
    cta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    expect(onOpen).not.toHaveBeenCalled();
    cta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(onOpen).toHaveBeenCalledWith('/investors/example-capital');
    // and the website moves under "More", so there is still one call to action
    expect(element.querySelectorAll('.pin-pop-cta')).toHaveLength(1);
    expect(element.querySelector('.pin-pop-more .pin-pop-site').getAttribute('href')).toBe('https://capital.example');
  });

  it('sends a firm with no page of its own to its website, and has no way in when it has neither', () => {
    const own = institutionPopup(pin(), { onOpen: vi.fn() }).element.querySelector('a.pin-pop-cta');
    expect(own.textContent).toBe('Visit website');
    expect(own.target).toBe('_blank');
    expect(own.rel).toBe('noopener noreferrer');
    expect(institutionPopup(pin({ website: null }), { onOpen: vi.fn() }).element.querySelector('.pin-pop-cta')).toBeNull();
  });

  it('leaves out what it does not know: no line, no row', () => {
    const { element } = institutionPopup(pin({ office: null, city: null, place: null, website: null }), { onOpen: vi.fn() });
    expect(element.querySelector('.pin-pop-blurb')).toBeNull();
    expect(element.querySelectorAll('.pin-pop-rows div')).toHaveLength(0);
  });

  it('writes a hostile name as text only', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { element } = institutionPopup(pin({ name: evil, place: evil }), { onOpen: vi.fn() });
    expect(element.querySelector('img')).toBeNull();
    expect(text(element, '.pin-pop-name')).toBe(evil);
  });
});
