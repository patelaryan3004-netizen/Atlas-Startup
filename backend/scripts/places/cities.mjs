// What differs from one city to the next in the research importer (import.mjs): the city and its state, the research file and its folder, the postcodes and suburbs the
// pages are read for, and the sites a list links to that are not a company's own. Everything else (the rules a row must meet) is the same for every city.
//
// To add a city: add an entry here, put its research file in scripts/<dir>/research/, give the postcode ranges of its Greater area to src/geo/metro.js, and run
// `node scripts/places/import.mjs <step> --city <id>` (docs/perth-import.md describes the steps).

export const CITIES = {
  perth: {
    id: 'perth', name: 'Perth', greater: 'Greater Perth', state: 'WA', stateName: 'Western Australia', regional: 'regional WA', dir: 'perth',
    researchFile: 'perth-startups-research-2026-10-31.json', sourceId: 'perth-research-2026-10-31', doc: 'docs/perth-import.md', postcodeLead: '6',
    cityWords: ['Perth', 'Fremantle'],
    // the suburbs a page says a company is "based in" (a state and postcode in the address is read whatever the suburb)
    suburbs: "Perth|Fremantle|Subiaco|Nedlands|Crawley|Joondalup|Osborne Park|Leederville|Northbridge|West Perth|East Perth|South Perth|Victoria Park|Bentley|Malaga|Belmont|Cannington|Canning Vale|Welshpool|Kewdale|Jandakot|Henderson|Murdoch|Claremont|Cottesloe|Scarborough|Wangara|Balcatta|Myaree|Bibra Lake|O'Connor|Osborne|Mount Lawley|Innaloo|Rockingham|Midland|Maylands|Burswood|Applecross|Booragoon|Cockburn|Spearwood|Kwinana|Morley|Bayswater|Wembley|Karrinyup|Stirling|Balga|Rivervale|Hazelmere|Bassendean|Guildford|Forrestfield|Kelmscott|Armadale|Gosnells|Thornlie|Maddington|Wattle Grove|Kensington|Como|Mosman Park",
    // a suburb and a postcode with no state ("Perth 6000") is read as that suburb in the city's state
    bareSuburbs: ['Perth', 'West Perth', 'East Perth', 'South Perth', 'Subiaco', 'Osborne Park', 'Fremantle', 'Nedlands', 'Joondalup', 'Malaga', 'Bentley', 'Claremont', 'Leederville', 'Northbridge'],
    // a page a list links to that is not a company's own (the lists, programmes, funds and directories the research cites)
    skipHosts: /(^|\.)(spacecubed\.com|ventureuwa\.com\.au|curtin\.edu\.au|wa\.gov\.au|remjobs\.works|purpose\.ventures|fundwa\.com\.au|biodesign\.au|perthbiodesign\.au|startupblink\.com|techboard\.com\.au|third-derivative\.org|austrade\.gov\.au|abr\.business\.gov\.au|walga\.asn\.au|startupnews\.com\.au|verbund\.com|zfrmz\.com\.au|biodesignmelbourne\.com)$/i,
    hubOwn: ['spacecubed', 'curtin', 'ventureuwa', 'biodesign'], // a cited page of these is an accelerator's profile, not a directory listing
  },
  melbourne: {
    id: 'melbourne', name: 'Melbourne', greater: 'Greater Melbourne', state: 'VIC', stateName: 'Victoria', regional: 'regional Victoria', dir: 'melbourne',
    researchFile: 'melbourne-startups-research-2026-10-31.json', sourceId: 'melbourne-research-2026-10-31', doc: 'docs/melbourne-import.md', postcodeLead: '3',
    cityWords: ['Melbourne'],
    suburbs: "Melbourne|Docklands|Southbank|South Melbourne|Port Melbourne|North Melbourne|West Melbourne|East Melbourne|Carlton|Parkville|Fitzroy|Collingwood|Abbotsford|Richmond|Cremorne|Burnley|Hawthorn|Kew|Camberwell|Malvern|Armadale|Toorak|South Yarra|Prahran|Windsor|St Kilda|Brighton|Elwood|Cheltenham|Moorabbin|Mentone|Braeside|Dandenong|Springvale|Keysborough|Clayton|Notting Hill|Mulgrave|Glen Waverley|Mount Waverley|Oakleigh|Box Hill|Burwood|Blackburn|Nunawading|Ringwood|Doncaster|Bulleen|Heidelberg|Ivanhoe|Greensborough|Eltham|Bundoora|Preston|Thornbury|Northcote|Brunswick|Coburg|Essendon|Moonee Ponds|Flemington|Kensington|Footscray|Yarraville|Seddon|Williamstown|Newport|Altona|Laverton|Sunshine|Tullamarine|Brooklyn|Epping|Thomastown|Campbellfield|Craigieburn|Sunbury|Werribee|Truganina|Tarneit|Point Cook|Frankston|Cranbourne|Scoresby|Rowville|Bayswater|Knoxfield|Lilydale|Fishermans Bend|Fisherman's Bend|Collingwood|Alphington|Clifton Hill|Balaclava|Caulfield|Carnegie|Bentleigh|Sandringham|Hampton|Cremorne|Hawthorn East|Surrey Hills|Canterbury|Mitcham|Heatherton|Dingley Village|Clarinda",
    bareSuburbs: ['Melbourne', 'Docklands', 'Southbank', 'South Melbourne', 'Port Melbourne', 'North Melbourne', 'West Melbourne', 'East Melbourne', 'Carlton', 'Parkville', 'Fitzroy', 'Collingwood', 'Richmond', 'Cremorne', 'Abbotsford', 'Hawthorn', 'Clayton', 'Brunswick'],
    skipHosts: /(^|\.)(melbournestartups\.com|monash\.edu|unimelb\.edu\.au|rmit\.edu\.au|swinburne\.edu\.au|deakin\.edu\.au|latrobe\.edu\.au|startmate\.com|echai\.ventures|themap\.co|linktr\.ee|blackbird\.vc|jobs\.blackbird\.vc|vic\.gov\.au|business\.vic\.gov\.au|startupvic\.com|abr\.business\.gov\.au|austrade\.gov\.au|dealroom\.co|crunchbase\.com|linkedin\.com|insolvencyinsider-au\.com)$/i,
    hubOwn: ['monash', 'unimelb', 'rmit', 'swinburne', 'deakin', 'latrobe', 'startmate', 'echai'],
  },
};

// The patterns a city needs, built from its entry. A page's wording is read three ways: an address (a state and a four-digit postcode in the city's range), a
// sentence that the company is based in the city, and an address in another state (which is somewhere else, not here).
export function matchersOf(c) {
  const states = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'].filter((s) => s !== c.state);
  const stateAny = `(?:${c.state}|${c.stateName})`;
  const bare = new RegExp(String.raw`\b(${c.bareSuburbs.join('|')})\s+(${c.postcodeLead}\d{3})\b`, 'g');
  return {
    // "Victoria" is spelled "VIC", and a suburb and postcode with no state gets the state: the address reads the same as one written in full
    normState: (t) => String(t).replace(new RegExp(String.raw`\b${c.stateName}\b(?=[\s,]*${c.postcodeLead}\d{3}\b)`, 'gi'), c.state).replace(bare, `$1 ${c.state} $2`),
    based: new RegExp(String.raw`(?:based|located|headquartered|head office|headquarters|HQ|our office|offices?|studio|laborator(?:y|ies)|lab|workshop|facility|clinic)[^.]{0,70}\b(?:${c.suburbs})\b[^.]{0,30}`, 'i'),
    statement: new RegExp(String.raw`\b(?:${c.suburbs})\s*,?\s*${stateAny}\b|\b(?:${c.cityWords.join('|')})(?:[- ]based|[- ](?:company|startup|start-up|business|firm|biotech|technology company))\b`, 'i'),
    otherState: new RegExp(String.raw`([^.;|]{0,80}\b(?:${states.join('|')})\b[\s,]*\d{4}\b)`, 'g'),
    addrFwd: () => new RegExp(String.raw`([^.;|]{0,90}?\b${c.state}\b[\s,]*${c.postcodeLead}\d{3}\b)`, 'g'),
    addrBack: () => new RegExp(String.raw`([^.;|]{0,90}?\b${c.postcodeLead}\d{3}\b[\s,]*${c.state}\b)`, 'g'),
    addrLong: () => new RegExp(String.raw`([^.;|]{0,90}?\b${stateAny}\b[\s,]*${c.postcodeLead}\d{3}\b)`, 'g'),
    mentions: new RegExp(String.raw`\b(?:${c.cityWords.join('|')})\b|${c.suburbs.split('|').slice(0, 12).join('|')}|${c.stateName}|\b${c.state}\b`),
    cityNamed: new RegExp(String.raw`\b(?:${c.suburbs.split('|').slice(0, 14).join('|')})\b`),
    cityStatement: new RegExp(String.raw`[^.]{0,70}\b(?:${c.suburbs.split('|').slice(0, 14).join('|')})\b[^.]{0,50}`),
    accelerator: new RegExp(c.hubOwn.join('|')),
    box: /\b(?:P\.?\s?O\.?\s*Box|GPO Box|Locked Bag)\b/i,
  };
}
