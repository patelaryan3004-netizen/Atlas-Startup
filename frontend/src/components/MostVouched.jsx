// The most vouched-for companies among the current results: { total, items: [{ name, vouches }] }, most first.
export default function MostVouched({ vouched }) {
  const items = vouched?.items ?? [];
  if (!items.length) return null;

  return (
    <>
      <ol id="mostVouchedList">
        {items.map((s) => (
          <li key={s.slug || s.name}>
            <span>{s.name}</span>
            <b>{s.vouches}</b>
          </li>
        ))}
      </ol>
      {vouched.total > items.length && <p className="fdrawer-empty">The {items.length} most vouched of {vouched.total}.</p>}
    </>
  );
}
