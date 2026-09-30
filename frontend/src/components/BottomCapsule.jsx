export default function BottomCapsule({ pinnedCount, onShowList }) {
  return (
    <button className="bottom-capsule" onClick={onShowList}>
      Show list <strong className="bc-pinned">({pinnedCount})</strong> ↑
    </button>
  );
}
