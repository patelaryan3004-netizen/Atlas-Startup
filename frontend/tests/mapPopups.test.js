import { describe, it, expect, vi } from 'vitest';
import { companyPopup, institutionPopup } from '../src/mapPopups.js';

// [slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked, logo]
const tuple = (over = []) => ['acme', 'Acme', -33.87, 151.21, 'AI', 'Sydney', 0, 'acme.example', 'EXACT', '1 George Street, Sydney', 1, null, ...over].slice(0, 12);
const text = (el, selector) => el.querySelector(selector).textContent;

describe('a company\'s card', () => {
  it('has the name, one call to action, and "More" folded away', () => {
    const { element } = companyPopup(tuple(), { onOpen: vi.fn() });
    expect(text(element, '.pin-pop-name')).toBe('Acme');
    expect(element.querySelector('h3')).not.toBeNull();
    expect(element.querySelectorAll('.pin-pop-cta')).toHaveLength(1);
    expect(element.querySelector('details.pin-pop-more').open).toBe(false);
    expect(text(element, '.pin-pop-more summary')).toBe('More');
  });

  it('puts the one call to action to work', () => {
    const onOpen = vi.fn();
    const { element } = companyPopup(tuple(), { onOpen });
    element.querySelector('.pin-pop-cta').click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('says only what the pin knows before the record arrives: no line, no hiring claim unless the pin says hiring', () => {
    const quiet = companyPopup(tuple(), { onOpen: vi.fn() }).element;
    expect(quiet.querySelector('.pin-pop-blurb').hidden).toBe(true);
    expect(quiet.querySelector('.pin-pop-status').hidden).toBe(true);
    const hiring = companyPopup(tuple().map((v, i) => (i === 6 ? 1 : v)), { onOpen: vi.fn() }).element;
    expect(hiring.querySelector('.pin-pop-status').hidden).toBe(false);
    expect(text(hiring, '.hiring-badge')).toBe('● Hiring now');
  });

  it('keeps sector, place and how well the place is known under "More", and leaves out what it does not know', () => {
    const { element } = companyPopup(tuple(), { onOpen: vi.fn() });
    const rows = [...element.querySelectorAll('.pin-pop-rows div')].map((r) => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]);
    expect(rows).toEqual([['Sector', 'AI'], ['Place', '1 George Street, Sydney'], ['Location', 'Verified office']]);
    const bare = companyPopup(['b', 'B', 0, 0, 'Unknown', '', 0, ''], { onOpen: vi.fn() }).element;
    expect(bare.querySelectorAll('.pin-pop-rows div')).toHaveLength(0); // never "Unknown", never an empty row
  });

  it('fills in the line, the stage, when it was checked and the website when the record arrives', () => {
    const card = companyPopup(tuple(), { onOpen: vi.fn() });
    card.fill({ blurb: 'Makes things.', stage: 'Seed', hiringState: 'hiring', last_verified_at: new Date().toISOString(), website: 'https://acme.example', website_status: null });
    const el = card.element;
    expect(text(el, '.pin-pop-blurb')).toBe('Makes things.');
    expect(el.querySelector('.pin-pop-blurb').hidden).toBe(false);
    expect(text(el, '.hiring-badge')).toBe('● Hiring now');
    expect(el.querySelector('.hiring-badge').className).toBe('hiring-badge');
    const rows = [...el.querySelectorAll('.pin-pop-rows div')].map((r) => r.querySelector('dt').textContent);
    expect(rows).toEqual(['Sector', 'Stage', 'Place', 'Location', 'Website']); // when it was checked is said above, not under "More"
    expect(text(el, '.pin-pop-fresh')).toBe('Verified today');
    const site = el.querySelector('.pin-pop-site');
    expect(site.getAttribute('href')).toBe('https://acme.example');
    expect(site.target).toBe('_blank');
    expect(site.rel).toBe('noopener noreferrer');
    expect(site.textContent).toBe('acme.example');
  });

  it('says what the record says about hiring, in the same words as everywhere: dated, none, or unverified, never "not hiring"', () => {
    const say = (record) => { const card = companyPopup(tuple(), { onOpen: vi.fn() }); card.fill(record); return card.element.querySelector('.hiring-badge'); };
    const checked = say({ hiringState: 'checked', hiring_checked_at: '2026-10-05T03:59:04.292Z' });
    expect(checked.textContent).toBe('Hiring (checked 5 Oct)');
    expect(checked.className).toContain('hiring-badge-off');
    expect(say({ hiringState: 'none', hiring_checked_at: '2026-10-13T04:29:43.000Z' }).textContent).toBe('No open roles listed (13 Oct)');
    expect(say({ hiringState: 'unverified' }).textContent).toBe('Roles unverified');
    expect(say({}).textContent).toBe('Roles unverified');
  });

  describe('what it says about how far to trust the company', () => {
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const filled = (record) => { const card = companyPopup(tuple(), { onOpen: vi.fn() }); card.fill(record); return card.element; };

    it('says nothing about it until the record arrives, and nothing at all for a company with no check date', () => {
      const card = companyPopup(tuple(), { onOpen: vi.fn() }).element;
      expect(card.querySelector('.pin-pop-fresh').hidden).toBe(true);
      expect(card.querySelector('.badge-unverified').hidden).toBe(true);
      expect(card.querySelector('.concept-label').hidden).toBe(true);
      expect(filled({ verified: true }).querySelector('.pin-pop-fresh').hidden).toBe(true); // no placeholder, no "N/A"
      expect(filled({ verified: true, last_verified_at: 'not a date' }).querySelector('.pin-pop-fresh').hidden).toBe(true);
    });

    it('says when it was last checked, in words, where it can be seen without opening "More"', () => {
      const el = filled({ verified: true, last_verified_at: daysAgo(3) });
      const note = el.querySelector('.pin-pop-fresh');
      expect(note.hidden).toBe(false);
      expect(note.textContent).toBe('Verified 3 days ago');
      expect(note.className).toBe('pin-pop-fresh');
      expect(el.querySelector('.pin-pop-more').contains(note)).toBe(false);
    });

    it('says "Needs re-check", muted, once the check is over 60 days old, and not "Verified 61 days ago"', () => {
      const old = filled({ verified: true, last_verified_at: daysAgo(61) }).querySelector('.pin-pop-fresh');
      expect(old.textContent).toBe('Needs re-check');
      expect(old.className).toContain('pin-pop-fresh-stale');
      expect(filled({ verified: true, last_verified_at: daysAgo(60) }).querySelector('.pin-pop-fresh').textContent).toBe('Verified 8 weeks ago');
    });

    it('marks a company nobody has verified as "Unverified": only a record that says so, never one that says nothing', () => {
      expect(filled({ verified: false }).querySelector('.badge-unverified').hidden).toBe(false);
      expect(filled({ verified: false }).querySelector('.badge-unverified').textContent).toBe('Unverified');
      expect(filled({ verified: true }).querySelector('.badge-unverified').hidden).toBe(true);
      expect(filled({}).querySelector('.badge-unverified').hidden).toBe(true);
    });

    it('labels a company that opted in to task-gated applications a muted "Concept preview", and no other one', () => {
      const label = filled({ taskGate: { optedIn: true } }).querySelector('.concept-label');
      expect(label.hidden).toBe(false);
      expect(label.textContent).toBe('Concept preview');
      expect(filled({ taskGate: { optedIn: false } }).querySelector('.concept-label').hidden).toBe(true);
      expect(filled({ taskGate: { enabled: true } }).querySelector('.concept-label').hidden).toBe(true); // a flag with no opt-in is not a label
      expect(filled({}).querySelector('.concept-label').hidden).toBe(true);
    });

    it('never offers a task: no "Start task", no "Task-gated" badge', () => {
      const el = filled({ verified: false, taskGate: { optedIn: true }, last_verified_at: daysAgo(2) });
      expect(el.textContent).not.toMatch(/start task/i);
      expect(el.textContent).not.toMatch(/task-gated/i);
      expect(el.querySelectorAll('.pin-pop-cta')).toHaveLength(1);
    });
  });

  it('says a website that no longer answers is unavailable, and does not link it', () => {
    const card = companyPopup(tuple(), { onOpen: vi.fn() });
    card.fill({ website: 'https://zoomo.co', website_status: 'unavailable' });
    expect(card.element.querySelector('.pin-pop-site')).toBeNull();
    expect(card.element.querySelector('.pin-pop-more').textContent).toContain('Website unavailable');
  });

  it('writes a hostile name and line as text only', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const card = companyPopup(['e', evil, 0, 0, 'AI', 'Sydney', 0, ''], { onOpen: vi.fn() });
    card.fill({ blurb: evil, stage: evil, hiringState: 'unverified' });
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
