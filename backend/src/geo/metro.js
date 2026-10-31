// Which of the ten big cities a place belongs to, from its state and postcode. A company's `city` is often the suburb its address is in ("North Sydney",
// "Richmond"), and the map page's city menu and the city filter speak of the ten cities: so a company in a suburb is found under its city too, whatever its
// `city` says. Only where the postcode is inside the city's own range: a town on the edge of a city is not counted as the city, and a company whose address
// has no postcode (or one outside the ten) belongs to no city beyond its own `city`. Nothing is written to a record by this.
const RANGES = [
  ['NSW', 2000, 2234, 'Sydney'], ['NSW', 2280, 2310, 'Newcastle'], ['ACT', 2600, 2618, 'Canberra'], ['ACT', 2900, 2920, 'Canberra'], ['VIC', 3000, 3207, 'Melbourne'],
  ['QLD', 4000, 4179, 'Brisbane'], ['QLD', 4210, 4230, 'Gold Coast'], ['SA', 5000, 5199, 'Adelaide'], ['WA', 6000, 6199, 'Perth'], ['TAS', 7000, 7109, 'Hobart'], ['NT', 800, 832, 'Darwin'],
];

export const BIG_CITIES = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast', 'Newcastle', 'Hobart', 'Darwin'];

export function metroOfPostcode(state, postcode) {
  const code = Number(postcode);
  if (!state || !Number.isInteger(code)) return null;
  return RANGES.find(([s, from, to]) => s === state && code >= from && code <= to)?.[3] ?? null;
}

// { city, state, postcode } for an address that carries an Australian state and a four-digit postcode ("80 George St, The Rocks NSW 2000"): city is null when the
// postcode is outside the ten cities; the whole answer is null when the text has no state and postcode.
export function placeOfAddress(address) {
  const m = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b[\s,]*(\d{4})\b/.exec(String(address ?? ''));
  if (!m) return null;
  return { city: metroOfPostcode(m[1], m[2]), state: m[1], postcode: m[2] };
}

// The big city a company is in: by its own postcode, else by the postcode in its address, else the city it names if that is one of the ten.
export function metroOf(record) {
  const own = metroOfPostcode(record.state, record.postcode);
  if (own) return own;
  const fromAddress = placeOfAddress(record.address)?.city;
  if (fromAddress) return fromAddress;
  return BIG_CITIES.includes(record.city) ? record.city : null;
}
