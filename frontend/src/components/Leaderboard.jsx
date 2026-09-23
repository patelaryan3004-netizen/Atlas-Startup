const TOP_N = 8;

export default function Leaderboard({ startups }) {
  const counts = {};
  startups.forEach((s) => {
    counts[s.city] = (counts[s.city] || 0) + 1;
  });
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N);

  return (
    <div id="leaderboard">
      <h2>City Leaderboard</h2>
      <ol id="leaderboardList">
        {sorted.map(([city, n]) => (
          <li key={city}>
            <span>{city}</span>
            <b>{n}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}
