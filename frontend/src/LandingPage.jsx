import Hero from './components/landing/Hero.jsx';
import { CommunitySection, ShowcaseSection, HiringSection, UpdatesSection, WelcomeFooter } from './components/landing/Sections.jsx';
import './welcome.css';

// The welcome page (/welcome): the night sky and the opening, then four sections in the order of the approved design: the yellow introduction, the editorial
// showcase, the hiring preview, and the updates sign-up with the foot. It reads nothing from the server on load: its words are fixed, its product pictures are
// previews (components/landing/previews.jsx) and its two email forms send an address only when a visitor submits one (hooks/useSubscribe.js). So the HTML the
// build writes (scripts/prerender.mjs) is exactly what the browser draws first, and the browser hydrates it.
export default function LandingPage() {
  return (
    <div className="se">
      <a className="se-skip" href="#main">Skip to content</a>
      <Hero />
      <main id="main" tabIndex={-1}>
        <CommunitySection />
        <ShowcaseSection />
        <HiringSection />
        <UpdatesSection />
      </main>
      <WelcomeFooter />
    </div>
  );
}
