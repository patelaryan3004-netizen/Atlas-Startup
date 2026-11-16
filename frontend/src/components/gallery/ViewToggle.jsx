import { Segmented } from '../brand/parts.jsx';
import { MapIcon, GridIcon } from '../explore/icons.jsx';

// The switch between the two ways of looking at the same startups: the map and the gallery. They share the one set of filters (the city, the sector, the
// search ...), so changing the view never changes which startups are being looked at.
const OPTIONS = [
  { id: 'map', label: 'Map', icon: <MapIcon size={18} /> },
  { id: 'gallery', label: 'Gallery', icon: <GridIcon size={18} /> },
];

export default function ViewToggle({ value, onChange, className = '' }) {
  return <Segmented className={className ? `gl-view ${className}` : 'gl-view'} label="How the startups are shown" options={OPTIONS} value={value} onChange={onChange} />;
}
