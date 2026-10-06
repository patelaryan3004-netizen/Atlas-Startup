// One background job at a time: reading hundreds of websites takes minutes, so a request starts the job and
// returns, and the page watches its progress. A job can be asked to stop; it stops between tasks, never
// part-way through writing one.
import { ConflictError } from './errors.js';

export function createJobRunner({ now = Date.now } = {}) {
  let job = null;
  const view = (j) => (j ? {
    id: j.id, kind: j.kind, by: j.by, state: j.state, started_at: j.started_at, finished_at: j.finished_at,
    progress: { ...j.progress }, log: j.log.slice(-40), error: j.error, stopping: j.stop && j.state === 'running',
  } : null);

  return {
    current: () => view(job),
    // run({ job, log, shouldStop }) resolves with its final progress.
    start({ kind, by, run }) {
      if (job?.state === 'running') throw new ConflictError(`a ${job.kind} run is already in progress`);
      const j = { id: `job-${now()}`, kind, by, state: 'running', started_at: new Date(now()).toISOString(), finished_at: null, progress: {}, log: [], error: null, stop: false };
      job = j;
      const log = (line) => { j.log.push(`${new Date(now()).toISOString().slice(11, 19)} ${line}`); if (j.log.length > 200) j.log.shift(); };
      j.promise = Promise.resolve()
        .then(() => run({ job: j, log, shouldStop: () => j.stop }))
        .then((progress) => { if (progress) j.progress = progress; j.state = j.stop ? 'stopped' : 'done'; })
        .catch((err) => { j.state = 'failed'; j.error = err.message; log(`failed: ${err.message}`); })
        .finally(() => { j.finished_at = new Date(now()).toISOString(); });
      return view(j);
    },
    stop() {
      if (job?.state === 'running') job.stop = true;
      return view(job);
    },
    // For tests and shutdown: resolves when the current job is over.
    idle: () => (job?.promise ?? Promise.resolve()),
  };
}
