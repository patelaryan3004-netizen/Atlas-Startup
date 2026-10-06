// The oldest companies among the current results: { total, items: [{ name, foundedYear }] }, the oldest first.
// The server sends the oldest hundred and how many there are in all, so the list stays short however big the directory is.
export default function NotableStartups({ notable }) {
  const items = notable?.items ?? [];
  if (!items.length) return null;

  return (
    <>
      <ol id="notableList">
        {items.map((s) => (
          <li key={s.slug || s.name}>
            <span>{s.name}</span>
            <b>{s.foundedYear}</b>
          </li>
        ))}
      </ol>
      {notable.total > items.length && <p className="fdrawer-empty">The {items.length} oldest of {notable.total}.</p>}
    </>
  );
}
