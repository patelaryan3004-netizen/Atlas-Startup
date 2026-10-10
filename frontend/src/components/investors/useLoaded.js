import { useEffect, useState } from 'react';

// One record fetched by its slug: { status: 'loading' | 'ready' | 'missing' | 'error', data }. A slug the server does not know
// (an investor that was never published, or a mistyped link) is "missing", which is not the same as the server being down.
export function useLoaded(fetcher, slug) {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: 'loading', data: null });
    fetcher(slug, { signal: ctrl.signal })
      .then((data) => { if (!ctrl.signal.aborted) setState({ status: 'ready', data }); })
      .catch((err) => {
        if (ctrl.signal.aborted || err.name === 'AbortError') return;
        setState({ status: err.status === 404 ? 'missing' : 'error', data: null });
      });
    return () => ctrl.abort();
  }, [fetcher, slug]);
  return state;
}
