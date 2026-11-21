// Every place the sync finds companies it does not hold, in one list: Innovation Bay's company list (network.js) and the official portfolio pages (portfolio.js). `jobsync leads --promote`
// walks this list and hands each source's eligible leads to the directory's review queue as evidence of that source's kind.
import { NETWORKS } from './network.js';
import { SOURCES as PORTFOLIOS, evidenceKindOf } from './portfolio.js';

export const discoverySources = () => [
  ...NETWORKS.map((n) => ({ id: n.id, name: n.name, list_title: 'company list', evidence_kind: 'directory_listing' })),
  ...PORTFOLIOS.map((p) => ({ id: p.id, name: p.publisher, list_title: 'portfolio', evidence_kind: evidenceKindOf(p) })),
];
