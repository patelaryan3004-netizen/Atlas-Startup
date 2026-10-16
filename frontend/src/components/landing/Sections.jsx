import { useEffect, useState } from 'react';
import Reveal from '../Reveal.jsx';
import Wordmark from '../brand/Wordmark.jsx';
import SubscribeForm from './SubscribeForm.jsx';
import { Preview, PreviewNote, DiscoveryCard, CollaboratePanel, PortfolioPreview, ProfileStack, CollectionLinks, SavedCollection, RoleCard, UploadCard, MessageCard } from './previews.jsx';
import { ArrowRight } from '../explore/icons.jsx';
import { MAP_PATH, HOME_PATH } from '../../paths.js';

// The sections of the welcome page after the opening, in the order of the design. Each one's words are real; each product picture inside is a preview
// (previews.jsx) with a sentence for a screen reader and a note, in words, that it is illustrative.

// 2. The yellow introduction.
export function CommunitySection() {
  return (
    <section className="se-intro" aria-labelledby="se-intro-title">
      <div className="se-intro-panel">
        <Reveal className="se-intro-copy">
          <p className="se-eyebrow">Good things start with people</p>
          <h2 id="se-intro-title" className="se-h2">Find your people.<br />Start something.</h2>
          <p className="se-intro-text">Meet founders, operators and investors.<br />Discover what they’re building—and where you could fit in.</p>
          <a className="se-green-btn" href={MAP_PATH}>Explore the community <ArrowRight size={18} /></a>
        </Reveal>
        <Reveal className="se-intro-art" index={1}>
          <p className="sr-only">An illustration of the community: a search across people, startups and investors, one person’s profile with a piece of their work, and a small panel for saying what you are open to.</p>
          <Preview className="wp-intro-stack">
            <DiscoveryCard />
            <CollaboratePanel />
          </Preview>
        </Reveal>
        <PreviewNote className="se-intro-note">Preview: the names and the work are illustrations.</PreviewNote>
      </div>
    </section>
  );
}

// 3. The editorial showcase: a heading, and four panels of different sizes.
export function ShowcaseSection() {
  return (
    <section className="se-showcase" aria-labelledby="se-show-title">
      <Reveal className="se-show-head">
        <h2 id="se-show-title" className="se-display">Make room for<br />what you <em>could</em> become<span className="se-stop">.</span></h2>
        <p className="se-show-sub">Your work, your interests, and the people you build with.</p>
      </Reveal>
      <div className="se-bento">
        <Reveal as="article" className="se-tile se-tile-work">
          <h3 className="se-tile-title">Let your work introduce you.</h3>
          <p className="sr-only">An illustration of a portfolio with tabs for projects, work history and collaborators, and two work samples.</p>
          <Preview><PortfolioPreview /></Preview>
        </Reveal>
        <Reveal as="article" className="se-tile se-tile-people" index={1}>
          <h3 className="se-tile-title">Meet people<br />worth knowing.</h3>
          <p className="sr-only">An illustration of three profiles: a founder, an operator and an investor.</p>
          <Preview><ProfileStack /></Preview>
        </Reveal>
        <Reveal as="article" className="se-tile se-tile-follow" index={1}>
          <h3 className="se-tile-title">Follow<br />your curiosity.</h3>
          <p className="sr-only">An illustration of three collections to follow: climate builders, first startup roles, and people to watch.</p>
          <Preview><CollectionLinks /></Preview>
        </Reveal>
        <Reveal as="article" className="se-tile se-tile-keep" index={2}>
          <h3 className="se-tile-title">Keep your best<br />discoveries.</h3>
          <p className="sr-only">An illustration of a private saved collection called My next chapter, with two people in it.</p>
          <Preview><SavedCollection /></Preview>
        </Reveal>
      </div>
      <PreviewNote className="se-show-note">Preview: the names, the work and the pictures are illustrations.</PreviewNote>
    </section>
  );
}

// 4. Hiring: what is coming next, and not yet there. The three stages are an ordered list (the words are real); the cards inside them are a preview.
export function HiringSection() {
  const stages = [
    { n: 1, title: 'Explore the role', text: 'Find opportunities that match your skills and interests.', card: <RoleCard /> },
    { n: 2, title: 'Share a work sample', text: 'Show us how you think. It can be a past project or new idea.', card: <UploadCard /> },
    { n: 3, title: 'Meet the founder', text: 'If there’s a fit, you’ll be invited for a conversation.', card: <MessageCard /> },
  ];
  return (
    <section className="se-hiring" aria-labelledby="se-hire-title">
      <div className="se-hiring-panel">
        <Reveal className="se-hiring-copy">
          <p className="se-eyebrow se-eyebrow-green">Hiring · Coming next</p>
          <h2 id="se-hire-title" className="se-h2">Show your work.<br />Meet the founder.</h2>
          <p className="se-hiring-text">Small, relevant work samples. Useful feedback.<br />A conversation with the people building the company.</p>
        </Reveal>
        <Reveal className="se-steps-wrap" index={1}>
          <ol className="se-steps" aria-label="How hiring will work. Coming next: not available yet.">
            {stages.map((stage) => (
              <li className="se-step" key={stage.n}>
                <span className="se-step-head">
                  <span className="se-step-n" aria-hidden="true">{stage.n}</span>
                  <span><b className="se-step-title">{stage.title}</b><span className="se-step-text">{stage.text}</span></span>
                </span>
                <Preview className="se-step-card">{stage.card}</Preview>
              </li>
            ))}
          </ol>
          <PreviewNote>Coming next, not live yet: the buttons in these previews do nothing, and no application or message can be sent.</PreviewNote>
        </Reveal>
      </div>
    </section>
  );
}

// "Privacy" at the foot opens a short note: with a script it opens on #privacy, and with none the note is one tap away (a <details>).
function useOpenOnHash(id) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const read = () => setOpen(window.location.hash === `#${id}`);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [id]);
  return open;
}

// 5. The updates sign-up.
export function UpdatesSection() {
  return (
    <>
      <section className="se-updates" id="join" aria-labelledby="se-updates-title">
        <Reveal>
          <h2 id="se-updates-title" className="se-display se-updates-title">Stay inspired. Keep building.</h2>
          <p className="se-updates-sub">Fresh projects. People to know. Opportunities to start.</p>
        </Reveal>
        <Reveal index={1} className="se-updates-form">
          <p className="se-login-note" id="login" tabIndex={-1}>Accounts are not open yet, so there is nothing to log in to. Leave your email below and we will tell you when they are.</p>
          <SubscribeForm variant="footer" source="footer" />
          <p className="se-feed">
            <a href="/news">Explore the feed <ArrowRight size={16} /></a>
            <span className="se-feed-note">The community feed is still being built. The news feed is live.</span>
          </p>
        </Reveal>
      </section>
    </>
  );
}

// The foot of the page: the wordmark, three links, the label that says the page is a preview, and a note on privacy.
export function WelcomeFooter() {
  const privacyOpen = useOpenOnHash('privacy');
  return (
    <>
      <footer className="se-footer">
        <div className="se-footer-row">
          <a className="se-footer-brand" href={HOME_PATH} aria-label="Still Early, home"><Wordmark /></a>
          <nav className="se-footer-links" aria-label="Footer">
            <a href="/about">About</a>
            <a href="/contact">Contact</a>
            <a href="#privacy">Privacy</a>
            <span className="se-footer-rule" aria-hidden="true" />
            <span className="se-footer-label">Product preview · Illustrative content</span>
          </nav>
        </div>
        <details className="se-privacy" id="privacy" open={privacyOpen || undefined}>
          <summary>Privacy</summary>
          <p>
            The email address you leave on this page is sent to this site’s own server and kept to tell you about Still Early, and for nothing else. The forms
            to submit a company or suggest an edit send what you type to a person who reads it. No account, no tracking cookies, no analytics.
          </p>
        </details>
      </footer>
    </>
  );
}
