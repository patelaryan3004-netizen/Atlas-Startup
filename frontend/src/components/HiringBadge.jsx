import { hiringLabel } from '../freshness.js';

// What a company says about hiring, in the one wording the list, the card and the detail panel share (freshness.js, hiringLabel). Only a
// company a page confirmed lately is "Hiring now" (green); every other state is muted and says what is true: when the roles were last read,
// that a job board listed none, or that nothing has been read. It never says "Not hiring" about a company nobody has read.
const TITLES = {
  checked: 'Open roles were read on this date. A page has not confirmed them since, so it is not counted as hiring now.',
  none: "The company's job board was read and listed no open roles.",
  unverified: 'Nothing has been read: the company has no website, no job board we can read, or a claim no page backs.',
};

export default function HiringBadge({ company }) {
  const { state, text } = hiringLabel(company);
  if (state === 'hiring') return <span className="hiring-badge">● {text}</span>;
  return <span className="hiring-badge hiring-badge-off" title={TITLES[state]}>{text}</span>;
}
