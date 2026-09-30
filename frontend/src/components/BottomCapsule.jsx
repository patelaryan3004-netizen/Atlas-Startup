export default function BottomCapsule({ pinnedCount, viewMode, onSetViewMode }) {
  return (
    <div className="bottom-capsule">
      <button
        className={viewMode === 'map' ? 'bc-tab bc-tab-active' : 'bc-tab'}
        onClick={() => onSetViewMode('map')}
      >
        Map
      </button>
      <button
        className={viewMode === 'list' ? 'bc-tab bc-tab-active' : 'bc-tab'}
        onClick={() => onSetViewMode('list')}
      >
        List <strong className="bc-pinned">({pinnedCount})</strong>
      </button>
    </div>
  );
}
