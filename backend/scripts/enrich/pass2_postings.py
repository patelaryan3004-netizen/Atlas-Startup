#!/usr/bin/env python3
"""Pass 2 (small): what the postings themselves state, for the companies with verified roles.  Python 3.12, standard library only.

    python backend/scripts/enrich/pass2_postings.py                 # the 24 companies with verified roles -> pass2_findings.json
    python backend/scripts/enrich/pass2_postings.py --only canva,zeller
    python backend/scripts/enrich/pass2_postings.py --selftest

For each company whose open roles a page backs (companies_enriched.json: hiring true at 0.85 or more) it reads the SAME job feed or the
SAME careers page Pass 1 read, this time with the postings' text, and records only what a posting says:

  remote_policy   onsite | hybrid | remote-au | remote-global, from a posting's own workplace field (Lever workplaceType, Ashby workplaceType,
                  Teamtailor remoteStatus, schema.org jobLocationType, BambooHR locationType) or its location, or, failing both, an explicit
                  sentence ("fully remote", "work from anywhere", "remote within Australia", "this is an on-site role", "hybrid working").
                  A company gets a policy only when EVERY posting that states one states the same: a mix is left null and shown as a mix.
                  "Remote" with no place, or remote in another country, is counted and shown but is not a policy of any of the four kinds.
  tech_stack      named technologies (a fixed list of engineering, data and infrastructure tools) that appear in a posting's text; a name that
                  is also a common word (Go, Swift, Rust, Spark, Dart) counts only beside another technology in a list.
  last_role_seen  the newest posting date a posting gives (Lever createdAt, Ashby publishedAt, Greenhouse first_published, Workable
                  published_on, Teamtailor pubDate, Breezy published_date, schema.org datePosted). A feed that gives only a modified
                  date (Greenhouse updated_at) gives none.

Nothing is inferred from a company's name, industry or location. Every value carries the posting it came from (source_url), when it was read
(last_verified_at) and the words that showed it (basis). The posting's text is not stored: only the names found and a short quote.
Nothing here writes to the directory; the findings are for a person to read first (pass2_findings.json).

It reads what Pass 1 may read, the same way: robots.txt, one request per host every 2 s, an honest user agent, no LinkedIn or databases.
"""
import argparse
import concurrent.futures as cf
import html
import json
import re
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import enrich_companies as base  # noqa: E402  (the fetcher, robots rules, feed readers and page parser of Pass 1)

ENRICHED = HERE / 'companies_enriched.json'
OUT = HERE / 'pass2_findings.json'
POLICIES = ('remote-global', 'remote-au', 'hybrid', 'onsite')
QUOTE_MAX = 140


# ---------------------------------------------------------------------------------------------- text
class _Text(base.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []

    def handle_starttag(self, tag, attrs):
        if tag in ('br', 'p', 'li', 'div', 'h1', 'h2', 'h3', 'h4', 'tr'):
            self.out.append('\n')

    def handle_data(self, data):
        self.out.append(data)


def plain(value):
    """HTML (possibly entity-escaped twice, as Greenhouse sends it) -> plain text with line breaks kept."""
    if not isinstance(value, str) or not value.strip():
        return ''
    text = value
    for _ in range(2):  # &lt;p&gt; -> <p>
        if '&lt;' in text or '&amp;lt;' in text:
            text = html.unescape(text)
    parser = _Text()
    try:
        parser.feed(text)
        parser.close()
    except Exception:
        return re.sub(r'<[^>]+>', ' ', text)
    return re.sub(r'[ \t\r\f\v]+', ' ', ''.join(parser.out)).replace(' ', ' ').strip()


def quote_around(text, match, width=QUOTE_MAX):
    start = max(0, match.start() - (width - (match.end() - match.start())) // 2)
    snippet = ' '.join(text[start:start + width].split())
    return ('…' if start > 0 else '') + snippet + ('…' if start + width < len(text) else '')


# ---------------------------------------------------------------------------------------------- where a posting says how people work
AU_WORDS = re.compile(r'\b(?:Australia|Australian|AU|AUS|ANZ|NSW|VIC|QLD|ACT|Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|Newcastle)\b')
GLOBAL_WORDS = re.compile(r'\b(?:anywhere|worldwide|world-?wide|global(?:ly)?|any\s+location|any\s+country)\b', re.I)
OTHER_PLACES = re.compile(
    r'\b(?:United States|USA|US|U\.S\.|America|Canada|United Kingdom|UK|England|London|Europe|EMEA|EU|APAC|Asia|India|Philippines|PH|Singapore|Japan|China|'
    r'New Zealand|NZ|Ireland|Germany|France|Spain|Netherlands|Brazil|Mexico|Portugal|Poland|Vietnam|Indonesia|Malaysia|Hong Kong|Taiwan|'
    r'San Francisco|New York|Austin|Boston|Seattle|Toronto|Vancouver|Auckland|Manila|Cebu|Bangalore|Remote\s*-\s*[A-Z]{2}\b)', re.I)

# Sentences that state a policy. Each is narrow on purpose: "remote" and "hybrid" are everyday words in a posting ("remote monitoring",
# "hybrid cloud", "visit customers on-site"), so only the phrasings below, and a posting's own fields, count.
TEXT_RULES = [
    ('hybrid', re.compile(
        r'\bhybrid\s+(?:work(?:ing)?|role|model|environment|arrangement|set-?up|schedule|policy|position|basis|approach|working\s+model|team)\b'
        r'|\b(?:this|a|our)\s+(?:is\s+a\s+)?hybrid\b|\bwork(?:ing)?\s+hybrid\b|\bhybrid\s*(?:\(|-|–|—|:)\s*(?:\d|in\b|office|sydney|melbourne|brisbane|perth)'
        r'|\b\d\s+days?\s+(?:a|per|each)\s+week\s+(?:in|from)\s+(?:the|our)\s+(?:\w+\s+)?office\b', re.I)),
    ('remote-global', re.compile(
        r'\bwork\s+from\s+anywhere\b|\bwork\s+anywhere\b|\bwork\s+remotely\s+from\s+anywhere\b|\banywhere\s+in\s+the\s+world\b'
        r'|\b(?:fully|100%|completely)\s+remote\b(?!\s+(?:within|across|in|from)\s+(?:Australia|AU|ANZ))', re.I)),
    ('remote-au', re.compile(
        r'\bremote(?:ly)?\s*(?:\(|-|–|—|:|,|/)?\s*(?:within|across|in|from|anywhere\s+in)?\s*(?:Australia|AU|AUS|ANZ)\b'
        r'|\banywhere\s+(?:within|in|across)\s+Australia\b'
        r'|\b(?:Australia|AU|ANZ)\s*(?:\(|-|–|—)\s*remote\b|\bAustralia[- ]based\s+remote\b|\bremote\s+(?:role|position)\s+(?:within|in|across)\s+Australia\b'
        r'|\bwork(?:ing)?\s+remotely\s+(?:from|within|anywhere\s+in)\s+Australia\b|\bAustralia\s+only\b|\bAustralian\s+residents\s+only\b', re.I)),
    ('onsite', re.compile(
        r'\b(?:this\s+is\s+an?\s+)?(?:on-?site|in-?office|office-?based)\s+(?:role|position|job)\b|\bfull[- ]time\s+in\s+(?:the|our)\s+(?:\w+\s+)?office\b'
        r'|\b(?:five|5)\s+days\s+(?:a|per|each)\s+week\s+(?:in|at|from)\s+(?:the|our)\s+(?:\w+\s+)?office\b|\bnot\s+a\s+remote\s+(?:role|position)\b|\bno\s+remote\s+work\b', re.I)),
]

STRUCTURED_WORKPLACE = {
    'hybrid': 'hybrid', '2': 'hybrid',
    'onsite': 'onsite', 'on-site': 'onsite', 'on_site': 'onsite', 'office': 'onsite', 'in-office': 'onsite', '0': 'onsite',
    'remote': 'remote', 'fully': 'remote', 'fully-remote': 'remote', 'telecommute': 'remote', '1': 'remote',
}


def remote_kind(place, text):
    """A posting that says it is remote: where? -> remote-au | remote-global | remote-other | remote-unspecified."""
    place = place or ''
    if AU_WORDS.search(place):
        return 'remote-au'
    if GLOBAL_WORDS.search(place):
        return 'remote-global'
    if OTHER_PLACES.search(place):
        return 'remote-other'
    for kind, rx in TEXT_RULES:
        if kind in ('remote-au', 'remote-global') and rx.search(text or ''):
            return kind
    return 'remote-unspecified'


def classify(p):
    """What one posting says about how people work -> (label, basis, quote) or None.
    label: onsite | hybrid | remote-au | remote-global | remote-other | remote-unspecified | mixed (it says two things)."""
    where = p.get('workplace')
    place = p.get('location') or ''
    text = p.get('text') or ''
    key = str(where).strip().lower().replace(' ', '-') if where is not None else ''
    stated = STRUCTURED_WORKPLACE.get(key)
    if stated == 'remote':
        return remote_kind(place, text), f"{p['provider']} workplace field: {where}", None
    if stated:
        return stated, f"{p['provider']} workplace field: {where}", None
    # the location line of the posting
    m = re.search(r'\bhybrid\b', place, re.I)
    if m:
        return 'hybrid', f'location line: "{place[:80]}"', None
    if re.search(r'\b(?:on-?site|in[- ]office)\b', place, re.I):
        return 'onsite', f'location line: "{place[:80]}"', None
    if re.search(r'\bremote\b', place, re.I):
        return remote_kind(place, text), f'location line: "{place[:80]}"', None
    if p.get('remote_flag') is True:
        return remote_kind(place, text), f"{p['provider']} remote flag", None
    # an explicit sentence in the text
    hits = []
    for label, rx in TEXT_RULES:
        m = rx.search(text)
        if m:
            hits.append((label, m))
    if not hits:
        return None
    if len({label for label, _ in hits}) > 1:
        return 'mixed', 'the text states more than one', quote_around(text, hits[0][1])
    label, m = hits[0]
    return label, 'sentence in the posting', quote_around(text, m)


# ---------------------------------------------------------------------------------------------- technologies
# (canonical name, [spellings], flags). cs = case-sensitive (the default), ci = case-insensitive (a name nothing else is called),
# amb = also a common word: counts only beside another technology in a list.
TECH = [
    ('Python', ['Python'], 'ci'), ('TypeScript', ['TypeScript', 'Typescript'], 'ci'), ('JavaScript', ['JavaScript', 'Javascript'], 'ci'),
    ('Java', ['Java'], 'cs'), ('Kotlin', ['Kotlin'], 'ci'), ('Swift', ['Swift'], 'amb'), ('Objective-C', ['Objective-C'], 'cs'),
    ('Scala', ['Scala'], 'cs'), ('Ruby', ['Ruby'], 'cs'), ('Ruby on Rails', ['Ruby on Rails', 'Rails'], 'cs'), ('PHP', ['PHP'], 'cs'),
    ('Go', ['Golang', 'Go'], 'amb'), ('Rust', ['Rust'], 'amb'), ('Elixir', ['Elixir'], 'cs'), ('Erlang', ['Erlang'], 'cs'),
    ('Clojure', ['Clojure'], 'cs'), ('Haskell', ['Haskell'], 'cs'), ('Dart', ['Dart'], 'amb'), ('C#', ['C#'], 'cs'), ('C++', ['C++'], 'cs'),
    ('.NET', ['.NET', 'ASP.NET', 'dotnet'], 'cs'), ('SQL', ['SQL'], 'cs'), ('Bash', ['Bash'], 'cs'),
    ('React', ['React', 'ReactJS', 'React.js'], 'cs'), ('React Native', ['React Native'], 'cs'), ('Next.js', ['Next.js', 'NextJS'], 'cs'),
    ('Vue', ['Vue', 'Vue.js', 'VueJS'], 'cs'), ('Angular', ['Angular', 'AngularJS'], 'cs'), ('Svelte', ['Svelte', 'SvelteKit'], 'cs'),
    ('Node.js', ['Node.js', 'NodeJS', 'Node JS'], 'cs'), ('Express', ['Express.js', 'ExpressJS'], 'cs'), ('NestJS', ['NestJS', 'Nest.js'], 'cs'),
    ('Django', ['Django'], 'cs'), ('Flask', ['Flask'], 'cs'), ('FastAPI', ['FastAPI'], 'cs'), ('Laravel', ['Laravel'], 'ci'),
    ('Spring Boot', ['Spring Boot'], 'cs'), ('Flutter', ['Flutter'], 'cs'), ('Tailwind CSS', ['Tailwind CSS', 'Tailwind'], 'cs'),
    ('GraphQL', ['GraphQL'], 'ci'), ('gRPC', ['gRPC'], 'cs'), ('Redux', ['Redux'], 'cs'), ('Jest', ['Jest'], 'cs'), ('Cypress', ['Cypress'], 'cs'),
    ('Playwright', ['Playwright'], 'cs'), ('Selenium', ['Selenium'], 'cs'),
    ('PostgreSQL', ['PostgreSQL', 'Postgres'], 'ci'), ('MySQL', ['MySQL'], 'ci'), ('MongoDB', ['MongoDB', 'Mongo DB'], 'ci'), ('Redis', ['Redis'], 'cs'),
    ('Elasticsearch', ['Elasticsearch', 'ElasticSearch'], 'ci'), ('DynamoDB', ['DynamoDB'], 'ci'), ('SQLite', ['SQLite'], 'ci'),
    ('Snowflake', ['Snowflake'], 'cs'), ('BigQuery', ['BigQuery'], 'ci'), ('Redshift', ['Redshift'], 'cs'), ('dbt', ['dbt'], 'cs'),
    ('Airflow', ['Airflow'], 'cs'), ('Kafka', ['Kafka'], 'cs'), ('Spark', ['Apache Spark', 'PySpark', 'Spark'], 'amb'), ('Databricks', ['Databricks'], 'cs'),
    ('Looker', ['Looker'], 'cs'), ('Tableau', ['Tableau'], 'cs'), ('Power BI', ['Power BI', 'PowerBI'], 'cs'), ('Metabase', ['Metabase'], 'cs'),
    ('AWS', ['AWS', 'Amazon Web Services'], 'cs'), ('Google Cloud', ['GCP', 'Google Cloud', 'Google Cloud Platform'], 'cs'), ('Azure', ['Azure'], 'cs'),
    ('Kubernetes', ['Kubernetes', 'K8s'], 'ci'), ('Docker', ['Docker'], 'ci'), ('Terraform', ['Terraform'], 'ci'), ('Ansible', ['Ansible'], 'cs'),
    ('Jenkins', ['Jenkins'], 'cs'), ('GitHub Actions', ['GitHub Actions'], 'cs'), ('CircleCI', ['CircleCI'], 'cs'), ('Buildkite', ['Buildkite'], 'cs'),
    ('Datadog', ['Datadog'], 'cs'), ('Grafana', ['Grafana'], 'cs'), ('Prometheus', ['Prometheus'], 'cs'), ('Sentry', ['Sentry'], 'cs'),
    ('Cloudflare', ['Cloudflare'], 'cs'), ('Linux', ['Linux'], 'cs'), ('Git', ['Git'], 'cs'), ('Nginx', ['Nginx', 'NGINX'], 'cs'),
    ('PyTorch', ['PyTorch'], 'ci'), ('TensorFlow', ['TensorFlow'], 'ci'), ('scikit-learn', ['scikit-learn', 'sklearn'], 'ci'), ('Hugging Face', ['Hugging Face', 'HuggingFace'], 'cs'),
    ('LangChain', ['LangChain'], 'cs'), ('OpenAI', ['OpenAI API', 'OpenAI'], 'cs'), ('Pandas', ['Pandas'], 'cs'), ('NumPy', ['NumPy'], 'cs'),
    ('Kotlin Multiplatform', ['Kotlin Multiplatform'], 'cs'), ('SwiftUI', ['SwiftUI'], 'cs'), ('Jetpack Compose', ['Jetpack Compose'], 'cs'),
    ('Firebase', ['Firebase'], 'cs'), ('Supabase', ['Supabase'], 'cs'), ('Heroku', ['Heroku'], 'cs'), ('Vercel', ['Vercel'], 'cs'),
    ('RabbitMQ', ['RabbitMQ'], 'cs'), ('Webpack', ['Webpack'], 'cs'), ('Vite', ['Vite'], 'cs'), ('Storybook', ['Storybook'], 'cs'),
    ('Sidekiq', ['Sidekiq'], 'cs'), ('OpenTelemetry', ['OpenTelemetry'], 'cs'), ('Temporal', ['Temporal.io'], 'cs'),
]


def _compile(spellings, flag):
    body = '|'.join(re.escape(s) for s in sorted(spellings, key=len, reverse=True))
    return re.compile(r'(?<![A-Za-z0-9_])(?:' + body + r')(?![A-Za-z0-9_+#])', re.I if flag == 'ci' else 0)


_TECH_RX = [(name, _compile(spellings, flag), flag) for name, spellings, flag in TECH]
LIST_GAP = re.compile(r'^[\s,;/&|•·\-–—()]*(?:and|or|plus|with)?[\s,;/&|•·\-–—()]*$')


def find_tech(text):
    """The named technologies a posting's text mentions -> sorted list of canonical names. A name that is also a common word (Go, Swift, Rust,
    Spark, Dart) counts only when it stands in a list with another technology (within a few characters of one, separated by punctuation)."""
    if not text:
        return []
    firm, ambiguous = {}, []
    for name, rx, flag in _TECH_RX:
        for m in rx.finditer(text):
            if flag == 'amb':
                ambiguous.append((name, m))
            else:
                firm.setdefault(name, []).append((m.start(), m.end()))
    spans = [s for found in firm.values() for s in found]
    for name, m in ambiguous:
        if m.group(0) in ('Golang', 'Apache Spark', 'PySpark'):
            firm.setdefault(name, []).append((m.start(), m.end()))
            continue
        if not re.fullmatch(r'[A-Z][A-Za-z]*', m.group(0)):
            continue  # "go", "rust", "spark" in lower case is the word
        for s, e in spans:
            gap = text[e:m.start()] if e <= m.start() else text[m.end():s] if m.end() <= s else None
            if gap is not None and len(gap) <= 6 and LIST_GAP.match(gap):
                firm.setdefault(name, []).append((m.start(), m.end()))
                break
    return sorted(firm)


# ---------------------------------------------------------------------------------------------- postings from each source
def _p(provider, url, title, location, posted, workplace, remote_flag, text):
    return {'provider': provider, 'url': url, 'title': base.text_of(title, 160), 'location': base.text_of(location, 160), 'posted_at': base.day(posted),
            'workplace': workplace, 'remote_flag': remote_flag, 'text': text}


def parse_greenhouse(j, token):
    return [_p('greenhouse', base.http_url(x.get('absolute_url')), x.get('title'), (x.get('location') or {}).get('name'), x.get('first_published'), None, None,
               ' '.join([x.get('title') or '', plain(x.get('content'))])) for x in j.get('jobs', [])]


def parse_lever(j, token):
    out = []
    for x in (j if isinstance(j, list) else []):
        lists = ' '.join(plain(item.get('content')) for item in (x.get('lists') or []) if isinstance(item, dict))
        posted = datetime.fromtimestamp(x['createdAt'] / 1000, timezone.utc).date().isoformat() if isinstance(x.get('createdAt'), (int, float)) else None
        text = ' '.join([x.get('text') or '', x.get('descriptionPlain') or plain(x.get('description')), lists, x.get('additionalPlain') or plain(x.get('additional'))])
        out.append(_p('lever', base.http_url(x.get('hostedUrl')), x.get('text'), (x.get('categories') or {}).get('location'), posted,
                      x.get('workplaceType') if x.get('workplaceType') not in (None, 'unspecified') else None, None, text))
    return out


def parse_ashby(j, token):
    return [_p('ashby', base.http_url(x.get('jobUrl')), x.get('title'), x.get('location'), x.get('publishedAt'), x.get('workplaceType'),
               True if x.get('isRemote') is True else None, ' '.join([x.get('title') or '', x.get('descriptionPlain') or plain(x.get('descriptionHtml'))]))
            for x in j.get('jobs', []) if x.get('isListed') is not False]


def parse_workable(j, token):
    return [_p('workable', base.http_url(x.get('url')) or base.http_url(x.get('shortlink')), x.get('title'),
               ', '.join(p for p in (x.get('city'), x.get('state'), x.get('country')) if p), x.get('published_on') or x.get('created_at'),
               x.get('workplace') or x.get('workplace_type'), True if x.get('telecommuting') is True else None,
               ' '.join([x.get('title') or '', plain(x.get('description')), plain(x.get('requirements')), plain(x.get('benefits'))])) for x in j.get('jobs', [])]


def parse_breezy(j, token):
    out = []
    for x in (j if isinstance(j, list) else []):
        loc = x.get('location') or {}
        out.append(_p('breezy', base.http_url(x.get('url')), x.get('name'), loc.get('name'), x.get('published_date'), None,
                      True if loc.get('is_remote') is True else None, ' '.join([x.get('name') or '', plain(x.get('description'))])))
    return out


def parse_teamtailor(xml_text, token):
    if '<!DOCTYPE' in xml_text or '<!ENTITY' in xml_text:
        raise ValueError('xml with a DTD is not read')
    ns = {'tt': 'https://teamtailor.com/locations'}
    out = []
    for item in base.ET.fromstring(xml_text).iter('item'):
        loc = item.find('tt:locations/tt:location', ns)
        place = ', '.join(p for p in ((loc.findtext('tt:city', namespaces=ns), loc.findtext('tt:country', namespaces=ns)) if loc is not None else ()) if p) or None
        try:
            posted = base.parsedate_to_datetime(item.findtext('pubDate') or '').date().isoformat()
        except (TypeError, ValueError):
            posted = None
        status = (item.findtext('remoteStatus') or '').strip().lower()
        out.append(_p('teamtailor', base.http_url(item.findtext('link')), item.findtext('title'), place, posted,
                      {'fully': 'remote', 'hybrid': 'hybrid'}.get(status), None,  # "none" is Teamtailor's default for a job nobody set: it states nothing
                      ' '.join([item.findtext('title') or '', plain(item.findtext('description'))])))
    return out


def parse_bamboohr_detail(j, token, job_id, title):
    op = (j.get('result') or {}).get('jobOpening') or {}
    loc = op.get('location') or {}
    place = ', '.join(p for p in (loc.get('city'), loc.get('state')) if p)
    return _p('bamboohr', f'https://{token}.bamboohr.com/careers/{job_id}', op.get('jobOpeningName') or title, place, op.get('datePosted'),
              {'0': 'onsite', '1': 'remote', '2': 'hybrid'}.get(str(op.get('locationType'))), None, ' '.join([op.get('jobOpeningName') or title or '', plain(op.get('description'))]))


RICH_FEEDS = {
    'greenhouse': (lambda t: f'https://boards-api.greenhouse.io/v1/boards/{t}/jobs?content=true', parse_greenhouse),
    'lever': (lambda t: f'https://api.lever.co/v0/postings/{t}?mode=json', parse_lever),
    'ashby': (lambda t: f'https://api.ashbyhq.com/posting-api/job-board/{t}', parse_ashby),
    'workable': (lambda t: f'https://apply.workable.com/api/v1/widget/accounts/{t}?details=true', parse_workable),
    'breezy': (lambda t: f'https://{t}.breezy.hr/json', parse_breezy),
    'teamtailor': (lambda t: f'https://{t}.teamtailor.com/jobs.rss', parse_teamtailor),
}


def read_board(fetcher, provider, token, notes):
    """The postings (with text) on one job board -> list of posting dicts."""
    if provider == 'bamboohr':
        listing_url = f'https://{token}.bamboohr.com/careers/list'
        _, body = fetcher.get(listing_url, accept='application/json', allow=('application/json', 'text/json'))
        rows = json.loads(body).get('result', [])
        out = []
        for row in rows:
            job_id = row.get('id')
            if not job_id:
                continue
            try:
                _, detail = fetcher.get(f'https://{token}.bamboohr.com/careers/{job_id}/detail', accept='application/json', allow=('application/json', 'text/json'))
                out.append(parse_bamboohr_detail(json.loads(detail), token, job_id, row.get('jobOpeningName')))
            except (base.Refused, ValueError) as err:
                notes.append(f'bamboohr posting {job_id} not read: {getattr(err, "code", "bad json")}')
        return out
    feed, parse = RICH_FEEDS[provider]
    xml = provider == 'teamtailor'
    allow = ('application/rss+xml', 'application/xml', 'text/xml') if xml else ('application/json', 'text/json')
    _, body = fetcher.get(feed(token), accept=', '.join(allow), allow=allow)
    return [p for p in parse(body if xml else json.loads(body), token) if p['title']]


def iri_to_uri(url):
    """A web address with letters outside ASCII in its path (a job title in Chinese) as the percent-encoded address a request needs."""
    u = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((u.scheme, u.netloc.encode('idna').decode('ascii'), urllib.parse.quote(u.path, safe="/%:@!$&'()*+,;=-._~"),
                                    urllib.parse.quote(u.query, safe="=&%:@!$'()*+,;/?-._~"), ''))


def structured_page_postings(fetcher, url, notes):
    """schema.org JobPosting data on one page -> postings (with the posting's own text)."""
    final, page_html = fetcher.get(iri_to_uri(url))
    page = base.parse_page(page_html)
    out = []
    for node in base.ld_nodes(page.ld):
        if 'JobPosting' not in base.ld_types(node):
            continue
        loc = node.get('jobLocation')
        loc = loc[0] if isinstance(loc, list) and loc else loc
        place = base.address_text(loc.get('address')) if isinstance(loc, dict) else None
        reqs = node.get('applicantLocationRequirements')
        reqs = reqs if isinstance(reqs, list) else [reqs] if reqs else []
        req_names = ', '.join(str(r.get('name')) for r in reqs if isinstance(r, dict) and r.get('name'))
        telecommute = node.get('jobLocationType') == 'TELECOMMUTE'
        out.append(_p('schema.org', base.http_url(node.get('url')) or final, node.get('title'), ' / '.join(x for x in (place, req_names) if x) or None,
                      node.get('datePosted'), 'remote' if telecommute else None, None, ' '.join([node.get('title') or '', plain(node.get('description'))])))
    return final, out


# ---------------------------------------------------------------------------------------------- one company
def read_company(entry, fetcher):
    """-> the findings for one company (and what was read)."""
    now = base.iso_now()
    diag = {'sources': [], 'refused': [], 'notes': []}
    postings = []
    boards = entry['pass1'].get('boards') or []
    careers = entry['pass1'].get('careers_url')
    seen_pages = set()
    board_read = False  # a board feed was read without trouble (it may list none: then no role is open, and no stored posting page is read)
    for board in boards:
        if board['provider'] not in RICH_FEEDS and board['provider'] != 'bamboohr':
            diag['notes'].append(f"{board['provider']} feed carries no posting text: not read")
            continue
        try:
            got = read_board(fetcher, board['provider'], board['token'], diag['notes'])
            board_read = True
            diag['sources'].append({'kind': board['provider'], 'url': board['page_url'], 'postings': len(got)})
            postings.extend(got)
        except base.Refused as err:
            diag['refused'].append({'url': err.url, 'code': err.code})
        except (ValueError, base.ET.ParseError):
            diag['refused'].append({'url': board['page_url'], 'code': 'bad_feed'})
    if not board_read:  # no board feed could be read: the pages Pass 1 found its postings on may carry schema.org JobPosting data
        hiring_page = (entry['fields'].get('hiring') or {}).get('source_url')
        urls = [u for u in [hiring_page, careers] + [j.get('apply_url') for j in ((entry['fields'].get('open_jobs') or {}).get('value') or [])] if u]
        for url in urls[:8]:
            key = urllib.parse.urldefrag(url)[0]
            if key in seen_pages:
                continue
            seen_pages.add(key)
            try:
                final, got = structured_page_postings(fetcher, url, diag['notes'])
                if got:
                    diag['sources'].append({'kind': 'schema.org', 'url': final, 'postings': len(got)})
                    postings.extend(got)
            except base.Refused as err:
                diag['refused'].append({'url': err.url, 'code': err.code})
    # one posting is one address
    unique, keys = [], set()
    for p in postings:
        key = p['url'] or (p['title'], p['location'])
        if key not in keys:
            keys.add(key)
            unique.append(p)
    return summarise(entry, unique, diag, now)


def in_australia(p):
    """Does this posting speak for the company's Australian side? A posting located in Beijing, Cebu or Chicago says how people work THERE.
    One with no place, or an Australian one, counts; so does one that is remote with no other country named."""
    place = p.get('location') or ''
    return not place or bool(AU_WORDS.search(place)) or not OTHER_PLACES.search(place)


def summarise(entry, postings, diag, now):
    for p in postings:
        p['_class'] = classify(p)
        p['_au'] = in_australia(p)
    here = [p for p in postings if p['_au']]
    labels = [(p['_class'], p) for p in here if p['_class']]
    counts = {}
    for (label, _, _), _ in labels:
        counts[label] = counts.get(label, 0) + 1
    stated = {label for label in counts if label in POLICIES}
    policy = {'value': None, 'source_url': None, 'last_verified_at': None, 'basis': None, 'quote': None}
    # A company has a policy only when EVERY posting that speaks for its Australian side states one of the four, and they all state the same:
    # a policy one posting in forty gives is that posting's, not the company's.
    if here and len(stated) == 1 and counts[next(iter(stated))] == len(here):
        label = next(iter(stated))
        (lab, basis, quote), p = next(item for item in labels if item[0][0] == label)
        policy = {'value': label, 'source_url': p['url'] or diag['sources'][0]['url'], 'last_verified_at': now, 'basis': basis, 'quote': quote,
                  'postings_saying_it': counts[label], 'postings_read': len(postings)}
    reason = None
    if policy['value'] is None:
        said = ', '.join(f'{k} x{v}' for k, v in sorted(counts.items()))
        silent = len(here) - sum(counts.values())
        if not postings:
            reason = 'no postings could be read'
        elif not here:
            reason = f'every posting read is located outside Australia ({len(postings)})'
        elif not counts:
            reason = f'none of {len(here)} postings states how people work'
        elif len(stated) > 1:
            reason = f'postings disagree: {said}; {silent} say nothing'
        else:
            reason = f'{said} of {len(here)} postings; {silent} say nothing'
    abroad = len(postings) - len(here)
    own = re.sub(r'[^a-z0-9]', '', entry['name'].lower())
    tech = {}
    for p in postings:
        for name in find_tech(p['text']):
            if re.sub(r'[^a-z0-9]', '', name.lower()) == own:
                continue  # a company naming its own product is not naming what it builds with
            slot = tech.setdefault(name, {'name': name, 'postings': 0, 'source_url': p['url'] or (diag['sources'][0]['url'] if diag['sources'] else None)})
            slot['postings'] += 1
    stack = sorted(tech.values(), key=lambda t: (-t['postings'], t['name']))
    dated = sorted(((p['posted_at'], p) for p in postings if p['posted_at']), key=lambda x: x[0], reverse=True)
    last = {'value': None, 'source_url': None, 'last_verified_at': None, 'basis': None}
    if dated:
        when, p = dated[0]
        try:
            age = (datetime.fromisoformat(now.replace('Z', '+00:00')).date() - datetime.fromisoformat(when).date()).days
        except ValueError:
            age = None
        last = {'value': when, 'source_url': p['url'] or diag['sources'][0]['url'], 'last_verified_at': now, 'basis': f"{p['provider']} posting date", 'postings_dated': len(dated), 'postings_read': len(postings),
                'days_old': age}  # a posting that is still listed after half a year or more is worth a look before anyone calls the company "recently hiring"
    mixed_quotes = [{'url': p['url'], 'label': p['_class'][0], 'basis': p['_class'][1], 'quote': p['_class'][2]} for p in postings if p['_class'] and p['_class'][2]][:6]
    return {
        'id': entry['id'], 'name': entry['name'], 'read': diag['sources'], 'refused': diag['refused'], 'notes': diag['notes'], 'postings_read': len(postings),
        'postings_outside_australia': abroad,
        'remote_policy': policy, 'remote_policy_reason': reason, 'remote_statements': counts, 'text_quotes': mixed_quotes,
        'tech_stack': {'value': [t['name'] for t in stack] or None, 'items': stack, 'last_verified_at': now if stack else None},
        'last_role_seen_at': last,
    }


# ---------------------------------------------------------------------------------------------- report
def table(results):
    lines = []
    head = f"{'company':<20}{'read':>5}  {'remote policy':<14}{'why not':<46}{'stack':>5}  {'last posting':<12}  top technologies"
    lines.append(head)
    lines.append('-' * len(head))
    for r in results:
        policy = r['remote_policy']['value'] or '-'
        reason = '' if r['remote_policy']['value'] else (r['remote_policy_reason'] or '')[:44]
        stack = r['tech_stack']['items']
        top = ', '.join(f"{t['name']}({t['postings']})" for t in stack[:7])
        last = r['last_role_seen_at']
        shown = (last['value'] + ('*' if (last.get('days_old') or 0) > 180 else '')) if last['value'] else '-'
        lines.append(f"{r['name'][:19]:<20}{r['postings_read']:>5}  {policy:<14}{reason:<46}{len(stack):>5}  {shown:<12}  {top}")
    return '\n'.join(lines)


def coverage(results):
    n = len(results)
    got = lambda f: sum(1 for r in results if f(r))  # noqa: E731
    read = got(lambda r: r['postings_read'] > 0)
    by = {}
    for r in results:
        v = r['remote_policy']['value']
        if v:
            by[v] = by.get(v, 0) + 1
    return {
        'companies': n, 'with_postings_read': read,
        'remote_policy': got(lambda r: r['remote_policy']['value']), 'remote_policy_by_value': by,
        'tech_stack': got(lambda r: r['tech_stack']['value']), 'last_role_seen_at': got(lambda r: r['last_role_seen_at']['value']),
        'postings_read': sum(r['postings_read'] for r in results),
        'postings_stating_a_policy': sum(sum(v for k, v in r['remote_statements'].items() if k in POLICIES) for r in results),
        'postings_remote_but_unplaced': sum(sum(v for k, v in r['remote_statements'].items() if k in ('remote-other', 'remote-unspecified')) for r in results),
    }


def selftest():
    # how people work
    c = lambda **kw: classify({'provider': 'x', 'location': None, 'text': '', 'remote_flag': None, 'workplace': None, **kw})  # noqa: E731
    assert c(workplace='hybrid')[0] == 'hybrid' and c(workplace='OnSite')[0] == 'onsite' and c(workplace='on-site')[0] == 'onsite'
    assert c(workplace='remote', location='Sydney, Australia')[0] == 'remote-au'
    assert c(workplace='Remote', location='Anywhere')[0] == 'remote-global'
    assert c(workplace='Remote', location='Austin, US')[0] == 'remote-other'
    assert c(workplace='remote')[0] == 'remote-unspecified' and c(workplace='unspecified') is None
    assert c(location='Remote - Australia')[0] == 'remote-au' and c(location='Melbourne (Hybrid)')[0] == 'hybrid' and c(location='Remote, United States')[0] == 'remote-other'
    assert c(location='Sydney') is None and c(location='Sydney', text='We run remote monitoring of hybrid cloud estates and visit sites on-site.') is None
    assert c(text='This is a hybrid role with three days in the office.')[0] == 'hybrid'
    assert c(text='Work from anywhere in the world.')[0] == 'remote-global'
    assert c(text='This role is remote within Australia.')[0] == 'remote-au' and c(text='Australia only, please.')[0] == 'remote-au'
    assert c(text='This is an on-site role in Sydney.')[0] == 'onsite' and c(text='You will visit customers on-site.') is None
    assert c(text='A hybrid role. Also fully remote.')[0] == 'mixed'
    assert c(remote_flag=True, location='Brisbane')[0] == 'remote-au'
    assert c(workplace='Hybrid', text='Work from anywhere')[0] == 'hybrid'  # the posting's own field wins over a sentence
    # technologies
    assert find_tech('We use React, TypeScript and Node.js on AWS with Postgres.') == ['AWS', 'Node.js', 'PostgreSQL', 'React', 'TypeScript']
    assert find_tech('You will react quickly. Snowflake and dbt power our python stack.') == ['Python', 'Snowflake', 'dbt']
    assert find_tech('Our stack: Python, Go, Kubernetes.') == ['Go', 'Kubernetes', 'Python']
    assert find_tech('Time to go. Our Swift team moves fast. Rust never sleeps.') == []
    assert find_tech('Kotlin, Swift and Rust.') == ['Kotlin', 'Swift']  # Rust stands beside only another ambiguous name: not counted
    assert find_tech('Golang services; Apache Spark jobs.') == ['Go', 'Spark']
    assert find_tech('Laravel and laravel, JavaScript not Java.') == ['Java', 'JavaScript', 'Laravel'] or find_tech('JavaScript') == ['JavaScript']
    assert find_tech('JavaScript') == ['JavaScript'] and find_tech('C# and C++ and .NET') == ['.NET', 'C#', 'C++']
    assert find_tech('Express interest in our role') == [] and find_tech('Looker Studio and Power BI') == ['Looker', 'Power BI']
    # postings from each feed
    gh = parse_greenhouse({'jobs': [{'title': 'Engineer', 'absolute_url': 'https://boards.greenhouse.io/x/jobs/1', 'location': {'name': 'Sydney'}, 'updated_at': '2026-10-01T00:00:00Z',
                                    'content': '&lt;p&gt;We use &lt;strong&gt;React&lt;/strong&gt; &amp;amp; Laravel.&lt;/p&gt;'}]}, 'x')
    assert gh[0]['posted_at'] is None and find_tech(gh[0]['text']) == ['Laravel', 'React'], gh[0]['text']
    lv = parse_lever([{'text': 'PM', 'hostedUrl': 'https://jobs.lever.co/a/1', 'createdAt': 1790000000000, 'workplaceType': 'hybrid', 'categories': {'location': 'Sydney'},
                       'descriptionPlain': 'Work with Snowflake.', 'lists': [{'content': '<li>dbt</li>'}]}], 'a')
    assert lv[0]['workplace'] == 'hybrid' and lv[0]['posted_at'] and find_tech(lv[0]['text']) == ['Snowflake', 'dbt']
    assert parse_lever([{'text': 'A', 'hostedUrl': 'https://jobs.lever.co/a/2', 'workplaceType': 'unspecified'}], 'a')[0]['workplace'] is None
    ab = parse_ashby({'jobs': [{'title': 'SRE', 'jobUrl': 'https://jobs.ashbyhq.com/a/1', 'location': 'Remote', 'isRemote': True, 'publishedAt': '2026-10-05T00:00:00Z',
                                'workplaceType': 'Remote', 'descriptionPlain': 'Terraform'}]}, 'a')
    assert ab[0]['posted_at'] == '2026-10-05' and classify(ab[0])[0] == 'remote-unspecified'
    tt = parse_teamtailor('<rss xmlns:tt="https://teamtailor.com/locations"><channel><item><title>T</title><link>https://s.teamtailor.com/jobs/1</link><remoteStatus>hybrid</remoteStatus>'
                          '<description>PHP</description></item></channel></rss>', 's')
    assert tt[0]['workplace'] == 'hybrid' and classify(tt[0])[0] == 'hybrid'
    # a company: all agree -> a policy; a mix -> none, shown as a mix
    entry = {'id': 'x', 'name': 'X', 'pass1': {}, 'fields': {}}
    agree = [_p('lever', f'https://u/{i}', 't', 'Sydney', '2026-10-0%d' % (i + 1), 'hybrid', None, 'Python') for i in range(3)]
    out = summarise(entry, agree, {'sources': [{'url': 'https://u/'}], 'refused': [], 'notes': []}, 'now')
    assert out['remote_policy']['value'] == 'hybrid' and out['last_role_seen_at']['value'] == '2026-10-03' and out['tech_stack']['value'] == ['Python']
    mix = agree + [_p('lever', 'https://u/9', 't', 'Sydney', None, 'onsite', None, '')]
    out = summarise(entry, mix, {'sources': [{'url': 'https://u/'}], 'refused': [], 'notes': []}, 'now')
    assert out['remote_policy']['value'] is None and 'disagree' in out['remote_policy_reason']
    none = summarise(entry, [_p('lever', 'https://u/1', 't', 'Sydney', None, None, None, 'Nothing here.')], {'sources': [{'url': 'https://u/'}], 'refused': [], 'notes': []}, 'now')
    assert none['remote_policy']['value'] is None and none['tech_stack']['value'] is None and none['last_role_seen_at']['value'] is None
    # "remote first" is a culture, not a place; "anywhere within Australia" is
    assert c(text='We are a remote first team.') is None and c(text='We are hiring anywhere within Australia.')[0] == 'remote-au'
    # one posting in three is not the company's policy
    partial = agree[:1] + [_p('lever', f'https://u/p{i}', 't', 'Sydney', None, None, None, 'Nothing.') for i in range(2)]
    out = summarise(entry, partial, {'sources': [{'url': 'https://u/'}], 'refused': [], 'notes': []}, 'now')
    assert out['remote_policy']['value'] is None and 'hybrid x1 of 3 postings' in out['remote_policy_reason'] and '2 say nothing' in out['remote_policy_reason']
    # a posting in Beijing speaks for Beijing
    abroad = [_p('lever', 'https://u/b', 't', 'Beijing, China', None, 'hybrid', None, '')]
    out = summarise(entry, abroad, {'sources': [{'url': 'https://u/'}], 'refused': [], 'notes': []}, 'now')
    assert out['remote_policy']['value'] is None and 'outside Australia' in out['remote_policy_reason'] and out['postings_outside_australia'] == 1
    here_and_there = agree + abroad
    assert summarise(entry, here_and_there, {'sources': [{'url': 'https://u/'}], 'refused': [], 'notes': []}, 'now')['remote_policy']['value'] == 'hybrid'
    # a company does not "use" its own product
    own = summarise({'id': 'b', 'name': 'Buildkite', 'pass1': {}, 'fields': {}}, [_p('greenhouse', 'https://u/1', 't', 'Sydney', None, None, None, 'Buildkite and Python.')], {'sources': [{'url': 'https://u/'}], 'refused': [], 'notes': []}, 'now')
    assert own['tech_stack']['value'] == ['Python']
    assert iri_to_uri('https://x.test/jobs/1/研究-engineer/') == 'https://x.test/jobs/1/%E7%A0%94%E7%A9%B6-engineer/'
    assert iri_to_uri('https://x.test/a b?q=ü') == 'https://x.test/a%20b?q=%C3%BC'
    print('selftest ok')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', help='comma-separated company ids')
    ap.add_argument('--out', default=str(OUT))
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--selftest', action='store_true')
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    enriched = json.loads(ENRICHED.read_text('utf-8'))
    chosen = [c for c in enriched['companies'] if (c['fields'].get('hiring') or {}).get('value') is True and ((c['fields'].get('hiring') or {}).get('confidence') or 0) >= 0.85]
    if args.only:
        wanted = set(args.only.split(','))
        chosen = [c for c in chosen if c['id'] in wanted]
    fetcher = base.Fetcher()
    started = datetime.now(timezone.utc)
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda c: read_company(c, fetcher), chosen))
    out = {
        '_readme': 'Pass 2 findings: only what a posting itself states. NOT merged into the directory. Each value has the posting it came from (source_url), when it was read '
                   '(last_verified_at) and the words that showed it (basis). null means no posting said. See pass2_postings.py for the rules.',
        'generated_at': base.iso_now(), 'script': 'backend/scripts/enrich/pass2_postings.py', 'user_agent': base.UA,
        'coverage': coverage(results), 'requests': fetcher.requests, 'seconds': round((datetime.now(timezone.utc) - started).total_seconds()), 'companies': results,
    }
    Path(args.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n', 'utf-8')
    print(table(results))
    print('(* the newest posting is over 180 days old)')
    print('\ncoverage:', json.dumps(out['coverage'], indent=1))
    print(f"\n{fetcher.requests} requests in {out['seconds']} s -> {args.out}")


if __name__ == '__main__':
    main()
