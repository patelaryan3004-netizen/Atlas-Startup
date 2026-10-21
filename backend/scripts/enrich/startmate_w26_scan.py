#!/usr/bin/env python3
"""Reads the OWN websites of the Startmate Winter 2026 companies and writes what they say, with the page it is on.  (Python 3.12, standard library only)

    python backend/scripts/enrich/startmate_w26_scan.py scan --input startmate_w26_input.json --out startmate_w26_scan.json

It reads with the same fetcher as the company enrichment (enrich_companies.Fetcher): robots.txt first, one request per host every 2 s, an honest user
agent, no LinkedIn / Crunchbase / any database / any search page, 401 and 403 are final. Only the company's home page and the About / Contact / Team / legal
pages it links to are read. It decides nothing: a person reads the output (and startmate_w26_judgements.json is where that person's decisions live).

For each company it writes: the address it was asked for, the address it ended at after redirects (and whether the site changed), the pages read, the pages
that refused (robots.txt, 403), the page's own title and description, the places the pages name (cities, countries, legal entities, company numbers, phone
codes) each with its sentence, whether each Startmate founder's name is on the company's own pages, any mention of Startmate, and the icons the site declares.
What no page says is null or an empty list.
"""
import argparse
import concurrent.futures as cf
import html as htmllib
import json
import re
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import enrich_companies as base  # noqa: E402
import candidate_scan as cs  # noqa: E402  (its page reader and text helpers)

# where a page may say a company is: not only the Australian cities the other scanner knows
PLACES = r'Sydney|Melbourne|Brisbane|Adelaide|Perth|Canberra|Hobart|Darwin|Gold Coast|Wellington|Christchurch|Auckland|San Francisco|New York|London|Singapore|Mumbai|Bengaluru|Bangalore|Pune|Delhi|Hyderabad|Chennai|India|Australia|Australian|New Zealand|Aotearoa|United States|USA|California|Assam'
PLACE_RE = re.compile(rf'\b(?:{PLACES})\b')
ENTITY_RE = re.compile(r"\b([A-Z][\w&.'’\-]*(?:\s+[A-Z][\w&.'’\-]*){0,4}\s+(?:Pty\.?\s+Ltd\.?|Pty\s+Limited|Limited|Ltd\.?|Inc\.?|LLC|Private\s+Limited|Pvt\.?\s+Ltd\.?|Limited\s+Partnership))")
NUMBER_RE = re.compile(r'\b(?:ABN|ACN|NZBN|NZ\s*Company\s*(?:Number|No\.?)|CIN|EIN)\s*:?\s*([\d ]{8,20})')
PHONE_RE = re.compile(r'\+\s?(?:61|64|91|1)[\s\d()-]{8,16}')
STARTMATE_RE = re.compile(r'[^.]{0,120}\bStartmate\b[^.]{0,120}', re.I)
TAG = re.compile(r'<[^>]+>')


def sentence_around(text, m, width=130):
    return ' '.join(text[max(0, m.start() - width): m.end() + width].split())


def icons_of(page_html, base_url):
    found = {'icons': [], 'og_image': None, 'ld_logo': None}
    for tag in re.findall(r'(?is)<link\b[^>]*>', page_html):
        rel = re.search(r'rel\s*=\s*["\']([^"\']*)["\']', tag, re.I)
        href = re.search(r'href\s*=\s*["\']([^"\']*)["\']', tag, re.I)
        if rel and href and re.search(r'\bicon\b|apple-touch-icon', rel.group(1), re.I):
            found['icons'].append({'rel': rel.group(1), 'href': urllib.parse.urljoin(base_url, htmllib.unescape(href.group(1)))})
    found['og_image'] = cs.meta(page_html, 'og:image')
    if found['og_image']:
        found['og_image'] = urllib.parse.urljoin(base_url, found['og_image'])
    for node in base.ld_nodes(base.parse_page(page_html).ld):
        logo = node.get('logo')
        logo = logo.get('url') if isinstance(logo, dict) else logo
        if isinstance(logo, str) and not found['ld_logo']:
            found['ld_logo'] = urllib.parse.urljoin(base_url, logo)
    return found


def registrable(url):
    host = (urllib.parse.urlsplit(url).hostname or '').lower()
    return re.sub(r'^www\.', '', host)


def scan_one(fetcher, item, now):
    wanted = item['website']
    site = wanted if wanted.startswith('http') else f'https://{wanted}'
    site = re.sub(r'^http://', 'https://', site)   # a browser upgrades it; so does every site that has a certificate
    out = {'id': item['id'], 'name': item['name'], 'website_asked': wanted, 'read': False}
    pages, refused = cs.read_pages(fetcher, site, want_about=True)
    out['refused'] = refused
    if not pages:
        out['note'] = 'nothing could be read (see refused)'
        return out
    final = pages[0][0]
    out.update({'read': True, 'final_url': final, 'pages_read': [u for u, _ in pages],
                'redirected': urllib.parse.urldefrag(final)[0].rstrip('/') != urllib.parse.urldefrag(site)[0].rstrip('/'),
                'site_changed': registrable(final) != registrable(site)})
    first_html = pages[0][1]
    out['title'], out['description'], out['site_name'] = cs.title_of(first_html), cs.meta(first_html, 'description') or cs.meta(first_html, 'og:description'), cs.meta(first_html, 'og:site_name')
    out.update(icons_of(first_html, final))
    places, entities, numbers, phones, startmate = [], [], [], [], []
    founders_seen = {f: [] for f in item.get('founders', [])}
    for url, page_html in pages:
        text = cs.visible_text(page_html)
        low = text.lower()
        for m in PLACE_RE.finditer(text):
            s = sentence_around(text, m)
            if not any(p['quote'][:50] == s[:50] for p in places):
                places.append({'place': m.group(0), 'quote': s, 'source_url': url})
        for m in ENTITY_RE.finditer(text):
            entities.append({'entity': m.group(1), 'source_url': url})
        for m in NUMBER_RE.finditer(text):
            numbers.append({'kind': re.match(r'[A-Za-z ]+', m.group(0)).group(0).strip(), 'number': ' '.join(m.group(1).split()), 'source_url': url})
        for m in PHONE_RE.finditer(text):
            phones.append({'phone': ' '.join(m.group(0).split()), 'source_url': url})
        for m in STARTMATE_RE.finditer(text):
            startmate.append({'quote': ' '.join(m.group(0).split()), 'source_url': url})
        for name in founders_seen:
            tokens = [t for t in re.split(r'\s+', name.lower()) if t]
            if name.lower() in low or (len(tokens) >= 2 and tokens[0] in low and tokens[-1] in low and re.search(rf'{re.escape(tokens[0])}[^.]{{0,30}}{re.escape(tokens[-1])}', low)):
                founders_seen[name].append(url)
    uniq = lambda items, key: list({i[key] + i['source_url']: i for i in items}.values())
    out['places'] = places[:14]
    out['entities'] = uniq(entities, 'entity')[:8]
    out['company_numbers'] = uniq(numbers, 'number')[:6]
    out['phones'] = uniq(phones, 'phone')[:4]
    out['startmate_mentions'] = startmate[:3]
    out['founders_on_own_pages'] = {k: sorted(set(v)) for k, v in founders_seen.items()}
    out['last_verified_at'] = now
    return out


def scan(args):
    items = json.loads(Path(args.input).read_text('utf-8'))
    fetcher = base.Fetcher()
    now = cs.now_iso()
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda it: scan_one(fetcher, it, now), items))
    for r in results:
        print(f"\n## {r['name']}  <-  {r['website_asked']}")
        if not r['read']:
            print('   NOT READ:', r['refused'] or r.get('note'))
            continue
        print(f"   final: {r['final_url']}{'  (REDIRECTED)' if r['redirected'] else ''}{'  (SITE CHANGED)' if r['site_changed'] else ''}  pages: {len(r['pages_read'])}  refused: {[x['code'] for x in r['refused']]}")
        print('   title:', (r['title'] or '')[:110])
        print('   says :', (r['description'] or '')[:170])
        for p in r['places'][:4]:
            print(f"   place[{p['place']}]:", p['quote'][:150])
        for e in r['entities'][:3]:
            print('   entity:', e['entity'])
        for n in r['company_numbers'][:2]:
            print('   number:', n['kind'], n['number'])
        for f, urls in r['founders_on_own_pages'].items():
            print(f"   founder {f}: {'ON OWN PAGES ' + urls[0] if urls else 'not on own pages read'}")
        for s in r['startmate_mentions'][:1]:
            print('   startmate:', s['quote'][:140])
        print('   icons:', [i['href'] for i in r['icons']][:2], '| og:', r['og_image'])
    Path(args.out).write_text(json.dumps({'generated_at': now, 'results': results}, indent=1, ensure_ascii=False) + '\n', 'utf-8')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('scan')
    s.add_argument('--input', required=True)
    s.add_argument('--out', required=True)
    s.add_argument('--workers', type=int, default=6)
    args = p.parse_args()
    {'scan': scan}[args.cmd](args)
