// A company's logo, from the domain of its website.
//
// There is one source: Google's favicon service, asked at the address its own short link (www.google.com/s2/favicons) redirects to.
// That skips a round trip, and a second connection to another host, for every logo, and the browser keeps the picture for a week
// (the short link's redirect is kept for half an hour). The logos used to be asked for at Clearbit first, then here, but
// logo.clearbit.com no longer exists (its name has no address in DNS), so every logo cost a failed lookup before the favicon was
// asked for. A domain the service does not know is answered 404, which an <img> reports as an error: the callers show the
// company's initial then.
//
// `size` is the picture's side in pixels: the box it is drawn in, twice over for a sharp picture on a high-density screen.
export const logoUrl = (domain, size = 64) => `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=${size}`;
