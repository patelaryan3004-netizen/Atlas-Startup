#!/usr/bin/env python3
"""One-off enrichment of the company directory -> companies_enriched.json  (Python 3.12, standard library only).

Run from anywhere:
    python backend/scripts/enrich/enrich_companies.py --pass 1            # all companies
    python backend/scripts/enrich/enrich_companies.py --pass 1 --only culture-amp,karbon
    python backend/scripts/enrich/enrich_companies.py --selftest

PASS 1 (this file): hiring status, open jobs, city, state.   Passes 2 and 3 are added after Pass 1 is reviewed.

Every field in the output is {value, source_url, confidence (0-1), last_verified_at}. Unknown is null, never a guess.

What it may read (the same rules as backend/src/discovery/http.js):
  - company websites, careers pages, and the public job-board feeds (Greenhouse, Lever, Ashby, Workable, Recruitee,
    SmartRecruiters) that a company's OWN pages point at. Never LinkedIn, Crunchbase or any other database; never a search page.
  - robots.txt always (Disallow / Allow with wildcards, Crawl-delay). If it cannot be read, the site is closed for this run.
  - one request per host every 2 s (more if Crawl-delay says so); a host that answers 429/503 is left alone for the run.
  - an honest user agent; a 401/403 or a redirect to a login page is final (no retry, no workaround); no internal addresses.

Confidence (how much a reader may lean on the value):
  0.95  roles listed on the job board the company's own careers page points at (its feed lists them)
  0.85  roles in schema.org JobPosting data on the company's own careers page (for "hiring"; the LIST of roles is
        0.60 there, because a careers page often marks up only a few of its postings)
  0.80  a postal address in schema.org data on the company's own page (city, state)
  0.60  that board lists NO open roles right now (the company may still hire off-board, so this is not 1)
  existing record: the 10 hiring values a page backs 0.90; location 0.3/0.6/0.9 from its own low/medium/high;
                   the 60 "hiring" flags no page backs 0.20.

Merge rule: a new value never replaces one of higher confidence (a tie keeps the existing value). Where the two
disagree about a stable fact (city, state) or about hiring, the pair is written to "conflicts" for a person.
"""
import argparse
import concurrent.futures as cf
import http.client
import ipaddress
import json
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent.parent / 'src' / 'data'
DEFAULT_OUT = HERE / 'companies_enriched.json'

UA = 'AUStartupMapBot/1.0 (+https://stillearly-au.vercel.app/; enrichment)'
PRODUCT = 'austartupmapbot'
MAX_STORED_JOBS = 50

_PROPRIETARY = 'a proprietary startup database'
BLOCKED_HOSTS = {
    'linkedin.com': 'LinkedIn forbids scraping', 'lnkd.in': 'LinkedIn', 'licdn.com': 'LinkedIn',
    'crunchbase.com': _PROPRIETARY, 'pitchbook.com': _PROPRIETARY, 'dealroom.co': _PROPRIETARY, 'cbinsights.com': _PROPRIETARY,
    'tracxn.com': _PROPRIETARY, 'zoominfo.com': _PROPRIETARY, 'apollo.io': _PROPRIETARY, 'rocketreach.co': _PROPRIETARY,
    'owler.com': _PROPRIETARY, 'wellfound.com': _PROPRIETARY, 'angel.co': _PROPRIETARY, 'f6s.com': _PROPRIETARY,
    'google.com': 'search results', 'bing.com': 'search results', 'duckduckgo.com': 'search results', 'yahoo.com': 'search results',
}
HARD_REFUSALS = {'blocked_host', 'private_host', 'dns_failed', 'bad_url', 'bad_scheme'}
BLOCKING = {'robots_disallow', 'robots_unavailable', 'access_controlled', 'rate_limited', 'blocked_host'}  # the site said no
LOGIN_PATH = re.compile(r'/(?:log-?in|sign-?in|sso|auth(?:orize)?|account/login)(?:/|$|\?)', re.I)


def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


# ---------------------------------------------------------------------------------------------- robots.txt
class Robots:
    """robots.txt with * and $ wildcards, longest match wins, Allow wins a tie, Crawl-delay."""

    def __init__(self, text):
        self.groups = []  # (agents, rules[(allow, pattern)], delay)
        agents, rules, delay, seen_rule = [], [], None, False

        def flush():
            if agents:
                self.groups.append((list(agents), list(rules), delay))

        for raw in text.splitlines():
            line = raw.split('#', 1)[0].strip()
            if ':' not in line:
                continue
            key, value = [s.strip() for s in line.split(':', 1)]
            key = key.lower()
            if key == 'user-agent':
                if seen_rule:
                    flush()
                    agents, rules, delay, seen_rule = [], [], None, False
                agents.append(value.lower())
            elif key in ('allow', 'disallow'):
                seen_rule = True
                if key == 'disallow' and value == '':
                    continue  # an empty Disallow allows everything
                rules.append((key == 'allow', value))
            elif key == 'crawl-delay':
                try:
                    delay = float(value)
                except ValueError:
                    pass
        flush()
        self._rx = {}

    def _mine(self):
        specific = [g for g in self.groups if any(a != '*' and a in PRODUCT for a in g[0])]
        return specific or [g for g in self.groups if '*' in g[0]]

    def _regex(self, pattern):
        if pattern not in self._rx:
            end = pattern.endswith('$')
            body = pattern[:-1] if end else pattern
            self._rx[pattern] = re.compile(''.join('.*' if ch == '*' else re.escape(ch) for ch in body) + (r'\Z' if end else ''))
        return self._rx[pattern]

    def allowed(self, path):
        best = None  # (length, allow)
        for _, rules, _ in self._mine():
            for allow, pattern in rules:
                if self._regex(pattern).match(path):
                    cand = (len(pattern), allow)
                    if best is None or cand[0] > best[0] or (cand[0] == best[0] and allow):
                        best = cand
        return True if best is None else best[1]

    def delay(self):
        delays = [g[2] for g in self._mine() if g[2] is not None]
        return max(delays) if delays else None


# ---------------------------------------------------------------------------------------------- fetching
class Refused(Exception):
    def __init__(self, code, message, url):
        super().__init__(message)
        self.code, self.url = code, url


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # redirects are followed by hand, so each hop is checked
        return None


def blocked_reason(host):
    host = host.lower()
    for domain, why in BLOCKED_HOSTS.items():
        if host == domain or host.endswith('.' + domain):
            return why
    return None


class Fetcher:
    def __init__(self, min_delay=2.0, timeout=15, max_bytes=1_500_000, max_redirects=3):
        self.min_delay, self.timeout, self.max_bytes, self.max_redirects = min_delay, timeout, max_bytes, max_redirects
        self.opener = urllib.request.build_opener(_NoRedirect)
        self._lock = threading.Lock()
        self._host_locks, self._last, self._robots, self._robots_locks = {}, {}, {}, {}
        self.cooling = set()
        self.requests = 0

    def _refuse(self, code, message, url):
        raise Refused(code, message, url)

    def _check(self, url):
        try:
            u = urllib.parse.urlsplit(url)
            host = u.hostname
        except ValueError:
            return self._refuse('bad_url', 'not a valid URL', url)
        if u.scheme not in ('http', 'https') or not host:
            self._refuse('bad_scheme', f'{u.scheme or "no scheme"} is not http(s)', url)
        if u.username or u.password:
            self._refuse('bad_url', 'URLs with credentials are not fetched', url)
        why = blocked_reason(host)
        if why:
            self._refuse('blocked_host', f'{host} is blocked: {why}', url)
        if '.' not in host or host == 'localhost' or re.search(r'\.(?:localhost|local|internal|lan|intranet)$', host):
            self._refuse('private_host', f'{host} is an internal name', url)
        return u

    def _resolve_check(self, host, url):
        infos = None
        for attempt in (1, 2, 3):  # a lookup that fails once is often the resolver, not the domain: only three failures in a row count
            try:
                infos = socket.getaddrinfo(host, None)
                break
            except OSError:
                if attempt < 3:
                    time.sleep(2)
        if infos is None:
            self._refuse('dns_failed', f'could not resolve {host}', url)
        for info in infos:
            if not ipaddress.ip_address(info[4][0].split('%')[0]).is_global:
                self._refuse('private_host', f'{host} resolves to an internal address', url)

    def _host_lock(self, host):
        with self._lock:
            return self._host_locks.setdefault(host, threading.Lock())

    def _raw(self, url, accept, min_delay, paced=True):
        u = self._check(url)
        host = u.hostname
        if host in self.cooling:
            self._refuse('rate_limited', f'{host} asked us to slow down; left alone for this run', url)
        self._resolve_check(host, url)
        with self._host_lock(host):
            if paced:
                wait = self._last.get(host, 0) + min_delay - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
            for attempt in (1, 2):  # a dropped connection or a timeout gets one more try; an answer of any kind does not
                with self._lock:
                    self.requests += 1
                status, headers, body = self._once(u, accept)
                self._last[host] = time.monotonic()
                if not isinstance(status, str):
                    return status, headers, body
                if attempt == 1:
                    time.sleep(3)
            self._refuse(status, headers, url)  # a failure comes back as (code, message, None)

    def _once(self, u, accept):
        try:
            req = urllib.request.Request(u.geturl(), headers={'User-Agent': UA, 'Accept': accept})
            try:
                resp = self.opener.open(req, timeout=self.timeout)
                return resp.status, resp.headers, resp.read(self.max_bytes + 1)
            except urllib.error.HTTPError as err:
                err.close()
                return err.code, err.headers, None
        except (TimeoutError, socket.timeout):
            return 'timeout', 'timed out', None
        except urllib.error.URLError as err:
            return ('timeout' if isinstance(err.reason, (TimeoutError, socket.timeout)) else 'network_error'), str(err.reason), None
        except (OSError, http.client.HTTPException, ValueError) as err:
            return 'network_error', str(err), None

    def _robots_for(self, origin):
        with self._lock:
            if origin in self._robots:
                return self._robots[origin]
            lock = self._robots_locks.setdefault(origin, threading.Lock())
        with lock:
            with self._lock:
                if origin in self._robots:
                    return self._robots[origin]
            entry = self._load_robots(origin)
            with self._lock:
                self._robots[origin] = entry
            return entry

    def _load_robots(self, origin):
        url = f'{origin}/robots.txt'
        try:
            for _ in range(self.max_redirects + 1):
                status, headers, body = self._raw(url, 'text/plain', 0, paced=False)
                if status not in (301, 302, 303, 307, 308):
                    break
                url = urllib.parse.urljoin(url, headers.get('Location') or '')
            if status == 200:
                if body is not None and len(body) > 500_000:
                    return ('robots_unavailable', 'robots.txt is too large to read')
                return Robots(body.decode('utf-8', 'replace'))
            if status in (401, 403):
                return ('robots_unavailable', f'robots.txt is access-controlled (HTTP {status})')
            if status == 429 or status >= 500:
                if status == 429:
                    self.cooling.add(urllib.parse.urlsplit(origin).hostname)
                return ('robots_unavailable', f'robots.txt is unavailable (HTTP {status})')
            return Robots('')  # 404 and the like: the site states no rules
        except Refused as err:
            if err.code in HARD_REFUSALS:
                raise
            return (err.code, str(err))  # a timeout or a dropped connection: no rules were read, so the site stays closed

    def get(self, url, accept='text/html,application/xhtml+xml;q=0.9', allow=('text/html', 'application/xhtml+xml')):
        """-> (final_url, text). Raises Refused with a code for anything declined or unreadable."""
        current = url
        for _ in range(self.max_redirects + 1):
            u = self._check(current)
            robots = self._robots_for(f'{u.scheme}://{u.netloc}')
            if isinstance(robots, tuple):
                self._refuse(robots[0], robots[1], current)
            path = (u.path or '/') + (f'?{u.query}' if u.query else '')
            if not robots.allowed(path):
                self._refuse('robots_disallow', f'robots.txt disallows {u.path}', current)
            delay = robots.delay()
            min_delay = min(30.0, max(self.min_delay, delay)) if delay else self.min_delay
            status, headers, body = self._raw(current, accept, min_delay)
            if status in (301, 302, 303, 307, 308):
                location = headers.get('Location')
                if not location:
                    self._refuse('http_error', f'HTTP {status} without a location', current)
                current = urllib.parse.urljoin(current, location)
                continue
            host = u.hostname
            if status in (401, 403):
                self._refuse('access_controlled', f'HTTP {status}: access-controlled, not retried or worked around', current)
            if status in (429, 503):
                self.cooling.add(host)
                self._refuse('rate_limited', f'HTTP {status}: {host} asked us to slow down', current)
            if status >= 400:
                self._refuse('http_error', f'HTTP {status}', current)
            if current != url and LOGIN_PATH.search(urllib.parse.urlsplit(current).path) and not LOGIN_PATH.search(urllib.parse.urlsplit(url).path):
                self._refuse('access_controlled', 'redirected to a login page', current)
            ctype = (headers.get('Content-Type') or '').split(';')[0].strip().lower()
            if ctype not in allow:
                self._refuse('unsupported_content', f'unexpected content type "{ctype or "unknown"}"', current)
            if body is None or len(body) > self.max_bytes:
                self._refuse('too_large', f'response is over {self.max_bytes} bytes', current)
            charset = re.search(r'charset=([\w-]+)', headers.get('Content-Type') or '', re.I)
            try:
                text = body.decode(charset.group(1) if charset else 'utf-8', 'replace')
            except LookupError:
                text = body.decode('utf-8', 'replace')
            return current, text
        return self._refuse('too_many_redirects', f'more than {self.max_redirects} redirects', url)


# ---------------------------------------------------------------------------------------------- html
class PageParser(HTMLParser):
    """Anchors (href, text) and the JSON-LD blocks of a page."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.anchors, self.ld, self.srcs = [], [], []
        self._a, self._ld = None, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('iframe', 'script', 'embed') and a.get('src'):
            self.srcs.append(a['src'])
        if tag == 'a' and a.get('href'):
            self._a = [a['href'], '', a.get('aria-label') or a.get('title') or '']
        elif tag == 'script' and 'ld+json' in (a.get('type') or '').lower():
            self._ld = []

    def handle_data(self, data):
        if self._ld is not None:
            self._ld.append(data)
        elif self._a is not None:
            self._a[1] += data

    def handle_endtag(self, tag):
        if tag == 'a' and self._a:
            self.anchors.append((self._a[0], ' '.join(self._a[1].split()) or self._a[2]))
            self._a = None
        elif tag == 'script' and self._ld is not None:
            self.ld.append(''.join(self._ld))
            self._ld = None


def parse_page(html):
    parser = PageParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # malformed markup: keep whatever was read
        pass
    return parser


def ld_nodes(blobs):
    def walk(node):
        if isinstance(node, list):
            for item in node:
                yield from walk(item)
        elif isinstance(node, dict):
            yield node
            for key in ('@graph', 'itemListElement', 'item', 'mainEntity', 'mainEntityOfPage'):
                if key in node:
                    yield from walk(node[key])
    for blob in blobs:
        try:
            yield from walk(json.loads(blob))
        except (ValueError, RecursionError):
            continue


def ld_types(node):
    t = node.get('@type')
    return [t] if isinstance(t, str) else [x for x in (t or []) if isinstance(x, str)]


def day(value):
    if value is None:
        return None
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', str(value))
    return f'{m.group(1)}-{m.group(2)}-{m.group(3)}' if m else None


def text_of(value, limit=120):
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def is_remote(*texts):
    return True if any(re.search(r'\bremote\b', str(t or ''), re.I) for t in texts) else None


def http_url(value):
    return value if isinstance(value, str) and re.match(r'https?://', value, re.I) else None


def address_text(addr):
    if not isinstance(addr, dict):
        return None
    country = addr.get('addressCountry')
    country = country.get('name') if isinstance(country, dict) else country
    parts = [addr.get('addressLocality'), addr.get('addressRegion'), country]
    return ', '.join(str(p).strip() for p in parts if isinstance(p, str) and p.strip()) or None


def jsonld_jobs(blobs, today):
    jobs = []
    for node in ld_nodes(blobs):
        if 'JobPosting' not in ld_types(node):
            continue
        title = text_of(node.get('title'))
        if not title:
            continue
        valid = day(node.get('validThrough'))
        if valid and valid < today:
            continue  # the posting has expired
        loc = node.get('jobLocation')
        loc = loc[0] if isinstance(loc, list) and loc else loc
        place = address_text(loc.get('address')) if isinstance(loc, dict) else None
        emp = node.get('employmentType')
        emp = ', '.join(emp) if isinstance(emp, list) else emp
        jobs.append({
            'title': title, 'location': place, 'employment_type': text_of(emp),
            'remote': True if node.get('jobLocationType') == 'TELECOMMUTE' else is_remote(place),
            'posted_at': day(node.get('datePosted')), 'apply_url': http_url(node.get('url')),
        })
    return jobs


AU_STATES = {
    'new south wales': 'NSW', 'nsw': 'NSW', 'victoria': 'VIC', 'vic': 'VIC', 'queensland': 'QLD', 'qld': 'QLD',
    'western australia': 'WA', 'wa': 'WA', 'south australia': 'SA', 'sa': 'SA', 'tasmania': 'TAS', 'tas': 'TAS',
    'australian capital territory': 'ACT', 'act': 'ACT', 'northern territory': 'NT', 'nt': 'NT',
}
ORG_SKIP = {'JobPosting', 'Person', 'Product', 'Event', 'Offer', 'Article', 'NewsArticle', 'BlogPosting'}


def jsonld_address(blobs):
    """An Australian postal address in the page's own schema.org data -> (city, state) or None."""
    for node in ld_nodes(blobs):
        if set(ld_types(node)) & ORG_SKIP:
            continue
        for addr in (node.get('address'), (node.get('location') or {}).get('address') if isinstance(node.get('location'), dict) else None):
            if not isinstance(addr, dict):
                continue
            country = addr.get('addressCountry')
            country = (country.get('name') if isinstance(country, dict) else country) or ''
            region = str(addr.get('addressRegion') or '').strip().lower()
            postcode = str(addr.get('postalCode') or '').strip()
            state = AU_STATES.get(region)
            in_au = str(country).strip().lower() in ('au', 'aus', 'australia') or (state and re.fullmatch(r'\d{4}', postcode))
            if not in_au:
                continue
            city = text_of(addr.get('addressLocality'), 80)
            if city or state:
                return city, state
    return None


# ---------------------------------------------------------------------------------------------- job boards
def _greenhouse(j, t):
    return [{'title': text_of(x.get('title')), 'location': text_of((x.get('location') or {}).get('name')), 'employment_type': None,
             'remote': is_remote((x.get('location') or {}).get('name')), 'posted_at': None, 'apply_url': http_url(x.get('absolute_url'))} for x in j.get('jobs', [])]


def _lever(j, t):
    return [{'title': text_of(x.get('text')), 'location': text_of((x.get('categories') or {}).get('location')), 'employment_type': text_of((x.get('categories') or {}).get('commitment')),
             'remote': is_remote(x.get('workplaceType'), (x.get('categories') or {}).get('location')),
             'posted_at': day(datetime.fromtimestamp(x['createdAt'] / 1000, timezone.utc).isoformat()) if isinstance(x.get('createdAt'), (int, float)) else None,
             'apply_url': http_url(x.get('hostedUrl')) or http_url(x.get('applyUrl'))} for x in (j if isinstance(j, list) else [])]


def _ashby(j, t):
    return [{'title': text_of(x.get('title')), 'location': text_of(x.get('location')), 'employment_type': text_of(x.get('employmentType')),
             'remote': True if x.get('isRemote') is True else is_remote(x.get('location')), 'posted_at': day(x.get('publishedAt')),
             'apply_url': http_url(x.get('jobUrl')) or http_url(x.get('applyUrl'))} for x in j.get('jobs', []) if x.get('isListed') is not False]


def _workable(j, t):
    return [{'title': text_of(x.get('title')), 'location': text_of(', '.join(p for p in (x.get('city'), x.get('state'), x.get('country')) if p)), 'employment_type': text_of(x.get('employment_type')),
             'remote': True if x.get('telecommuting') is True else None, 'posted_at': day(x.get('published_on') or x.get('created_at')),
             'apply_url': http_url(x.get('url')) or http_url(x.get('shortlink'))} for x in j.get('jobs', [])]


def _recruitee(j, t):
    return [{'title': text_of(x.get('title')), 'location': text_of(x.get('location')), 'employment_type': text_of(x.get('employment_type_code')),
             'remote': True if x.get('remote') is True else None, 'posted_at': day(x.get('published_at')), 'apply_url': http_url(x.get('careers_url'))}
            for x in j.get('offers', []) if x.get('status') in (None, 'published')]


def _smartrecruiters(j, t):
    return [{'title': text_of(x.get('name')), 'location': text_of(', '.join(p for p in ((x.get('location') or {}).get(k) for k in ('city', 'region', 'country')) if p)),
             'employment_type': text_of((x.get('typeOfEmployment') or {}).get('label')), 'remote': True if (x.get('location') or {}).get('remote') is True else None,
             'posted_at': day(x.get('releasedDate')), 'apply_url': f'https://jobs.smartrecruiters.com/{t}/{x["id"]}' if x.get('id') else None} for x in j.get('content', [])]


def _bamboohr(j, t):
    out = []
    for x in j.get('result', []):
        loc = x.get('location') or {}
        place = ', '.join(p for p in (loc.get('city'), loc.get('state')) if p) or None
        out.append({'title': text_of(x.get('jobOpeningName')), 'location': text_of(place), 'employment_type': text_of(x.get('employmentStatusLabel')),
                    'remote': True if x.get('isRemote') is True else None, 'posted_at': None,
                    'apply_url': f'https://{t}.bamboohr.com/careers/{x["id"]}' if x.get('id') else None})
    return out


def _breezy(j, t):
    out = []
    for x in (j if isinstance(j, list) else []):
        loc = x.get('location') or {}
        place = loc.get('name') or ', '.join(p for p in (loc.get('city'), (loc.get('state') or {}).get('name')) if p) or None
        out.append({'title': text_of(x.get('name')), 'location': text_of(place), 'employment_type': text_of((x.get('type') or {}).get('name')),
                    'remote': True if loc.get('is_remote') is True else None, 'posted_at': day(x.get('published_date')), 'apply_url': http_url(x.get('url'))})
    return out


def _teamtailor(xml_text, t):
    if '<!DOCTYPE' in xml_text or '<!ENTITY' in xml_text:
        raise ValueError('xml with a DTD is not read')
    ns = {'tt': 'https://teamtailor.com/locations'}
    out = []
    for item in ET.fromstring(xml_text).iter('item'):
        loc = item.find('tt:locations/tt:location', ns)
        place = ', '.join(p for p in ((loc.findtext('tt:city', namespaces=ns), loc.findtext('tt:country', namespaces=ns)) if loc is not None else ()) if p) or None
        try:
            posted = parsedate_to_datetime(item.findtext('pubDate') or '').date().isoformat()
        except (TypeError, ValueError):
            posted = None
        out.append({'title': text_of(item.findtext('title')), 'location': text_of(place), 'employment_type': None,
                    'remote': True if (item.findtext('remoteStatus') or '').strip().lower() == 'fully' else None,
                    'posted_at': posted, 'apply_url': http_url(item.findtext('link'))})
    return out


PROVIDERS = [
    {'id': 'greenhouse', 'detect': [re.compile(r'boards\.greenhouse\.io/(?:embed/job_board(?:/js)?\?for=)?([A-Za-z0-9_-]+)'), re.compile(r'job-boards\.greenhouse\.io/([A-Za-z0-9_-]+)')],
     'page': lambda t: f'https://boards.greenhouse.io/{t}', 'feed': lambda t: f'https://boards-api.greenhouse.io/v1/boards/{t}/jobs', 'parse': _greenhouse},
    {'id': 'lever', 'detect': [re.compile(r'jobs\.lever\.co/([A-Za-z0-9_-]+)')],
     'page': lambda t: f'https://jobs.lever.co/{t}', 'feed': lambda t: f'https://api.lever.co/v0/postings/{t}?mode=json', 'parse': _lever},
    {'id': 'ashby', 'detect': [re.compile(r'jobs\.ashbyhq\.com/([A-Za-z0-9_.-]+)')],
     'page': lambda t: f'https://jobs.ashbyhq.com/{t}', 'feed': lambda t: f'https://api.ashbyhq.com/posting-api/job-board/{t}', 'parse': _ashby},
    {'id': 'workable', 'detect': [re.compile(r'apply\.workable\.com/([A-Za-z0-9_-]+)')],
     'page': lambda t: f'https://apply.workable.com/{t}/', 'feed': lambda t: f'https://apply.workable.com/api/v1/widget/accounts/{t}', 'parse': _workable},
    {'id': 'recruitee', 'detect': [re.compile(r'([a-z0-9-]+)\.recruitee\.com')],
     'page': lambda t: f'https://{t}.recruitee.com/', 'feed': lambda t: f'https://{t}.recruitee.com/api/offers/', 'parse': _recruitee},
    {'id': 'smartrecruiters', 'detect': [re.compile(r'(?:careers|jobs)\.smartrecruiters\.com/([A-Za-z0-9_-]+)')],
     'page': lambda t: f'https://jobs.smartrecruiters.com/{t}', 'feed': lambda t: f'https://api.smartrecruiters.com/v1/companies/{t}/postings', 'parse': _smartrecruiters},
    # Added in Pass 1b, each after its public feed was tested on a real board. Not added: Pinpoint (its robots.txt disallows /postings.json),
    # HiBob (its careers API needs a request header), Employment Hero (no public feed found).
    {'id': 'bamboohr', 'detect': [re.compile(r'([a-z0-9-]+)\.bamboohr\.com')], 'exclude': {'www', 'api', 'app', 'documentation', 'help', 'resources', 'marketplace', 'support', 'blog', 'training'},
     'page': lambda t: f'https://{t}.bamboohr.com/careers', 'feed': lambda t: f'https://{t}.bamboohr.com/careers/list', 'parse': _bamboohr},
    {'id': 'breezy', 'detect': [re.compile(r'([a-z0-9-]+)\.breezy\.hr')], 'exclude': {'www', 'app', 'api', 'help', 'support', 'blog', 'developer'},
     'page': lambda t: f'https://{t}.breezy.hr/', 'feed': lambda t: f'https://{t}.breezy.hr/json', 'parse': _breezy},
    {'id': 'teamtailor', 'detect': [re.compile(r'([a-z0-9-]+)\.teamtailor\.com')], 'exclude': {'www', 'app', 'api', 'support', 'career', 'careers', 'docs', 'partner', 'partners', 'blog'},
     'page': lambda t: f'https://{t}.teamtailor.com/jobs', 'feed': lambda t: f'https://{t}.teamtailor.com/jobs.rss', 'parse': _teamtailor,
     'xml': True, 'allow': ('application/rss+xml', 'application/xml', 'text/xml')},
]
TOKEN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{1,60}$')
NOT_A_TOKEN = {'embed', 'v1', 'jobs', 'api', 'js', 'job_board', 'careers', 'www', 'en', 'static', 'assets', 'widget'}
OTHER_HOSTS = {'www', 'api', 'app', 'careers', 'jobs', 'apply', 'blog', 'help', 'support', 'status', 'docs', 'static', 'cdn'}
ATS_HOST = re.compile(r'(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|recruitee\.com|smartrecruiters\.com|bamboohr\.com|breezy\.hr|teamtailor\.com)$', re.I)
CAREERS_PATH = re.compile(r'careers?|jobs|join|work-?with|vacanc|opportunit|hiring|openings', re.I)
CAREERS_TEXT = re.compile(r"careers?|jobs?|join (?:us|our|the)|work (?:with|at|for) us|we.?re hiring|open (?:roles|positions)|vacanc", re.I)
CONTACT_TEXT = re.compile(r'contact|about', re.I)


def detect_boards(sources, limit=2):
    found = []
    for source in sources:
        for provider in PROVIDERS:
            for rx in provider['detect']:
                for m in rx.finditer(source):
                    token = m.group(1)
                    if not TOKEN.match(token) or token.lower() in NOT_A_TOKEN or (provider['id'] == 'recruitee' and token.lower() in OTHER_HOSTS) \
                            or token.lower() in provider.get('exclude', ()):
                        continue
                    if not any(p['id'] == provider['id'] and t.lower() == token.lower() for p, t in found):
                        found.append((provider, token))
    return found[:limit]


def same_family(a, b):
    a, b = (re.sub(r'^www\.', '', h.lower()) for h in (a, b))
    return a == b or a.endswith('.' + b) or b.endswith('.' + a)


def links_of(base, anchors):
    out, seen = [], set()
    for href, text in anchors:
        if not href or re.match(r'(?:mailto|tel|javascript):|#', href, re.I):
            continue
        try:
            absolute = urllib.parse.urldefrag(urllib.parse.urljoin(base, href.strip()))[0]
            u = urllib.parse.urlsplit(absolute)
        except ValueError:
            continue
        if u.scheme in ('http', 'https') and u.hostname and absolute not in seen:
            seen.add(absolute)
            out.append((absolute, text or '', u))
    return out


# ---------------------------------------------------------------------------------------------- one company, Pass 1
def field(value, source_url, confidence, when):
    return {'value': value, 'source_url': source_url, 'confidence': confidence, 'last_verified_at': when}


NULL_FIELD = field(None, None, None, None)


UNREAD = {'timeout', 'network_error', 'dns_failed', 'http_error', 'too_large', 'unsupported_content', 'too_many_redirects'}  # could not be read, which is not the site saying no
STATE_WORDS = set(AU_STATES) | {'australia', 'au'}


def clean_locality(text):
    """A schema.org addressLocality worth keeping: not empty, not a state or the country, no digits (a postcode or a street)."""
    t = (text or '').strip()
    return t if t and not re.search(r'\d', t) and t.lower() not in STATE_WORDS else None


def read_feeds(found, fetcher, diag):
    """Read the public feed of each job board found. -> ([(entry, rows)], declined, unread); records each board and refusal on diag."""
    boards, declined, unread = [], False, False
    for provider, token in found:
        entry = {'provider': provider['id'], 'token': token, 'page_url': provider['page'](token), 'feed_ok': False, 'role_count': None}
        diag['boards'].append(entry)
        allow = provider.get('allow', ('application/json', 'text/json'))
        try:
            _, body = fetcher.get(provider['feed'](token), accept=', '.join(allow), allow=allow)
            rows = [j for j in provider['parse'](body if provider.get('xml') else json.loads(body), token) if j.get('title')]
            entry['feed_ok'], entry['role_count'] = True, len(rows)
            boards.append((entry, rows))
        except Refused as err:
            diag['refused'].append({'url': err.url, 'code': err.code})
            declined = declined or err.code in BLOCKING
            unread = unread or err.code in UNREAD
        except (ValueError, ET.ParseError):
            diag['refused'].append({'url': provider['feed'](token), 'code': 'bad_feed'})
    return boards, declined, unread


def structured_postings(pages, today):
    """schema.org JobPosting data on the pages read -> (jobs, the first page it was on)."""
    jobs, url = [], None
    for page_url, _, page in pages:
        got = jsonld_jobs(page.ld, today)
        if got:
            jobs.extend(got)
            url = url or page_url
    return jobs, url


def decide_roles(diag, boards, structured, structured_url, declined, unread, now):
    """What the boards and structured postings add up to: sets diag result and role_count, returns the new {hiring, open_jobs} fields."""
    board_jobs = [r for _, rows in boards for r in rows]
    board_url = next((e['page_url'] for e, rows in boards if rows), boards[0][0]['page_url'] if boards else None)
    if board_jobs:
        jobs, url, conf, diag['result'] = board_jobs, board_url, 0.95, 'roles_found_board'
    elif structured:
        jobs, url, conf, diag['result'] = structured, structured_url, 0.85, 'roles_found_structured'
    elif boards:
        jobs, url, conf, diag['result'] = [], board_url, 0.6, 'board_empty'
    else:
        if declined:
            diag['result'] = 'careers_blocked'
        elif unread:
            diag['result'] = 'careers_unreadable'
        elif diag['careers_found_by']:
            diag['result'] = 'careers_not_machine_readable'
        else:
            diag['result'] = 'no_careers_page'
        return {}
    seen, unique = set(), []
    for j in jobs:
        key = j.get('apply_url') or (j['title'], j.get('location'))
        if key not in seen:
            seen.add(key)
            unique.append(j)
    diag['role_count'] = len(unique)
    # postings in structured data prove the company is hiring, but a careers page often marks up only a few of them
    list_conf = 0.6 if diag['result'] == 'roles_found_structured' else conf
    return {'hiring': field(bool(unique), url, conf, now), 'open_jobs': field(unique[:MAX_STORED_JOBS], url, list_conf, now)}


def observe(company, fetcher, now, today, known_cities=frozenset()):
    """What the company's own pages and job board say now. -> (diagnostics, {hiring, open_jobs, city, suburb, state} new fields)."""
    diag = {'result': None, 'refusal': None, 'home_final_url': None, 'careers_url': None, 'careers_found_by': None, 'boards': [], 'refused': [], 'pages_read': 0, 'role_count': None, 'notes': []}
    new = {'hiring': None, 'open_jobs': None, 'city': None, 'suburb': None, 'state': None}
    site = company.get('website')
    if not site:
        diag['result'] = 'no_website'
        return diag, new

    def read(url, quiet=False, **kw):
        try:
            final, text = fetcher.get(url, **kw)
            return final, text
        except Refused as err:
            if not (quiet and err.code == 'http_error'):
                diag['refused'].append({'url': err.url, 'code': err.code})
            return None

    home = read(site)
    if not home:
        diag['result'] = 'site_unreachable'
        diag['refusal'] = diag['refused'][-1]['code'] if diag['refused'] else None
        return diag, new
    diag['pages_read'] += 1
    home_url, home_html = home
    home_page = parse_page(home_html)
    host = urllib.parse.urlsplit(home_url).hostname
    pages = [(home_url, home_html, home_page)]
    diag['home_final_url'] = home_url
    if not same_family(urllib.parse.urlsplit(site).hostname, host):
        diag['notes'].append('the listed website redirects to another domain')  # not an error (a rebrand, a product site), but worth a look

    links = links_of(home_url, home_page.anchors)
    careers = [(u_, t, u) for u_, t, u in links if CAREERS_TEXT.search(t) or CAREERS_PATH.search(u.path) or ATS_HOST.search(u.hostname)]
    ats_links = [u_ for u_, _, u in careers if ATS_HOST.search(u.hostname)]
    own = [(u_, t, u) for u_, t, u in careers if not ATS_HOST.search(u.hostname) and same_family(u.hostname, host)]
    own.sort(key=lambda x: 0 if CAREERS_PATH.search(x[2].path) else 1)
    read_careers = []
    declined = False  # a careers page or board the company points at that robots.txt or access control closed to us
    unread = False    # one that could not be read at all (a timeout, a dead link), which says nothing about the company
    for u_, _, _ in own[:2]:
        got = read(u_)
        if got:
            diag['pages_read'] += 1
            pages.append((got[0], got[1], parse_page(got[1])))
            read_careers.append(got[0])
        elif diag['refused'][-1]['code'] in BLOCKING:
            declined = True
        else:
            unread = unread or diag['refused'][-1]['code'] in UNREAD
    if read_careers:
        diag['careers_url'], diag['careers_found_by'] = read_careers[0], 'link'
    elif ats_links:
        diag['careers_url'], diag['careers_found_by'] = ats_links[0], 'link'
    elif careers:
        diag['careers_url'], diag['careers_found_by'] = careers[0][0], 'link'  # on another site, or one we were not let read
    else:
        origin = f'{urllib.parse.urlsplit(home_url).scheme}://{urllib.parse.urlsplit(home_url).netloc}'
        for path in ('/careers', '/jobs'):
            got = read(origin + path, quiet=True)
            if got:
                diag['pages_read'] += 1
                pages.append((got[0], got[1], parse_page(got[1])))
                read_careers.append(got[0])
                diag['careers_url'], diag['careers_found_by'] = got[0], 'path'
                break

    # job boards the company's own pages point at: its careers links, and everything on its careers pages
    sources = ats_links + [html for url, html, _ in pages[1:] if url in read_careers]
    boards, board_declined, board_unread = read_feeds(detect_boards(sources), fetcher, diag)
    structured, structured_url = structured_postings(pages, today)
    new.update(decide_roles(diag, boards, structured, structured_url, declined or board_declined, unread or board_unread, now))

    # city, state: only from the company's own structured address (schema.org), never guessed from text
    place = None
    for url, _, page in pages:
        place = jsonld_address(page.ld)
        if place:
            place_url = url
            break
    if not place:
        contact = [(u_, t, u) for u_, t, u in links if CONTACT_TEXT.search(t) and same_family(u.hostname, host)]
        if contact:
            got = read(contact[0][0], quiet=True)
            if got:
                diag['pages_read'] += 1
                place = jsonld_address(parse_page(got[1]).ld)
                place_url = got[0]
    if place:
        # a postal locality is often a suburb (Collingwood, Surry Hills): it is the "city" only when the directory already has it
        # as a city, otherwise it is kept as the suburb, so the city grouping on the map and the leaderboard is not broken
        locality, state = place
        locality = clean_locality(locality)
        if locality and locality.lower() in known_cities:
            new['city'] = field(locality, place_url, 0.8, now)
        elif locality:
            new['suburb'] = field(locality, place_url, 0.8, now)
        new['state'] = field(state, place_url, 0.8, now) if state else None
    return diag, new


# ---------------------------------------------------------------------------------------------- baseline + merge
LOCATION_CONFIDENCE = {'low': 0.3, 'medium': 0.6, 'high': 0.9}


def baseline_for(company, jobs, sources):
    """What the directory already holds, as fields with a confidence."""
    when = company.get('location_verified_at') or company.get('last_verified_at')
    loc_conf = LOCATION_CONFIDENCE.get(company.get('location_confidence'))
    base = {}
    city = company.get('city')
    base['city'] = field(city, company.get('location_source_url'), loc_conf or 0.3, when) if city and str(city).lower() != 'unknown' else None
    base['state'] = field(company['state'], company.get('location_source_url'), loc_conf or 0.3, when) if company.get('state') else None
    base['suburb'] = field(company['suburb'], company.get('location_source_url'), loc_conf or 0.3, when) if company.get('suburb') else None
    verified =company.get('hiring_status') == 'hiring' and company.get('hiring_verified_at')
    if verified:
        rows = [j for j in jobs if j.get('company_id') == company['id'] and j.get('status') == 'open']
        src = next((sources[j['source_id']]['url'] for j in rows if j.get('source_id') in sources), None)
        base['hiring'] = field(True, src, 0.9, company['hiring_verified_at'])
        base['open_jobs'] = field([{k: j.get(k) for k in ('title', 'location', 'employment_type', 'remote', 'posted_at', 'apply_url')} for j in rows][:MAX_STORED_JOBS], src, 0.9, company['hiring_verified_at']) if rows else None
    elif company.get('hiring') or company.get('hiring_status') == 'hiring':
        base['hiring'] = field(True, None, 0.2, None)  # a flag in the original list, backed by no page
        base['open_jobs'] = None
    else:
        base['hiring'] = base['open_jobs'] = None
    return base


def same_value(name, a, b):
    if name in ('city', 'suburb', 'state'):
        return str(a).strip().lower() == str(b).strip().lower()
    return a == b


def merge(company, name, base, new, conflicts, time_varying):
    """Never replace higher-confidence data. Returns the field to keep."""
    if not new or new['value'] is None:
        return base or dict(NULL_FIELD)
    if not base or base['value'] is None:
        return new
    if same_value(name, base['value'], new['value']):
        top = base if base['confidence'] >= new['confidence'] else new
        return field(top['value'], top['source_url'] or new['source_url'] or base['source_url'], max(base['confidence'], new['confidence']), new['last_verified_at'] or base['last_verified_at'])
    take_new = new['confidence'] >= base['confidence'] if time_varying else new['confidence'] > base['confidence']
    kept, other = (new, base) if take_new else (base, new)
    if name != 'open_jobs':  # a changed list of roles is normal; a changed city, state, or hiring answer is for a person to see
        conflicts.append({
            'company_id': company['id'], 'name': company['name'], 'field': name,
            'kept': dict(kept, origin='pass1' if take_new else 'existing'), 'rejected': dict(other, origin='existing' if take_new else 'pass1'),
            'reason': 'the new value is more confident than the existing one' if take_new else 'the existing value is at least as confident as the new one',
        })
    return kept


FIELDS = ('hiring', 'open_jobs', 'city', 'suburb', 'state')


def enrich_company(company, jobs, sources, fetcher, conflicts, now, today, known_cities=frozenset()):
    diag, new = observe(company, fetcher, now, today, known_cities)
    base = baseline_for(company, jobs, sources)
    fields = {n: merge(company, n, base.get(n), new.get(n), conflicts, n in ('hiring', 'open_jobs')) for n in FIELDS}
    return {'id': company['id'], 'name': company['name'], 'website': company.get('website'), 'fields': fields, 'pass1': diag}


# ---------------------------------------------------------------------------------------------- summary
def summarise(results, conflicts, before, seconds, requests):
    n = len(results)
    count = lambda pred: sum(1 for r in results if pred(r))
    by_result = {}
    for r in results:
        by_result[r['pass1']['result']] = by_result.get(r['pass1']['result'], 0) + 1
    providers = {}
    for r in results:
        for b in r['pass1']['boards']:
            providers[b['provider']] = providers.get(b['provider'], 0) + 1
    refusals = {}
    for r in results:
        for x in r['pass1']['refused']:
            refusals[x['code']] = refusals.get(x['code'], 0) + 1
    hiring_true = [r for r in results if r['fields']['hiring']['value'] is True]
    verified_now = [r for r in hiring_true if (r['fields']['hiring']['confidence'] or 0) >= 0.85]
    by_field = {}
    for c in conflicts:
        by_field[c['field']] = by_field.get(c['field'], 0) + 1
    return {
        'companies': n, 'with_website': count(lambda r: r['website']), 'result': by_result, 'job_boards_by_provider': providers,
        'refused_requests_by_code': refusals,
        'hiring_true': len(hiring_true), 'hiring_true_backed_by_a_page': len(verified_now), 'hiring_true_before_backed_by_a_page': before['verified'],
        'hiring_flagged_before': before['flagged'], 'hiring_false_board_empty': count(lambda r: r['fields']['hiring']['value'] is False), 'hiring_unknown': count(lambda r: r['fields']['hiring']['value'] is None),
        'open_roles_total': sum(len(r['fields']['open_jobs']['value'] or []) for r in results if r['fields']['open_jobs']['value']),
        'city_from_company_page': count(lambda r: r['fields']['city']['source_url'] and (r['fields']['city']['confidence'] or 0) == 0.8),
        'suburb_from_company_page': count(lambda r: r['fields']['suburb']['source_url'] and (r['fields']['suburb']['confidence'] or 0) == 0.8),
        'state_from_company_page': count(lambda r: r['fields']['state']['source_url'] and (r['fields']['state']['confidence'] or 0) == 0.8),
        'site_unreachable_by_reason': {k: sum(1 for r in results if r['pass1']['result'] == 'site_unreachable' and r['pass1']['refusal'] == k)
                                       for k in sorted({r['pass1']['refusal'] for r in results if r['pass1']['result'] == 'site_unreachable'}, key=str)},
        'listed_website_redirects_elsewhere': [r['id'] for r in results if r['pass1'].get('notes')],
        'conflicts': len(conflicts), 'conflicts_by_field': by_field, 'requests_made': requests, 'seconds': round(seconds, 1),
    }


def print_summary(s):
    rows = [
        ('Companies in the directory', s['companies']), ('  with a website to read', s['with_website']), ('  no website (nothing to read)', s['result'].get('no_website', 0)),
        ('Website could not be read (robots, error, timeout...)', s['result'].get('site_unreachable', 0)),
        ('No careers page found', s['result'].get('no_careers_page', 0)),
        ('Careers page read, roles not machine-readable', s['result'].get('careers_not_machine_readable', 0)),
        ('Careers page or board refused by robots/access', s['result'].get('careers_blocked', 0)),
        ('Careers page or board could not be read (timeout, dead link)', s['result'].get('careers_unreadable', 0)),
        ('Job board read, no open roles listed', s['result'].get('board_empty', 0)),
        ('Roles found on a job board feed', s['result'].get('roles_found_board', 0)),
        ('Roles found in structured JobPosting data', s['result'].get('roles_found_structured', 0)),
        ('Open roles in total', s['open_roles_total']),
        ('Hiring = true, backed by a page, BEFORE', s['hiring_true_before_backed_by_a_page']),
        ('Hiring = true, backed by a page, NOW', s['hiring_true_backed_by_a_page']),
        ('Flagged hiring before with no page behind it', s['hiring_flagged_before']),
        ('Hiring = false (board lists none)', s['hiring_false_board_empty']), ('Hiring unknown (null)', s['hiring_unknown']),
        ('City from the company\'s own structured address', s['city_from_company_page']), ('Suburb from the same', s['suburb_from_company_page']), ('State from the same', s['state_from_company_page']),
        ('Conflicts for a person to review', s['conflicts']),
        ('Requests made / seconds', f"{s['requests_made']} / {s['seconds']}"),
    ]
    width = max(len(a) for a, _ in rows)
    print('\nPASS 1 SUMMARY')
    for a, b in rows:
        print(f'  {a.ljust(width)}  {b}')
    print('  job boards by provider:', s['job_boards_by_provider'])
    print('  refused requests by code:', s['refused_requests_by_code'])
    print('  websites not read, by reason:', s['site_unreachable_by_reason'])
    print('  listed website redirects to another domain:', s['listed_website_redirects_elsewhere'])
    print('  conflicts by field:', s['conflicts_by_field'])


# ---------------------------------------------------------------------------------------------- pass 1b: the careers pages Pass 1 could not read roles from
OPEN_ROLES_TEXT = re.compile(r'(?:open|view|see|all|current|browse|explore)\s+(?:our\s+)?(?:roles|positions|jobs|vacancies|openings|opportunities)|vacanc|openings|apply', re.I)
OPEN_ROLES_PATH = re.compile(r'/(?:jobs?|roles?|positions?|openings?|vacancies|opportunities|apply)(?:/|$)', re.I)
NOISE_LABELS = {'google', 'googleapis', 'googletagmanager', 'google-analytics', 'gstatic', 'googleusercontent', 'facebook', 'fbcdn', 'twitter', 'x', 'instagram',
                'youtube', 'youtu', 'linkedin', 'licdn', 'tiktok', 'cloudflare', 'cloudfront', 'jsdelivr', 'unpkg', 'cdnjs', 'fontawesome', 'hotjar', 'segment',
                'intercom', 'hubspot', 'hsforms', 'hs-scripts', 'typekit', 'vimeo', 'apple', 'github', 'gravatar'}


def followup(r, fetcher, conflicts, now, today):
    """Pass 1b for one company: read its careers page again, follow its own "open roles" links one step, and look for the job boards the page
    points at. Boards are only ever the ones the company's own pages point at, never guessed from its name. Updates r in place."""
    diag = r['pass1']
    home_host = urllib.parse.urlsplit(diag['home_final_url'] or r['website']).hostname
    declined = unread = False
    pages = []

    def read(url):
        nonlocal declined, unread
        try:
            final, text = fetcher.get(url)
            pages.append((final, text, parse_page(text)))
            return True
        except Refused as err:
            diag['refused'].append({'url': err.url, 'code': err.code})
            declined = declined or err.code in BLOCKING
            unread = unread or err.code in UNREAD
            return False

    if read(diag['careers_url']):
        first_url, _, first = pages[0]
        careers_host = urllib.parse.urlsplit(first_url).hostname
        more = [u_ for u_, t, u in links_of(first_url, first.anchors)
                if u_ != first_url and not ATS_HOST.search(u.hostname) and (same_family(u.hostname, careers_host) or same_family(u.hostname, home_host))
                and (OPEN_ROLES_TEXT.search(t) or OPEN_ROLES_PATH.search(u.path))]
        for u_ in more[:2]:
            read(u_)
    sources, external = [], set()
    for page_url, html, page in pages:
        sources.append(html)
        for href, _ in page.anchors:
            sources.append(urllib.parse.urljoin(page_url, href))
        for src in page.srcs:
            sources.append(urllib.parse.urljoin(page_url, src))
        for ref in [urllib.parse.urljoin(page_url, h) for h, _ in page.anchors] + [urllib.parse.urljoin(page_url, s) for s in page.srcs]:
            try:
                host = urllib.parse.urlsplit(ref).hostname
            except ValueError:
                continue
            if host and not same_family(host, home_host) and not same_family(host, urllib.parse.urlsplit(page_url).hostname) \
                    and not (set(host.split('.')[:-1]) & NOISE_LABELS):
                external.add('.'.join(host.split('.')[-3:]) if host.endswith(('.com.au', '.co.uk', '.net.au', '.org.au')) else '.'.join(host.split('.')[-2:]))
    diag['boards'] = []
    boards, board_declined, board_unread = read_feeds(detect_boards(sources), fetcher, diag)
    structured, structured_url = structured_postings(pages, today)
    before = diag['result']
    new = decide_roles(diag, boards, structured, structured_url, declined or board_declined, unread or board_unread, now)
    diag['followup'] = {'pages_read': len(pages), 'result_before': before, 'external_hosts': sorted(external)[:15]}
    for name in ('hiring', 'open_jobs'):
        r['fields'][name] = merge(r, name, r['fields'].get(name), new.get(name), conflicts, True)


def run_followup(args):
    path = Path(args.out)
    data = json.loads(path.read_text('utf-8'))
    targets = [r for r in data['companies'] if r['pass1']['result'] in ('careers_not_machine_readable', 'careers_unreadable') and r['pass1']['careers_url']]
    if args.only:
        targets = [r for r in targets if r['id'] in set(args.only.split(','))]
    fetcher, conflicts, started, now = Fetcher(), [], time.monotonic(), iso_now()
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for fut in [pool.submit(followup, r, fetcher, conflicts, now, now[:10]) for r in targets]:
            fut.result()
    won = [r for r in targets if r['pass1']['result'] in ('roles_found_board', 'roles_found_structured', 'board_empty')]
    summary = data['summary']
    data['conflicts'] = sorted(data['conflicts'] + conflicts, key=lambda x: (x['company_id'], x['field']))
    data['passes_run'] = sorted(set(data['passes_run']) | {'1b'}, key=str)
    data['summary'] = dict(summarise(data['companies'], data['conflicts'], {'verified': summary['hiring_true_before_backed_by_a_page'], 'flagged': summary['hiring_flagged_before']},
                                     summary['seconds'] + time.monotonic() - started, summary['requests_made'] + fetcher.requests))
    # the follow-up summary covers every company any follow-up run has touched, so a run on a few companies does not hide the rest
    touched = [r for r in data['companies'] if r['pass1'].get('followup')]
    resolved = ('roles_found_board', 'roles_found_structured', 'board_empty')
    won = [r for r in touched if r['pass1']['result'] in resolved and r['pass1']['followup']['result_before'] not in resolved]
    hosts = {}
    for r in touched:
        for h in r['pass1']['followup']['external_hosts']:
            hosts[h] = hosts.get(h, 0) + 1
    data['summary']['followup'] = {
        'careers_pages_re_read': len(touched), 'now_with_a_board_or_postings': len(won), 'requests_in_last_run': fetcher.requests,
        'companies': [r['id'] for r in won], 'external_hosts_on_careers_pages': dict(sorted(hosts.items(), key=lambda kv: -kv[1])[:40]),
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print_summary(data['summary'])
    print('\nPASS 1b:', len(targets), 'careers pages re-read this run;', len(touched), 'in all; now with a board or postings:', len(won), [r['id'] for r in won])
    print('third-party hosts on those careers pages:', data['summary']['followup']['external_hosts_on_careers_pages'])


# ---------------------------------------------------------------------------------------------- main
def selftest():
    r = Robots('User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.json$\nCrawl-delay: 5\n\nUser-agent: AUStartupMapBot\nDisallow: /nope\n')
    assert r.allowed('/private') and r.allowed('/a.json') and not r.allowed('/nope/x') and r.delay() is None, 'the bot group replaces *'
    r = Robots('User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.json$\nCrawl-delay: 5\n')
    assert not r.allowed('/private/x') and r.allowed('/private/ok') and not r.allowed('/a.json') and r.allowed('/a.jsonl') and r.delay() == 5.0
    assert Robots('User-agent: *\nDisallow:\n').allowed('/anything') and not Robots('User-agent: *\nDisallow: /\n').allowed('/x')
    ld = ['{"@graph":[{"@type":"Organization","address":{"@type":"PostalAddress","addressLocality":"Sydney","addressRegion":"NSW","postalCode":"2000","addressCountry":"AU"}}]}']
    assert jsonld_address(ld) == ('Sydney', 'NSW')
    assert jsonld_address(['{"@type":"Organization","address":{"addressLocality":"Austin","addressRegion":"TX","addressCountry":"US"}}']) is None
    assert jsonld_address(['{"@type":"Organization","address":{"addressLocality":"Seattle","addressRegion":"WA","postalCode":"98101"}}']) is None
    jobs = jsonld_jobs(['{"@type":"JobPosting","title":"Engineer","datePosted":"2026-10-01","jobLocation":{"address":{"addressLocality":"Perth","addressCountry":"AU"}},"url":"https://x.test/j"}',
                        '{"@type":"JobPosting","title":"Old","validThrough":"2020-01-01"}'], '2026-10-13')
    assert [j['title'] for j in jobs] == ['Engineer'] and jobs[0]['location'] == 'Perth, AU'
    boards = detect_boards(['<a href="https://jobs.lever.co/acme">', '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme-co">', 'https://api.example.com/jobs'])
    assert [(p['id'], t) for p, t in boards] == [('lever', 'acme'), ('greenhouse', 'acme-co')]
    co = {'id': 'x', 'name': 'X'}
    conflicts = []
    kept = merge(co, 'city', field('Sydney', 'a', 0.9, 't'), field('Melbourne', 'b', 0.8, 'u'), conflicts, False)
    assert kept['value'] == 'Sydney' and len(conflicts) == 1 and conflicts[0]['kept']['origin'] == 'existing'
    kept = merge(co, 'city', field('Sydney', 'a', 0.3, 't'), field('Melbourne', 'b', 0.8, 'u'), conflicts, False)
    assert kept['value'] == 'Melbourne' and len(conflicts) == 2
    assert merge(co, 'city', field('Sydney', 'a', 0.9, 't'), None, conflicts, False)['value'] == 'Sydney'
    kept = merge(co, 'hiring', field(True, 'a', 0.9, 't'), field(False, 'b', 0.6, 'u'), conflicts, True)
    assert kept['value'] is True and conflicts[-1]['field'] == 'hiring'
    assert blocked_reason('www.linkedin.com') and blocked_reason('example.com') is None
    assert clean_locality('Queensland') is None and clean_locality('QLD') is None and clean_locality('Australia') is None and clean_locality('Level 2, 29 Stewart St') is None
    assert clean_locality(' Collingwood ') == 'Collingwood'
    bh = _bamboohr({'result': [{'id': '53', 'jobOpeningName': 'Engineer', 'location': {'city': 'Acton', 'state': 'ACT'}, 'employmentStatusLabel': 'Full-Time', 'isRemote': None}]}, 'qb')
    assert bh[0]['title'] == 'Engineer' and bh[0]['apply_url'] == 'https://qb.bamboohr.com/careers/53' and bh[0]['location'] == 'Acton, ACT' and bh[0]['remote'] is None
    bz = _breezy([{'name': 'CSM', 'url': 'https://a.breezy.hr/p/1', 'published_date': '2026-10-09T08:23:13.404Z', 'type': {'name': 'Full-Time'},
                   'location': {'name': 'Sydney, NSW', 'is_remote': True}}], 'a')
    assert bz[0]['posted_at'] == '2026-10-09' and bz[0]['remote'] is True and bz[0]['employment_type'] == 'Full-Time'
    xml = ('<rss xmlns:tt="https://teamtailor.com/locations"><channel><item><title>Growth</title><pubDate>Wed, 30 Sep 2026 13:51:10 +1000</pubDate>'
           '<link>https://s.teamtailor.com/jobs/1</link><remoteStatus>fully</remoteStatus><tt:locations><tt:location><tt:city>Surry Hills</tt:city>'
           '<tt:country>Australia</tt:country></tt:location></tt:locations></item></channel></rss>')
    tt = _teamtailor(xml, 's')
    assert tt[0]['title'] == 'Growth' and tt[0]['posted_at'] == '2026-09-30' and tt[0]['remote'] is True and tt[0]['location'] == 'Surry Hills, Australia'
    try:
        _teamtailor('<!DOCTYPE x [<!ENTITY a "b">]><rss/>', 's')
        raise AssertionError('a DTD must be refused')
    except ValueError:
        pass
    found = detect_boards(['https://quantumbrilliance.bamboohr.com/careers/53', 'https://www.bamboohr.com/', 'https://d.breezy.hr/', 'https://assignar.breezy.hr/', 'https://safewill.teamtailor.com/jobs'], limit=5)
    assert [(p['id'], t) for p, t in found] == [('bamboohr', 'quantumbrilliance'), ('breezy', 'assignar'), ('teamtailor', 'safewill')]
    place = {'id': 'g', 'name': 'G', 'website': None}
    diag, new = observe(place, None, 't', '2026-10-13')
    assert diag['result'] == 'no_website' and new['suburb'] is None
    print('selftest ok')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--pass', dest='passes', default='1', choices=['1', '1b'], help='1: hiring, open jobs, city, state. 1b: follow up the careers pages Pass 1 could not read roles from')
    ap.add_argument('--only', help='comma-separated company ids')
    ap.add_argument('--limit', type=int)
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    ap.add_argument('--selftest', action='store_true')
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    if args.passes == '1b':
        return run_followup(args)

    companies = json.loads((DATA / 'startups.json').read_text('utf-8'))
    companies = companies if isinstance(companies, list) else companies.get('startups', [])
    jobs = json.loads((DATA / 'jobs.json').read_text('utf-8'))
    jobs = jobs if isinstance(jobs, list) else jobs.get('jobs', [])
    sources = json.loads((DATA / 'sources.json').read_text('utf-8'))
    sources = {s['id']: s for s in (sources if isinstance(sources, list) else sources.get('sources', []))}
    if args.only:
        wanted = set(args.only.split(','))
        companies = [c for c in companies if c['id'] in wanted]
    if args.limit:
        companies = companies[:args.limit]

    before = {'verified': sum(1 for c in companies if c.get('hiring_status') == 'hiring' and c.get('hiring_verified_at')),
              'flagged': sum(1 for c in companies if (c.get('hiring') or c.get('hiring_status') == 'hiring') and not c.get('hiring_verified_at'))}
    # the directory's cities: a city name that three or more companies already use (a suburb is not one)
    counts = {}
    for c in json.loads((DATA / 'startups.json').read_text('utf-8')):
        city = str(c.get('city') or '').strip().lower()
        if city and city != 'unknown':
            counts[city] = counts.get(city, 0) + 1
    known_cities = frozenset(city for city, n in counts.items() if n >= 3)
    fetcher, conflicts, results = Fetcher(), [], {}
    started, now = time.monotonic(), iso_now()
    today = now[:10]
    done = 0
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(enrich_company, c, jobs, sources, fetcher, conflicts, now, today, known_cities): c for c in companies}
        for fut in cf.as_completed(futures):
            c = futures[fut]
            try:
                results[c['id']] = fut.result()
            except Exception as err:  # one company must not stop the run; it is recorded as unreadable
                results[c['id']] = {'id': c['id'], 'name': c['name'], 'website': c.get('website'),
                                    'fields': {n: dict(NULL_FIELD) for n in FIELDS},
                                    'pass1': {'result': 'site_unreachable', 'refusal': f'script_error: {err}', 'home_final_url': None, 'careers_url': None, 'careers_found_by': None, 'boards': [], 'refused': [], 'pages_read': 0, 'role_count': None, 'notes': []}}
            done += 1
            if done % 20 == 0 or done == len(companies):
                print(f'  {done}/{len(companies)}  {c["name"]}: {results[c["id"]]["pass1"]["result"]}', flush=True)
    ordered = [results[c['id']] for c in companies]
    conflicts.sort(key=lambda x: (x['company_id'], x['field']))
    summary = summarise(ordered, conflicts, before, time.monotonic() - started, fetcher.requests)
    out = {
        '_readme': 'Pass 1 of the company enrichment: hiring, open_jobs, city, suburb, state. "suburb" holds a postal locality that is not one of the directory\'s cities. Every field is {value, source_url, confidence 0-1, last_verified_at}; null means unknown, never a guess. '
                   'A new value never replaced one of higher confidence; disagreements are in "conflicts". Nothing here has been merged into the site yet. See the top of enrich_companies.py for the rules and the confidence scale.',
        'generated_at': now, 'script': 'backend/scripts/enrich/enrich_companies.py', 'passes_run': [1], 'user_agent': UA,
        'summary': summary, 'companies': ordered, 'conflicts': conflicts,
    }
    Path(args.out).write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print_summary(summary)
    print(f'\nwrote {args.out}')


if __name__ == '__main__':
    main()
