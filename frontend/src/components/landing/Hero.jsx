import Wordmark from '../brand/Wordmark.jsx';
import Constellation from './Constellation.jsx';
import SubscribeForm from './SubscribeForm.jsx';
import { HOME_PATH, MAP_PATH } from '../../paths.js';
import { appPath } from '../../appRoute.js';
import { showPeople } from '../../flags.js';
import { BRAND } from '../../brand.js';

// Where the places of the capsule go. People is the people page when it is switched on, and the investors' directory (the one directory of people
// that is live) while it is not; Companies is the list of startups; Map is the map page; Our story is About.
export const navLinks = (people = showPeople()) => [
  ['People', people ? appPath({ kind: 'people' }) : '/investors'],
  ['Companies', '/discover'],
  ['Map', MAP_PATH],
  ['Our story', '/about'],
];

// The slim capsule across the top of the night sky. On a wide screen the brand, the three places and the two ways in are in a row; on a phone the places
// fold into a menu (a <details>, which works with no script) and "Join us" stays beside it. "Log in" goes to the sign-up at the foot of the page, which says
// that accounts are not open yet: there is no log-in to go to.
export function NavCapsule() {
  const links = navLinks();
  return (
    <nav className="se-nav" aria-label="Main">
      <a className="se-nav-brand" href={HOME_PATH} aria-label={`${BRAND.name}, home`}><Wordmark /></a>
      <ul className="se-nav-links">
        {links.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}
      </ul>
      <div className="se-nav-end">
        <a className="se-nav-login" href="#login">Log in</a>
        <a className="se-nav-join" href="#join">Join us</a>
        <details className="se-nav-menu">
          <summary aria-label="Menu"><span className="se-burger" aria-hidden="true" /></summary>
          <ul>
            {links.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}
            <li><a href="#login">Log in</a></li>
          </ul>
        </details>
      </div>
    </nav>
  );
}

// The opening: a night sky over Australia with a person looking up (a background picture with no words in it), the capsule, the headline, the email
// field, two lines, the way in with no sign-up, and the name of the community at the foot. Every word on it is live text over the picture.
export default function Hero() {
  return (
    <header className="se-hero" id="top">
      <picture className="se-hero-art">
        <source media="(max-width: 700px)" srcSet="/img/hero-night-sm.webp" width="1312" height="2158" />
        <img src="/img/hero-night.webp" width="3200" height="2158" alt="" fetchPriority="high" decoding="async" />
      </picture>
      <div className="se-hero-shade" aria-hidden="true" />
      <Constellation className="se-hero-constellation" />
      <NavCapsule />
      <div className="se-hero-body">
        <h1 className="se-hero-title" id="se-title">
          The next big thing<br />
          is <em>someone<span className="se-stop">.</span></em>
        </h1>
        <SubscribeForm variant="hero" source="hero" />
        <p className="se-hero-copy">
          Join our feed for fresh ideas, meaningful connections,{' '}
          <br className="se-br" />and a shared journey through what comes next.
        </p>
        <a className="se-ghost-btn" href={MAP_PATH}>Explore the community</a>
      </div>
      <p className="se-hero-caption">{BRAND.tagline}</p>
    </header>
  );
}
