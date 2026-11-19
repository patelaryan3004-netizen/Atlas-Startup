import GalleryHead from './GalleryHead.jsx';
import GalleryToolbar from './GalleryToolbar.jsx';

// The gallery page (Discover's startups, as a gallery): the head with the switch to the map, the bar of search and filters, and the gallery itself under it
// (`children`: the list, or the investors when only they are shown). The page scrolls as a whole, so the browser keeps the place in it and the header stays
// above it. Everything it shows is the app's one set of filters (App.jsx): nothing is kept here.
export default function GalleryPage({ onView, fromMap = false, banner = null, children, ...bar }) {
  return (
    <main className="gl" id="gallery">
      <GalleryHead onView={onView} fromMap={fromMap} />
      <GalleryToolbar {...bar} />
      {banner}
      <div className="gl-body">{children}</div>
    </main>
  );
}
