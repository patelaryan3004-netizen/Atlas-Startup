import SearchBar from '../SearchBar.jsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';

// The top of the Explore page: the heading, one line about the site, and the main search beside them. The one italic word is the green of the
// buttons. The hints under the search are real searches: each puts its word in the box (they are industries the directory has).
const TRY = ['fintech', 'climate', 'cybersecurity'];

export default function ExploreHero({ filters, onApplyFilters, entity = 'all' }) {
  const wide = useMediaQuery('(min-width: 640px)', true);
  const placeholder = wide
    ? (entity === 'vcs' ? 'Search investors' : entity === 'startups' ? 'Search companies or industries' : 'Search companies, investors or industries')
    : (entity === 'vcs' ? 'Search investors' : entity === 'startups' ? 'Search startups' : 'Search startups or investors');
  return (
    <section className="xhero" aria-labelledby="xhero-title">
      <div className="xhero-copy">
        <p className="kicker">Australia&rsquo;s startup community</p>
        <h1 id="xhero-title" className="display">Find your <em>people.</em></h1>
        <p className="lede">Discover the startups, investors and teams shaping Australia.</p>
      </div>
      <div className="xhero-search">
        <SearchBar large filters={filters} onApplyFilters={onApplyFilters} placeholder={placeholder} />
        <p className="xhero-try">
          Try{' '}
          {TRY.map((word, i) => (
            <span key={word}>
              {i > 0 && (i === TRY.length - 1 ? ' or ' : ', ')}
              <button type="button" className="xhero-hint" onClick={() => onApplyFilters({ search: word })}>{word}</button>
            </span>
          ))}
          .
        </p>
      </div>
    </section>
  );
}
