export default function BottomCapsule({ pinnedCount, onShowList }) {
  return (
    <div className="bottom-capsule">
      <span><strong>{pinnedCount}</strong> startups pinned on map</span>
      <button onClick={onShowList}>Show list ↑</button>
    </div>
  );
}
