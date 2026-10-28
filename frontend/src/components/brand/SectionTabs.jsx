import { linkProps } from './nav.js';

// The tabs inside a place: People | Startups | Investors under Discover, Jobs | Events under Opportunities. They are links (each has an address of its own), and the
// one the page is on says so. `go` takes over a link the app can follow without loading the page again.
export default function SectionTabs({ label, tabs, active, go = {}, className = '' }) {
  return (
    <nav className={`st${className ? ` ${className}` : ''}`} aria-label={label}>
      <ul className="st-list">
        {tabs.map(({ id, label: text, href }) => {
          return (
            <li key={id}>
              <a
                className="st-tab"
                aria-current={active === id ? 'page' : undefined}
                {...linkProps(href, go[id])}
              >
                {text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
