// The busiest cities among the current results: [{ city, count }], worked out by the server.
export default function Leaderboard({ cities = [] }) {
  return (
    <ol id="leaderboardList">
      {cities.map(({ city, count }) => (
        <li key={city}>
          <span>{city}</span>
          <b>{count}</b>
        </li>
      ))}
    </ol>
  );
}
