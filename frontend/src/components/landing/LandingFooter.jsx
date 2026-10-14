import { useEffect, useState } from 'react';
import { DIRECTORY_URL } from '../../api.js';
import { appPath } from '../../appRoute.js';
import { MAP_PATH } from '../../paths.js';
import { LINKEDIN_URL } from '../../siteMeta.js';
import { showPeople } from '../../flags.js';

// Four short columns of links: where to go, the directory's other pages, how to take part, and what to trust. Each link is a real
// address in the app; a column never holds more than five.
// The People link and "Nominate someone" are there only with VITE_SHOW_PEOPLE (flags.js): without it there is no People page to go to.
export const footerColumns = (people = showPeople()) => [
  { title: 'Explore', links: [['Map', MAP_PATH], ['List', '/?view=list'], ...(people ? [['People', appPath({ kind: 'people' })]] : []), ['Lists', appPath({ kind: 'lists' })], ['Jobs', appPath({ kind: 'jobs' })]] },
  { title: 'Directory', links: [['Investors', '/investors'], ['News', appPath({ kind: 'news' })], ['Full list, no JavaScript', DIRECTORY_URL]] },
  { title: 'Take part', links: [['Submit a startup', '/?view=submit'], ['Join waitlist', '/?view=waitlist'], ...(people ? [['Nominate someone', appPath({ kind: 'people' })]] : [])] },
  { title: 'Trust', links: [['Methodology', '/methodology'], ['About', '/about'], ['Contact', '/contact'], ['Privacy', '#privacy'], ['Terms', '#terms']] },
];

// The two legal notes are short and closed until asked for: a link to #privacy or #terms opens its note.
function useOpenOnHash(ids) {
  const read = () => (typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, ''));
  const [hash, setHash] = useState(''); // read after the page is up: the first render is the same on the server (pre-rendered) and in the browser
  useEffect(() => {
    setHash(read());
    const onChange = () => setHash(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return (id) => ids.includes(id) && hash === id;
}

export default function LandingFooter() {
  const opened = useOpenOnHash(['privacy', 'terms']);
  return (
    <footer className="landing-footer">
      <nav className="footer-columns" aria-label="Footer">
        {footerColumns().map((column) => (
          <div className="footer-column" key={column.title}>
            <h2 className="footer-title">{column.title}</h2>
            <ul>
              {column.links.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}
            </ul>
          </div>
        ))}
      </nav>

      <div className="footer-legal">
        <details id="privacy" open={opened('privacy') || undefined}>
          <summary>Privacy</summary>
          <p>
            The submit, edit and nomination forms send what you type to a person who reads it, and we use it for nothing else. The waitlist is
            a form hosted by Tally and loads only when you open it. No account, no tracking cookies, no analytics.
          </p>
          <p>Who runs this is on the <a href="/about">About</a> page, and messages go through the <a href="/contact">Contact</a> page. No business registration details are published yet.</p>
        </details>
        <details id="terms" open={opened('terms') || undefined}>
          <summary>Terms</summary>
          <p>
            A best-effort directory from public pages and reviewed submissions. It can be wrong or out of date, and links to company sites and
            job pages lead to places we do not control. Names and logos belong to their owners and are shown to identify them. Draft: not yet
            reviewed by a lawyer.
          </p>
        </details>
      </div>

      <p className="footer-built">Built by Aryan &middot; Monash University &middot; <a href={LINKEDIN_URL} rel="noopener noreferrer" target="_blank">LinkedIn</a></p>
      <p className="footer-note">A beta, independent project: not affiliated with any company listed.</p>
    </footer>
  );
}
