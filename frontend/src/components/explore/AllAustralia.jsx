import { NavigateIcon, ArrowLeft } from './icons.jsx';

// The way back to the whole country, on the map's bottom left: it clears the city and brings all of Australia into view. It is there only when the
// map is on a city, or has been zoomed in; on all of Australia there is nothing to go back to. On the map page ("atlas") it reads as an arrow and the words
// "All Australia"; the filters other than the city are left as they are.
export default function AllAustralia({ onClick, atlas = false }) {
  return (
    <button type="button" className={atlas ? 'xr xr-atlas' : 'xr'} onClick={onClick}>
      {atlas ? <ArrowLeft size={20} /> : <NavigateIcon size={20} />}
      <span>All Australia</span>
    </button>
  );
}
