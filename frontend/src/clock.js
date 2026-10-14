import { createContext } from 'react';

// "Verified 3 days ago" depends on what day it is. A page that was pre-rendered says it as of the moment the data was made (the snapshot's
// time), on the server and in the browser's first render, so the two agree and the page is hydrated rather than drawn again; the page then
// sets the clock to null and every such text reads the real time. Elsewhere the context is null from the start and texts read the real time.
export const ClockContext = createContext(null);

// The clock a pre-rendered page starts with: set by the server's render and by main.jsx before it hydrates, null otherwise.
let prerenderClock = null;
export const setPrerenderClock = (ms) => { prerenderClock = ms; };
export const getPrerenderClock = () => prerenderClock;
