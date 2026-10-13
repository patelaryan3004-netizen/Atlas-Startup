// The id a card is given so the index can reach it: "company-canva", "investor-airtree".
export const cardId = (kind, key) => `${kind}-${String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

// The names on a list, as links to their cards, in a short row near the top of the list (a table of contents). A list of fewer than
// two has nothing to find, so it has no index; one longer than `max` shows the first and says how many more there are.
export default function IndexRow({ items, label = 'Index', what = 'this list', max = 10 }) {
  if (!items || items.length < 2) return null;
  const shown = items.slice(0, max);

  // The cards sit in a scrolling panel, so the link moves the panel to the card (gently, unless motion is not wanted) and puts the
  // keyboard on it, rather than changing the address.
  const jump = (event, id) => {
    const card = document.getElementById(id);
    if (!card) return;
    event.preventDefault();
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    card.focus({ preventScroll: true });
  };

  return (
    <nav className="index-row" aria-label={`Index of ${what}`}>
      <span className="index-row-label">{label}</span>
      <ul>
        {shown.map((item) => (
          <li key={item.id}><a href={`#${item.id}`} aria-label={`Jump to ${item.name}`} onClick={(event) => jump(event, item.id)}>{item.name}</a></li>
        ))}
      </ul>
      {items.length > shown.length && <span className="index-row-more">+{items.length - shown.length} more</span>}
    </nav>
  );
}
