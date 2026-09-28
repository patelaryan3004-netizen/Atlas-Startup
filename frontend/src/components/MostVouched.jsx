export default function MostVouched({ startups }) {
  const vouched = startups
    .filter((s) => s.vouches?.length > 0)
    .sort((a, b) => b.vouches.length - a.vouches.length);

  if (!vouched.length) return null;

  return (
    <div id="mostVouched">
      <h2>Most Vouched</h2>
      <ol id="mostVouchedList">
        {vouched.map((s) => (
          <li key={s.name}>
            <span>{s.name}</span>
            <b>{s.vouches.length}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}
