import { Segmented } from '../brand/parts.jsx';
import { MapIcon, GridIcon } from '../explore/icons.jsx';

// The switch between the two ways of looking at the same startups: the map and the gallery. They share the one set of filters (the city, the sector, the
// search ...), so changing the view never changes which startups are being looked at.
// A list that was opened from the map ("View list") has the way back in the switch's own words: "Back to map" (the map is as it was: the same city and filters).
export default function ViewToggle({ value, onChange, className = '', mapLabel = 'Map' }) {
  const options = [
    { id: 'map', label: mapLabel, icon: <MapIcon size={18} /> },
    { id: 'gallery', label: 'Gallery', icon: <GridIcon size={18} /> },
  ];
  return <Segmented className={className ? `gl-view ${className}` : 'gl-view'} label="How the startups are shown" options={options} value={value} onChange={onChange} />;
}
