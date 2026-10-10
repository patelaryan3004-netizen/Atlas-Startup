// What a company's page tells a search engine, from the fields the record really has: nothing is added that the data does not say.

// A line for the page's description: its own blurb when it has one, otherwise who it is and where, from the record's fields.
export function startupDescription(s) {
  if (s.blurb) return s.blurb;
  const what = s.sectorFull || s.sector;
  const where = [s.city, s.state].filter(Boolean).join(', ');
  return [s.name, what && what !== 'Unknown' ? `${what} startup` : 'startup', where ? `in ${where}` : 'in Australia'].join(' ');
}

const country = (name) => (name === 'Australia' || !name ? 'AU' : name);

// schema.org Organization. A street address only for an office that is known (an exact location), the city and state otherwise.
export function startupJsonLd(s) {
  const place = {};
  if (s.city && s.city !== 'Unknown') place.addressLocality = s.city;
  if (s.state) place.addressRegion = s.state;
  if (s.location?.precision === 'EXACT' && s.address) {
    place.streetAddress = s.address;
    if (s.postcode) place.postalCode = s.postcode;
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: s.name,
    ...(s.website ? { url: s.website } : {}),
    ...(s.blurb ? { description: s.blurb } : {}),
    ...(s.foundedYear ? { foundingDate: String(s.foundedYear) } : {}),
    ...(Object.keys(place).length ? { address: { '@type': 'PostalAddress', ...place, addressCountry: country(s.country) } } : {}),
    ...(s.founders?.length ? { founder: s.founders.map((name) => ({ '@type': 'Person', name })) } : {}),
  };
}
