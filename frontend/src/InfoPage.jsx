import SiteHeader from './components/brand/SiteHeader.jsx';
import LandingFooter from './components/landing/LandingFooter.jsx';
import { CONTACT_URL, isConfigured, embedUrl } from './tally.js';
import { LINKEDIN_URL } from './siteMeta.js';
import './landing.css';
import './info.css';

// The three plain pages that say who runs the site, how it checks what it shows, and how to reach the person who does. They are written to
// be short and true: nothing here claims a result, a number or a partner the site does not have, and the numbers that change (how many
// companies, when it was last updated) are not written here at all: the landing page and the cards show them from the data.
//
// Each is also pre-rendered (scripts/prerender.mjs), so the text is in the page before any script runs.

function About() {
  return (
    <>
      <p className="info-lede">
        AU Startup Map is run by Aryan, a Monash University student who builds it alone. It exists because founders ghost good candidates, and
        because Australian startups are hard to find in one place.
      </p>
      <p>
        Live now: a map and a list of startups, each with where its facts came from and when they were checked; a jobs board read from companies&rsquo;
        own pages; a directory of investors; curated lists; and forms to submit a startup or suggest a correction, which a person reads before
        anything changes.
      </p>
      <p>
        Not yet: accounts, a page of people worth following (built, and switched off until the people on it have been told), and task-gated
        applications (a concept preview, not a product).
      </p>
      <p>This is a beta, independent project, not affiliated with any company listed.</p>
      <p className="info-links">
        <a href="/contact">Contact</a> &middot; <a href="/methodology">How we verify</a> &middot;{' '}
        <a href={LINKEDIN_URL} rel="noopener noreferrer" target="_blank">Aryan on LinkedIn</a>
      </p>
    </>
  );
}

function Methodology() {
  return (
    <>
      <p className="info-lede">
        A fact on this site is marked as checked only when it was read from the company&rsquo;s own pages. Here is what that means, how often it
        happens, and how to get something changed.
      </p>
      <h2>Where facts are read from</h2>
      <p>
        The company&rsquo;s own website, its careers page, and the public job boards it links to. For investors, their own site. Names found
        on press or portfolio pages are leads to look at, not facts. We do not scrape LinkedIn or Crunchbase, and nothing is copied from them.
      </p>
      <h2>What the labels mean</h2>
      <dl className="info-terms">
        <div>
          <dt>Verified &lt;date&gt;</dt>
          <dd>
            The day the company&rsquo;s own pages were last read and agreed with what the card shows. It is the date of that reading, not a
            promise that nothing has changed since. After 60 days the card says &ldquo;Needs re-check&rdquo;.
          </dd>
        </div>
        <div>
          <dt>Hiring now</dt>
          <dd>A job board or structured postings on the company&rsquo;s own page confirmed its open roles in the last 14 days.</dd>
        </div>
        <div>
          <dt>Hiring (checked &lt;date&gt;)</dt>
          <dd>Roles were read on that earlier day, so the card says the day and does not say &ldquo;now&rdquo;.</dd>
        </div>
        <div>
          <dt>Roles unverified</dt>
          <dd>Nobody has read a job page for this company, or none could be read. The card makes no claim about hiring.</dd>
        </div>
        <div>
          <dt>Unverified</dt>
          <dd>
            The company could not be confirmed from its own pages, for example a real Australian base. It is flagged rather than guessed, and
            listed under &ldquo;Unconfirmed&rdquo; in the menu.
          </dd>
        </div>
      </dl>
      <h2>How often</h2>
      <p>
        There is no automatic schedule yet. A person starts the checks by hand, in batches, and every card shows its own date. The &ldquo;Updated&rdquo;
        date on the landing page is the most recent check across the whole directory.
      </p>
      <h2>Corrections and removal</h2>
      <p>
        Use &ldquo;Suggest an edit&rdquo; on a company&rsquo;s page, or the <a href="/contact">contact page</a> for anything else, including a request
        to remove a company, an investor or a person. A person reads every request and checks it against a page; nothing changes before that.
      </p>
      <h2>What is not collected</h2>
      <p>
        No LinkedIn or Crunchbase scraping. No accounts, no tracking cookies and no analytics. What you type into a form goes to a person who
        reads it, and is used for nothing else.
      </p>
    </>
  );
}

function Contact() {
  const configured = isConfigured(CONTACT_URL);
  return (
    <>
      <p className="info-lede">Send a correction, a removal request or a question. A person reads every message.</p>
      {configured ? (
        <iframe className="info-form" src={embedUrl(CONTACT_URL)} title="Contact form" loading="lazy" />
      ) : (
        <p className="info-notice" role="status">
          The contact form is not set up yet. Until it is, use &ldquo;Suggest an edit&rdquo; on a company&rsquo;s page for a correction, or
          &ldquo;Submit a startup&rdquo; to add one.
        </p>
      )}
      <p>
        How requests are handled is on <a href="/methodology">how we verify</a>; who runs the site is on <a href="/about">about</a>.
      </p>
    </>
  );
}

// The pages by name: the heading and the text.
export const INFO_PAGES = {
  about: { name: 'About', heading: 'About AU Startup Map', Body: About },
  methodology: { name: 'Methodology', heading: 'How we verify', Body: Methodology },
  contact: { name: 'Contact', heading: 'Contact', Body: Contact },
};

export default function InfoPage({ page }) {
  const { heading, Body } = INFO_PAGES[page];
  return (
    <div className="landing info-page">
      <a className="landing-skip" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main" className="info-main">
        <article className="l-grid info-article">
          <h1 className="serif-h1">{heading}</h1>
          <div className="info-body">
            <Body />
          </div>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
