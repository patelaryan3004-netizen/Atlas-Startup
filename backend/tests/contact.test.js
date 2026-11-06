import { describe, it, expect } from 'vitest';
import { findContacts, redactContacts, hasContact } from '../src/models/contact.js';

describe('contact details quoted from a page', () => {
  it('finds an email address, a landline, a service number, a mobile and a foreign number, and says which is which', () => {
    const kinds = (t) => findContacts(t).map((c) => `${c.kind}:${c.text.trim()}`);
    expect(kinds('Email: hello@example.com Last')).toEqual(['email:hello@example.com']);
    expect(kinds('Call us on (02) 9999 1234 or 02 9999 1234')).toEqual(['phone:(02) 9999 1234', 'phone:02 9999 1234']);
    expect(kinds('+61 7 5550 0123')).toEqual(['phone:+61 7 5550 0123']);
    expect(kinds('Call 1800 000 123, 1300 000 123 or 1300000123 or 13 99 99')).toEqual(['phone:1800 000 123', 'phone:1300 000 123', 'phone:1300000123', 'phone:13 99 99']);
    expect(kinds('au (04) 5550 0123 Example Building')).toEqual(['mobile:(04) 5550 0123']);
    expect(kinds('mobile 0412 345 678 or +61 412 345 678')).toEqual(['mobile:0412 345 678', 'mobile:+61 412 345 678']);
    expect(kinds('London +44 20 7946 0123, Sales 1-555-010-0199, (555) 010-0199')).toHaveLength(3);
  });

  it('leaves addresses, ABNs, ACNs, postcodes, years, dates and ranges of street numbers alone', () => {
    for (const t of [
      'Level 5, 485 La Trobe Street, Melbourne VIC 3000', '1/118 Devonshire St, Surry Hills NSW 2010', '2125 Princes Highway, Clayton VIC 3168', '11-15 Smeaton Ave, Dandenong South VIC 3165',
      'ABN 53 004 085 616 and ACN 684 502 332', 'Acme Robotics Pty Ltd (ACN 004 085 616)', 'founded in 2013, 2014 and 2015', '2026-11-05T12:25:49.117Z', 'Suite 1007, 120 High Street, North Sydney NSW 2060',
      'Level 12, 1300 Burwood Road', '13-14 Smith Street', 'Series A of $3.5 million in 2025', 'Pilbara 6000 tonnes', 'G10/45 Edward Street 4000',
    ]) expect(findContacts(t), t).toEqual([]);
  });

  it('takes them out of a sentence and leaves the rest', () => {
    expect(redactContacts('Contact Acme: phone (08) 5550 0123, Melbourne and Auckland')).toBe('Contact Acme: phone [phone removed], Melbourne and Auckland');
    expect(redactContacts('Join Our Vibrant Community - Example Co 1800 000 123')).toBe('Join Our Vibrant Community - Example Co [phone removed]');
    expect(redactContacts('Help students excel, book demo on 1300000123.')).toBe('Help students excel, book demo on [phone removed].');
    expect(redactContacts('Contact Emails General hi@example.com Sup')).toBe('Contact Emails General [email removed] Sup');
    expect(redactContacts('Reach us on (04) 5550 0123 Example Building')).toBe('Reach us on [phone removed] Example Building');
    expect(redactContacts('No contact here, 1 George Street, Sydney NSW 2000')).toBe('No contact here, 1 George Street, Sydney NSW 2000');
    expect(redactContacts(null)).toBeNull();
    expect(hasContact('x@y.com')).toBe(true);
    expect(hasContact('plain words')).toBe(false);
  });
});
