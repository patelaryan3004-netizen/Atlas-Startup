import { NavigateIcon } from './icons.jsx';

// The way back to the whole country, on the map's bottom left: it clears the city and brings all of Australia into view. It is there only when the
// map is on a city, or has been zoomed in; on all of Australia there is nothing to go back to.
export default function AllAustralia({ onClick }) {
  return (
    <button type="button" className="xr" onClick={onClick}>
      <NavigateIcon size={20} />
      <span>All Australia</span>
    </button>
  );
}
