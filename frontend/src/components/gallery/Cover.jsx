import { useState } from 'react';
import { Avatar } from '../EntityCard.jsx';

// The picture a card in the gallery leads with. Two things only, and neither is made up:
//  1. the company's own cover: the preview picture its own website names for itself, kept on this site (backend/scripts/covers), drawn at 16:9;
//  2. with none (or one that fails to load), the company's real logo, large and centred, on a quiet neutral tile, with its first letter under the logo until the logo arrives.
// There is no stock picture, no generated one and no shared placeholder: a company without a cover is drawn the same way as every other one without, and is still in the gallery.
// (720 by 405 is the size the pictures are made at, backend/scripts/covers/collect.mjs: the tag says it, so the page does not move as they arrive.)

export function CoverFallback({ name, website = null }) {
  return (
    <span className="gc-fallback" aria-hidden="true">
      <Avatar name={name} website={website} size={64} className="gc-logo" />
    </span>
  );
}

export default function Cover({ name, website = null, cover = null }) {
  const [failed, setFailed] = useState(false);
  if (cover && !failed) {
    return (
      <img
        className="gc-img"
        src={cover}
        width="720"
        height="405"
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }
  return <CoverFallback name={name} website={website} />;
}
