// The cities with the most startups, as one tap each: the map flies to the city and everything else (the list, the counts, the search) narrows
// to it. The city that is chosen is lit, and pressing it again goes back to all of Australia. The cities and their counts are the directory's own.
export default function CityDock({ cities, selected, onSelect }) {
  if (!cities.length) return null;
  return (
    <nav className="xd" aria-label="Explore cities">
      <span className="xd-label">Explore cities</span>
      <ul className="xd-list">
        {cities.map(({ city, count }) => {
          const on = selected.includes(city);
          return (
            <li key={city}>
              <button
                type="button"
                className={on ? 'xd-city xd-city-on' : 'xd-city'}
                aria-pressed={on}
                title={count != null ? `${count} ${count === 1 ? 'startup' : 'startups'}` : undefined}
                onClick={() => onSelect(city)}
              >
                {city}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
