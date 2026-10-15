import { useMemo } from 'react';
import { vcFirms } from '../../mapPins.js';
import EntityCard, { Avatar } from '../EntityCard.jsx';

// The List view with only the VCs on: the investors the map would draw, one card each, in name order. Each is a way into the investor's page. An
// investor whose record gives no city we can place (a country, or a suburb) is not drawn on the map and is not here either; they are counted and
// the directory has them all.
// pins: the items of /api/investors/pins; unplaced: how many more match the search and filters but have no city to be placed at.
export default function VcList({ pins, unplaced = 0, where, onOpen, onOpenDirectory }) {
  const firms = useMemo(() => vcFirms(pins), [pins]);
  return (
    <div id="vcListView" className="vl">
      <h2 className="vl-title">{firms.length} venture capital {firms.length === 1 ? 'firm' : 'firms'} in {where}</h2>
      {firms.length === 0 && <p className="vl-note">No venture capital firm with a city on file matches. Try another city, or clear the search.</p>}
      <ul className="vl-grid">
        {firms.map((firm) => (
          <EntityCard
            as="li"
            key={firm.slug}
            className="vl-card"
            avatar={<Avatar name={firm.name} domain={firm.domain} size={44} />}
            name={<button type="button" className="vl-open" onClick={() => onOpen(firm.slug)}>{firm.name}</button>}
            meta={[[...new Set(firm.places)].join(', '), firm.stages.join(' · '), firm.sectors.slice(0, 3).join(' · ')]}
            metaLabel={`${firm.name}: places, stages, focus`}
          />
        ))}
      </ul>
      {unplaced > 0 && (
        <p className="vl-note">
          {unplaced} more {unplaced === 1 ? 'investor matches' : 'investors match'} but {unplaced === 1 ? 'has' : 'have'} no city we can place (the record gives a country or a suburb), so {unplaced === 1 ? 'it is' : 'they are'} not on the map.{' '}
          <button type="button" className="linkbtn" onClick={onOpenDirectory}>See every investor in the directory</button>
        </p>
      )}
    </div>
  );
}
