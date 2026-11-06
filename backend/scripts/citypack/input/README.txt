STILL EARLY — CITY DATA AND CLAUDE CODE PACK
Prepared 5 November 2026

HOW TO USE
1. Unzip this folder into your existing Still Early project, for example under research/still-early-city-pack/.
2. Open CLAUDE-CODE-PROMPT.txt and paste its complete contents into Claude Code.
3. Tell Claude the folder path. The full prompt references the supplied filenames.
4. Review the resulting import report and preview before publishing to production.

WHAT IS INCLUDED
Sydney: 1,463 reference entries: 935 source-labelled startups, 373 established companies, 102 investors and 53 ecosystem organisations.
Melbourne: 1,032 reference entries: 662 source-labelled startups, 211 established companies, 71 investors and 88 ecosystem organisations.
Perth: 39 reference entries: 22 source-labelled startups, 3 established companies, 4 investors and 10 ecosystem organisations.
Together these are 2,534 city-location entries. The same organisation can appear in multiple cities.
The full reference list was extracted for each city. This is not an exhaustive census of all local businesses, and the directory's classifications and addresses are not independently verified for every row.

Reference: http://sydneytechmap.com/ redirected to https://worldtechmap.com/sydney.
Source datasets:
https://worldtechmap.com/api/cities/sydney
https://worldtechmap.com/api/cities/melbourne
https://worldtechmap.com/api/cities/perth
Source consulted: 5 November 2026.

FILES
- CLAUDE-CODE-PROMPT.txt: complete implementation and design instruction.
- DESIGN-IDEAS.txt: recommended design and two alternatives.
- research-manifest.json: coverage, counts and limitations.
- sydney-worldtechmap-candidates.json: all 1,463 Sydney source entries, with factual fields and evidence status.
- melbourne-worldtechmap-candidates.json: all 1,032 Melbourne source entries.
- perth-worldtechmap-candidates.json: all 39 Perth source entries.
- sydney-company-list.txt, melbourne-company-list.txt, perth-company-list.txt: readable names, source categories, websites and addresses.
- perth-research-210.json: earlier non-exhaustive Perth research list from 31 October 2026.
- melbourne-research-342.json: earlier non-exhaustive Melbourne research list from 31 October 2026.
- address-updates-62.json: address evidence for 50 Melbourne companies and 12 Perth companies, including unresolved cases.
- perth-melbourne-addresses.txt: readable version of the 62-company address evidence.

ADDRESS STATUS
The reference has 1,064 Sydney, 603 Melbourne and 32 Perth rows flagged by that source for a pin and carrying address candidates. These are not independently verified offices. Another 835 source rows are city-only or source-pin-disabled.
Some source coordinates are approximate, city-centre points or intended for display. They are kept under source_latitude/source_longitude for audit, never silently promoted to verified canonical coordinates.
Canonical latitude and longitude remain null; ready_to_publish_exact_pin remains false throughout the supplied staging data.
For address-updates-62.json, Melbourne evidence is carried forward from 2 November; Perth evidence was checked again on 5 November. This pack adds no independently checked hiring or funding claims.
The original 210 and 342 research records overlap with the new reference files. Do not add their counts together and describe the result as unique companies.

PUBLICATION
Review company identity, official domain, actual local presence, current operating address and organisation type. Preserve postal/registered addresses as those address types. Unknown streets remain unknown.
Keep companies with verified city presence but unknown streets in the directory without an exact office pin.
The prompt instructs Claude to stage the full data, deduplicate carefully, resolve conflicts and produce honest before/after counts.
Narrative descriptions, news, logo image assets and the reference's application code have not been copied into this pack.
No changes have been made to your live website.
