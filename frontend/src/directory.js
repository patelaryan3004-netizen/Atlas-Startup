// What the directory's filters and table call the optional facts about a company, and the filter presets built from them. Shared by the
// filters panel, the chips that show what is on, the quick filters and the table, so each says the same thing in the same words.

// "Seed to Series A": the stages from Seed up to Series A in the order a company moves through them (the server's STAGE_ORDER puts Early
// between them). It is the stage filter holding several values, like the sector and city filters do.
export const SEED_TO_SERIES_A = 'Seed,Early,Series A';

// remote-global works from anywhere; remote-au is remote within Australia; hybrid and onsite are what a posting says of the office.
// A policy the directory does not know says nothing.
const REMOTE_LABELS = { 'remote-global': 'Remote, worldwide', 'remote-au': 'Remote in Australia', hybrid: 'Hybrid', onsite: 'On-site' };
export const remoteLabel = (code) => REMOTE_LABELS[code] ?? null;

// Team size in buckets that do not overlap (the server's TEAM_BUCKETS): 10 is "10–29", and 100 is "100+".
const TEAM_LABELS = { lt10: 'Under 10', '10-29': '10–29', '30-99': '30–99', '100plus': '100+' };
export const teamLabel = (code) => TEAM_LABELS[code] ?? null;
