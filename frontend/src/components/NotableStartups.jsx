export default function NotableStartups({ startups }) {
  const notable = startups
    .filter((s) => s.foundedYear)
    .sort((a, b) => a.foundedYear - b.foundedYear);

  if (!notable.length) return null;

  return (
    <div id="notable">
      <h2>Notable AU Startups</h2>
      <ol id="notableList">
        {notable.map((s) => (
          <li key={s.name}>
            <span>{s.name}</span>
            <b>{s.foundedYear}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}
