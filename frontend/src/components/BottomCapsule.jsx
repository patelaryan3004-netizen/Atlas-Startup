export default function BottomCapsule({ pinnedCount, hiringCount, onShowList }) {
  return (
    <div className="bottom-capsule">
      <span>
        <strong className="bc-pinned">{pinnedCount}</strong> pinned
        {hiringCount > 0 && (
          <>
            <span className="tag-sep">·</span>
            <strong className="bc-hiring">{hiringCount}</strong> hiring
          </>
        )}
      </span>
      <button onClick={onShowList}>Show list ↑</button>
    </div>
  );
}
