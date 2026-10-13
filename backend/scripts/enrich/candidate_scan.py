#!/usr/bin/env python3
"""Look at a company's OWN website to see whether it is an Australian startup worth adding.  (Python 3.12, standard library only)

    python backend/scripts/enrich/candidate_scan.py probe --hosts hosts.json     # who is at these addresses, and is there anything Australian on the page
    python backend/scripts/enrich/candidate_scan.py scan  --input candidates_input.json --out candidates_to_add.json

It reads with the SAME fetcher as the company enrichment (enrich_companies.Fetcher): robots.txt first, one request per host every 2 s, an honest
user agent, no LinkedIn / Crunchbase / any database / any search page, 401 and 403 are final. A candidate's site, its About / Contact / Company
pages and its careers page are the only pages read.

What `probe` prints, per address: the page's title and its own one-line description, the places on the page that say where the company is
(city names, "Australia", ABN, Pty Ltd, +61, an Acknowledgement of Country) and any founding year or funding sentence the site states about itself.
It decides nothing: a person reads it and says which address is the company.

What `scan` writes (candidates_to_add.json, never the live data): for each candidate its website, where its own pages say it is, one line on why it fits
(in our words, with the page and the words that back it), the flags (too big, too old, not Australian, unclear), the Pass 1 fields (hiring, open roles,
city, state: enrich_companies.py) and the basic Pass 2 fields (remote policy, tech stack, last role seen: pass2_postings.py). Every value has a
source_url and a last_verified_at; what no page of its own says is null.
"""
import argparse
import concurrent.futures as cf
import html as htmllib
import json
import re
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import enrich_companies as base  # noqa: E402  (the Pass 1 reader: Fetcher, parse_page, jsonld_address ...)

CITIES = r'Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|Newcastle|Wollongong|Geelong|Sunshine Coast|Townsville|Cairns|Launceston|Fremantle'
STATES = r'NSW|VIC|QLD|ACT|TAS|SA|WA|NT'
# where a page says the company is: a place, the country, a company number, a legal form, a phone code, the Acknowledgement of Country
AU_RE = re.compile(
    rf'\b(?:Australian?s?|{CITIES})\b|\bABN\s*\d|\bACN\s*\d|\bPty\.?\s+Ltd\b|\+\s?61\b|\bAcknowledg(?:e|ement)s? (?:of )?(?:the )?(?:Traditional|Country)|\bAustralia\b|\b(?:{STATES})\s+\d{{4}}\b'
)
# where a company says it IS (not merely that a place is mentioned): a legal form, a company number, a phone code, a street address with its state
# and postcode, "based in", "headquartered", "our office", the Acknowledgement of Country. A page that only mentions "Australia" or a city
# (a customer story, a sample website, an integration list) is a weak sign and is kept only when nothing stronger is on the site.
STRONG_RE = re.compile(
    rf'\bPty\.?\s+Ltd\b|\bABN\s*\d|\bACN\s*\d|\+\s?61\b|\bAcknowledg(?:e|ement)s? (?:of )?(?:the )?(?:Traditional|Country)|\b(?:based|headquartered|located|HQ|headquarters|head office)\s+(?:is\s+)?(?:in|at)\s+(?:{CITIES}|Australia)\b|\b(?:{STATES})\s+\d{{4}}\b|\b(?:our|head)\s+offices?\b[^.]{{0,60}}\b(?:{CITIES})\b|\b(?:{CITIES}),?\s+(?:{STATES}|Australia)\b|\b(?:{CITIES})[- ]based\b'
)
# "founded in 2019", "established 2013": a company saying so about itself, on its own home / About / Company page (not on a customer story or a sample site)
FOUNDED_RE = re.compile(r'\b(?:founded|established)\s+(?:in\s+)?((?:19|20)\d\d)\b|\bfounded\s+by\s[^.]{0,80}?\bin\s+((?:19|20)\d\d)\b', re.I)
OWN_PAGE = re.compile(r'^/?$|/(?:about|about-us|company|team|our-story|story|who-we-are)(?:/|$)', re.I)
NOT_OWN_VOICE = re.compile(r'/(?:customers?|case-studies|case-study|stories|story/|blog|articles?|templates?|showcase|library|resources?|integrations?|news|press)(?:/|$)', re.I)
FUNDING_RE = re.compile(r'\b(?:raised|raising|secured|closed)\s+(?:an?\s+)?(?:A?US?\$|A\$|\$)\s?\d[\d.,]*\s?(?:[mMbBkK]|million|billion)?|\bSeries\s+[A-F]\b|\b(?:pre-?seed|seed)\s+(?:round|funding)\b', re.I)
SIZE_RE = re.compile(r'\b(\d[\d,]*)\+?\s+(?:employees|team members|people|staff)\b|\bteam of (\d[\d,]*)\b|\b(\d[\d,]*)\+?\s+(?:customers|clients|brands|venues|attractions)\b', re.I)
ABOUT_RE = re.compile(r'\b(?:about|company|who we are|our story|team|contact|locations?|offices?)\b', re.I)
TAG = re.compile(r'<[^>]+>')


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def visible_text(page_html):
    text = re.sub(r'(?is)<(script|style|noscript|svg|template)\b.*?</\1>', ' ', page_html)
    text = re.sub(r'(?s)<!--.*?-->', ' ', text)
    text = TAG.sub(' ', text)
    return ' '.join(htmllib.unescape(text).split())


def meta(page_html, name):
    for tag in re.findall(r'(?is)<meta\b[^>]*>', page_html):
        if re.search(rf'(?:name|property)\s*=\s*["\']{re.escape(name)}["\']', tag, re.I):
            m = re.search(r'content\s*=\s*"([^"]*)"|content\s*=\s*\'([^\']*)\'', tag, re.I)
            if m:
                return ' '.join(htmllib.unescape(m.group(1) or m.group(2) or '').split()) or None
    return None


def title_of(page_html):
    m = re.search(r'(?is)<title[^>]*>(.*?)</title>', page_html)
    return ' '.join(htmllib.unescape(m.group(1)).split()) if m else None


def around(text, m, width=70):
    a, b = max(0, m.start() - width), min(len(text), m.end() + width)
    return ('…' if a else '') + text[a:b].strip() + ('…' if b < len(text) else '')


def snippets(text, regex, limit, key=lambda m: m.group(0).lower()):
    out, seen = [], set()
    for m in regex.finditer(text):
        k = key(m)
        if k in seen:
            continue
        seen.add(k)
        out.append(around(text, m))
        if len(out) >= limit:
            break
    return out


def read_pages(fetcher, site, want_about=True):
    """The home page and the About / Contact / Company pages the home page links to (same site only). -> [(url, html)], refusals."""
    pages, refused = [], []
    try:
        final, got = fetcher.get(site)
    except base.Refused as err:
        return pages, [{'url': err.url, 'code': err.code}]
    pages.append((final, got))
    if not want_about:
        return pages, refused
    page = base.parse_page(got)
    host = urllib.parse.urlsplit(final).hostname
    seen = {urllib.parse.urldefrag(final)[0].rstrip('/')}
    picked = []
    legal = []
    for href, text in page.anchors:
        url = urllib.parse.urldefrag(urllib.parse.urljoin(final, href))[0]  # "/#about" is the page we are on
        u = urllib.parse.urlsplit(url)
        if u.scheme not in ('http', 'https') or not base.same_family(u.hostname or '', host) or url.rstrip('/') in seen:
            continue
        if ABOUT_RE.search(text or '') or re.search(r'/(?:about|about-us|company|contact|contact-us|team|our-story|locations?|offices?)(?:/|$)', u.path, re.I):
            seen.add(url.rstrip('/'))
            picked.append(url)
        elif re.search(r'/(?:terms|terms-of-(?:use|service)|tos|privacy|privacy-policy|legal)(?:/|$)', u.path, re.I):
            seen.add(url.rstrip('/'))
            legal.append(url)  # the legal pages name the company's legal entity and the law it is under
    # a site whose menu is not in its HTML (or has no legal links in it): the usual places, each read only if robots.txt allows it
    origin = f'{urllib.parse.urlsplit(final).scheme}://{urllib.parse.urlsplit(final).netloc}'
    usual = [] if picked else ['/about', '/contact']
    usual += [] if legal else ['/privacy', '/terms']
    for path in usual:
        if origin + path not in seen:
            seen.add(origin + path)
            (legal if path in ('/privacy', '/terms') else picked).append(origin + path)
    for url in (picked[:4] + legal[:2]):
        try:
            f2, h2 = fetcher.get(url)
            pages.append((f2, h2))
        except base.Refused as err:
            if err.code != 'http_error':  # a path that is simply not there is not worth reporting
                refused.append({'url': err.url, 'code': err.code})
    return pages, refused


STRENGTH = [  # how plainly a snippet says where the company IS (the higher, the better evidence)
    (re.compile(r'\b(?:{s})\s+\d{{4}}\b'.format(s=STATES)), 5), (re.compile(r'\b(?:based|headquartered|located|HQ|headquarters)\s+(?:is\s+)?(?:in|at)\b|\bhead\s+office\b', re.I), 5),
    (re.compile(r'\b(?:our|head)\s+offices?\b', re.I), 4), (re.compile(r'\bA[BC]N\s*\d'), 3), (re.compile(r'\+\s?61\b'), 2),
    (re.compile(r'\bAcknowledg'), 2), (re.compile(r'\bPty\.?\s+Ltd\b'), 1),
]


def strength_of(snippet, name):
    score = max((w for rx, w in STRENGTH if rx.search(snippet)), default=0)
    first = re.split(r'[\s.]+', name.strip())[0].lower() if name else ''
    return score + (3 if first and first in snippet.lower() else 0)


def about_itself(text, m, name):
    """A funding or size claim counts only when it is about the company: its name is near it, or it says "we" / "our"."""
    window = text[max(0, m.start() - 220): m.end() + 220]
    first = re.split(r'[\s.]+', name.strip())[0].lower() if name else ''
    return bool(first and first in window.lower()) or bool(re.search(r'\b(?:we|we\'ve|our)\b', window, re.I))


def facts_of(pages, now, name=''):
    """What the pages say about themselves: identity, place, age, funding, size. Each with the page it is on."""
    out = {'title': None, 'description': None, 'site_name': None, 'places': [], 'founded': [], 'funding': [], 'size': [], 'address': None, 'pages_read': [u for u, _ in pages]}
    strong, weak = [], []
    for i, (url, page_html) in enumerate(pages):
        path = urllib.parse.urlsplit(url).path or '/'
        own_voice = not NOT_OWN_VOICE.search(path)   # a customer story or a sample site is not the company talking about itself
        if i == 0:
            out['title'], out['description'], out['site_name'] = title_of(page_html), meta(page_html, 'description') or meta(page_html, 'og:description'), meta(page_html, 'og:site_name')
        text = visible_text(page_html)
        if own_voice:
            for s in snippets(text, STRONG_RE, 4):
                strong.append({'quote': s, 'source_url': url, 'last_verified_at': now, 'strength': 'strong', 'score': strength_of(s, name)})
            for s in snippets(text, AU_RE, 2):
                weak.append({'quote': s, 'source_url': url, 'last_verified_at': now, 'strength': 'weak', 'score': strength_of(s, name)})
            if OWN_PAGE.search(path):
                for m in FOUNDED_RE.finditer(text):
                    out['founded'].append({'year': int(m.group(1) or m.group(2)), 'quote': around(text, m), 'source_url': url, 'last_verified_at': now})
                    break
            for rx, bucket in ((FUNDING_RE, 'funding'), (SIZE_RE, 'size')):
                for m in rx.finditer(text):
                    if about_itself(text, m, name):
                        out[bucket].append({'quote': around(text, m), 'source_url': url, 'last_verified_at': now})
                        if sum(1 for x in out[bucket] if x['source_url'] == url) >= 2:
                            break
        parsed = base.parse_page(page_html)
        if not out['address'] and own_voice:
            place = base.jsonld_address(parsed.ld)
            if place:
                out['address'] = {'city': place[0], 'state': place[1], 'source_url': url, 'last_verified_at': now}
        for node in base.ld_nodes(parsed.ld):
            fd = node.get('foundingDate')
            if fd and re.match(r'\d{4}', str(fd)) and own_voice and not any(f['source_url'] == url and f.get('schema') for f in out['founded']):
                out['founded'].append({'year': int(str(fd)[:4]), 'quote': f'schema.org foundingDate {fd}', 'source_url': url, 'last_verified_at': now, 'schema': True})
    def best(items, limit):  # the plainest statements first, one per distinct sentence
        seen, picked = set(), []
        for item in sorted(items, key=lambda x: -x['score']):
            key = re.sub(r'\W+', '', item['quote'].lower())[:80]
            if key in seen:
                continue
            seen.add(key)
            picked.append(item)
            if len(picked) >= limit:
                break
        return picked

    def once(items, limit):  # a banner repeated on every page is one statement
        seen, picked = set(), []
        for item in items:
            key = re.sub(r'\W+', '', item['quote'].lower())[:60]
            if key not in seen:
                seen.add(key)
                picked.append(item)
        return picked[:limit]

    out['places'] = best(strong, 6) or ([] if out['address'] else best(weak, 3))
    out['funding'], out['size'] = once(out['funding'], 4), once(out['size'], 4)
    return out


def probe(args):
    hosts = json.loads(Path(args.hosts).read_text('utf-8'))   # {"lead name": ["host", ...]}
    fetcher = base.Fetcher()
    now = now_iso()

    def one(item):
        lead, host = item
        site = host if host.startswith('http') else f'https://{host}'
        pages, refused = read_pages(fetcher, site, want_about=False)
        if not pages:
            return lead, host, {'refused': refused}
        facts = facts_of(pages, now, lead)
        facts['final_url'] = pages[0][0]
        return lead, host, facts

    work = [(lead, h) for lead, hs in hosts.items() for h in hs]
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(one, work))
    for lead, host, f in results:
        print(f'\n## {lead}  <-  {host}')
        if 'refused' in f:
            print('   not read:', f['refused'])
            continue
        print('   final:', f['final_url'])
        print('   title:', (f['title'] or '')[:110])
        print('   says :', (f['description'] or '')[:160])
        for p in f['places'][:3]:
            print('   place:', p['quote'][:150])
        for p in f['founded'][:1]:
            print('   born :', p['quote'][:120])
    if args.out:
        Path(args.out).write_text(json.dumps([{'lead': l, 'host': h, **f} for l, h, f in results], indent=1, ensure_ascii=False) + '\n', 'utf-8')


DATA = HERE.parent.parent / 'src' / 'data'


def registrable(host):
    host = (host or '').lower().removeprefix('www.')
    parts = host.split('.')
    return '.'.join(parts[-3:]) if len(parts) >= 3 and '.'.join(parts[-2:]) in ('com.au', 'net.au', 'org.au', 'co.nz', 'co.uk') else '.'.join(parts[-2:])


def live_directory():
    raw = json.loads((DATA / 'startups.json').read_text('utf-8'))
    return raw if isinstance(raw, list) else raw.get('startups', [])


def known_cities_of(companies):
    counts = {}
    for c in companies:
        city = str(c.get('city') or '').strip().lower()
        if city and city != 'unknown':
            counts[city] = counts.get(city, 0) + 1
    return frozenset(city for city, n in counts.items() if n >= 3)


def automatic_flags(facts, refused, pages):
    """Flags a machine can raise from the company's own pages. A person adds the rest (judgements file)."""
    flags = []
    if not pages:
        flags.append({'kind': 'site_not_read', 'basis': f'its own site could not be read: {", ".join(r["code"] for r in refused) or "no answer"}', 'source_url': refused[0]['url'] if refused else None, 'source_kind': 'own_site'})
        return flags
    if not facts['address'] and not any(p.get('strength') == 'strong' for p in facts['places']):
        flags.append({'kind': 'australian_unconfirmed', 'basis': f'none of the {len(pages)} page(s) read says where the company is: no Pty Ltd, ABN, Australian address, phone code or "based in"' + (' (only a passing mention of an Australian place)' if facts['places'] else ''), 'source_url': pages[0][0], 'source_kind': 'own_site'})
    founded = sorted(f['year'] for f in facts['founded'])
    if founded and founded[0] <= 2012:
        f = next(f for f in facts['founded'] if f['year'] == founded[0])
        flags.append({'kind': 'too_old', 'basis': f'its own site gives {founded[0]} ({f["quote"][:90]})', 'source_url': f['source_url'], 'source_kind': 'own_site'})
    for f in facts['funding']:
        if re.search(r'Series\s+[C-F]\b', f['quote']):
            flags.append({'kind': 'too_big', 'basis': f'its own site mentions a later round: {f["quote"][:100]}', 'source_url': f['source_url'], 'source_kind': 'own_site'})
            break
    # (A head count on a page is not a flag by itself: it is as likely a customer's as the company's. The size quotes are kept for a person to read.)
    return flags


def scan(args):
    import pass2_postings as p2  # the basic Pass 2 reader
    inputs = json.loads(Path(args.input).read_text('utf-8'))
    judgements = json.loads(Path(args.judgements).read_text('utf-8')) if args.judgements else {}
    live = live_directory()
    live_domains = {registrable(urllib.parse.urlsplit(c['website']).hostname): c['name'] for c in live if c.get('website')}
    cities = known_cities_of(live)
    fetcher = base.Fetcher()
    now = now_iso()
    today = now[:10]

    def one(c):
        pages, refused = read_pages(fetcher, c['website'])
        facts = facts_of(pages, now, c['name']) if pages else None
        company = {'id': c['id'], 'name': c['name'], 'website': c['website']}
        diag, new = base.observe(company, fetcher, now, today, cities)
        fields = {n: (new.get(n) or dict(base.NULL_FIELD)) for n in base.FIELDS}
        entry = {'id': c['id'], 'name': c['name'], 'fields': fields, 'pass1': diag}
        hiring = fields['hiring']
        roles_backed = hiring['value'] is True and (hiring['confidence'] or 0) >= 0.85
        pass2 = p2.read_company(entry, fetcher) if roles_backed else None
        final = pages[0][0] if pages else None
        j = judgements.get(c['id'], {})
        for bucket in j.get('drop', []):  # evidence a person has judged is not the company talking about itself (a demo on its home page)
            facts[bucket] = []
        flags = automatic_flags(facts, refused, pages) if facts or refused else []
        flags += [dict(f, last_verified_at=f.get('last_verified_at', now)) for f in j.get('flags', [])]
        reason = dict(j['reason']) if j.get('reason') else None
        if reason and reason.get('quote') == '@description' and facts:
            reason.update(quote=(facts['description'] or facts['title'] or '')[:200], source_url=final, source_kind='own_site')
        if reason:
            reason.setdefault('last_verified_at', now)
        hq_basis = j.get('hq_basis')
        if hq_basis in ('@place', '@address') and facts:
            if hq_basis == '@address' and facts['address']:
                a = facts['address']
                hq_basis = {'quote': f'schema.org address on the page: {a["city"]}, {a["state"]}', 'source_url': a['source_url'], 'source_kind': 'own_site', 'last_verified_at': a['last_verified_at']}
            elif facts['places']:
                city = re.split(r'[,(]', j.get('hq') or '')[0].strip().lower()   # the statement that names the city the verdict gives, if one does
                p = next((x for x in facts['places'] if city and city in x['quote'].lower()), facts['places'][0])
                hq_basis = {'quote': p['quote'], 'source_url': p['source_url'], 'source_kind': 'own_site', 'last_verified_at': p['last_verified_at']}
            else:
                hq_basis = None
        elif isinstance(hq_basis, dict):
            hq_basis = dict(hq_basis, last_verified_at=hq_basis.get('last_verified_at', now))
        host = urllib.parse.urlsplit(final or c['website']).hostname
        dup = live_domains.get(registrable(host))
        if dup:
            flags.append({'kind': 'already_in_data_by_website', 'basis': f'the same website is the live entry "{dup}"', 'source_url': final, 'source_kind': 'own_site'})
        return {
            'id': c['id'], 'name': c['name'], 'lead_name': c.get('lead', c['name']),
            'website': {'value': final or c['website'], 'source_url': c['website'], 'last_verified_at': now if pages else None,
                        'listed_address': c['website'], 'redirects_to_another_domain': bool(final and not base.same_family(urllib.parse.urlsplit(c['website']).hostname, urllib.parse.urlsplit(final).hostname))},
            'site_says': {'title': facts['title'], 'description': facts['description'], 'source_url': final, 'last_verified_at': now} if facts else None,
            'australian': {'verdict': j.get('verdict'), 'hq': j.get('hq'), 'hq_basis': hq_basis,
                           'evidence': facts['places'] if facts else [], 'address': facts['address'] if facts else None},
            'age_and_size': {'founded': facts['founded'] if facts else [], 'funding': facts['funding'] if facts else [], 'size': facts['size'] if facts else [],
                             'press': j.get('press', [])},
            'reason_it_fits': reason,
            'flags': flags,
            'notes': j.get('notes'),
            'pass1': {'fields': fields, 'read': {k: diag[k] for k in ('result', 'refusal', 'careers_url', 'careers_found_by', 'boards', 'refused', 'pages_read', 'role_count', 'notes')}},
            'pass2': ({k: pass2[k] for k in ('remote_policy', 'remote_policy_reason', 'tech_stack', 'last_role_seen_at', 'postings_read', 'read', 'refused', 'notes')} if pass2 else
                      {'remote_policy': None, 'tech_stack': None, 'last_role_seen_at': None, 'note': 'no open role was backed by a page of its own, so there is no posting to read'}),
            'pages_read': facts['pages_read'] if facts else [], 'refused': refused,
        }

    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(one, inputs))
    problems = []
    for r in results:
        if r['reason_it_fits'] is None:
            problems.append(f'{r["id"]}: no reason_it_fits')
        else:
            rf = r['reason_it_fits']
            for k in ('text', 'source_url', 'last_verified_at'):
                if not rf.get(k):
                    problems.append(f'{r["id"]}: reason_it_fits lacks {k}')
            if not rf.get('quote') and not (rf.get('summary') and rf.get('source_kind') == 'press'):
                problems.append(f'{r["id"]}: reason_it_fits has neither a quote from its own site nor a press summary')
        if r['australian']['verdict'] is None:
            problems.append(f'{r["id"]}: no Australian verdict')
        if r['australian']['verdict'] in ('confirmed_by_own_site', 'indicated_by_own_site', 'press_only') and not r['australian']['hq_basis']:
            problems.append(f'{r["id"]}: an Australian verdict with no basis')
        for f in r['flags']:
            if not f.get('basis'):
                problems.append(f'{r["id"]}: flag {f.get("kind")} has no basis')
    lead_table = json.loads(Path(args.lead_table).read_text('utf-8'))['rows'] if args.lead_table else None
    out = {
        '_readme': 'Companies that look like they belong in the directory but are not in it. NOT the live data: nothing here has been added, and nothing is added until a person approves it. '
                   'Every value has the page it came from (source_url) and when it was read (last_verified_at); null means no page of the company\'s own said. Only the company\'s own site, '
                   'About / Contact / Company pages and careers page (and the job board its careers page points at) were read: no LinkedIn, no Crunchbase, no database, no search page. '
                   'The lead list supplied only the names. See candidate_scan.py, enrich_companies.py (Pass 1) and pass2_postings.py (basic Pass 2).',
        'verdicts': '"confirmed_by_own_site": the company\'s own pages state an Australian legal entity, address or base. "indicated_by_own_site": its own pages point to Australia (its own description, a .com.au address) but give no entity, address or city. "press_only": its own pages could not say (a page the reader cannot see, or no place on it), and a press page does: marked source_kind "press". "not_australian": the evidence points elsewhere. "unclear": nothing readable either way.',
        'flags': '"too_old": founded in 2012 or earlier. "too_big": a reported valuation of US$500M or more, or 300 or more staff, or US$50M or more a year in revenue. "not_australian": it does not look Australian. "australian_unconfirmed": its own pages do not say where it is. "unclear_fit": what it is, or whether it is a startup like the others, could not be established. "site_not_read": its own site would not let this reader in (robots.txt, 403) or did not answer. A flag has a basis and the page it comes from; source_kind says whether that page is the company\'s own or press (a news page seen through a search result, not read in full).',
        'generated_at': now, 'scripts': ['backend/scripts/enrich/candidate_scan.py', 'backend/scripts/enrich/enrich_companies.py', 'backend/scripts/enrich/pass2_postings.py'], 'user_agent': base.UA,
        'requests': fetcher.requests, 'lead_table': lead_table, 'candidates': results, 'problems': problems,
    }
    Path(args.out).write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n', 'utf-8')
    for r in results:
        f1 = r['pass1']['fields']
        print(f"{r['name'][:20]:<21} site={'ok' if r['pages_read'] else 'NO':<3} pages={len(r['pages_read'])} AU-evidence={len(r['australian']['evidence'])} hiring={f1['hiring']['value']} roles={r['pass1']['read']['role_count']} state={(f1['state'] or {}).get('value')} city={(f1['city'] or {}).get('value') or (f1['suburb'] or {}).get('value')} flags={[x['kind'] for x in r['flags']]}")
    print(f"\n{len(results)} candidates, {fetcher.requests} requests -> {args.out}")
    if problems:
        print('PROBLEMS:', problems)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('probe')
    p.add_argument('--hosts', required=True)
    p.add_argument('--out')
    p.add_argument('--workers', type=int, default=8)
    s = sub.add_parser('scan')
    s.add_argument('--input', required=True)
    s.add_argument('--judgements')
    s.add_argument('--lead-table', help='the JSON that lead_match.mjs --json wrote: the lead list against the directory')
    s.add_argument('--out', required=True)
    s.add_argument('--workers', type=int, default=6)
    args = ap.parse_args()
    {'probe': probe, 'scan': scan}[args.cmd](args)


if __name__ == '__main__':
    main()
