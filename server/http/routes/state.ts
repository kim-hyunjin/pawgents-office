// What the page reads: the whole state (GET /state, and as the first SSE event), backend availability, liveness.
import type { BackendsReply } from '../../../shared/api.ts';
import type { BackendRegistry } from '../../backends/index.ts';
import { json } from '../../http.ts';
import type { Sse } from '../../sse.ts';
import type { Store } from '../../store.ts';
import type { Route } from './types.ts';

export const stateRoutes = ({
  store,
  sse,
  backends,
}: {
  store: Store;
  sse: Sse;
  backends: BackendRegistry;
}): Route[] => [
  [
    'GET',
    '/events',
    ({ req, res }) =>
      sse.add(req, res, { type: 'snapshot', data: store.snapshot() }),
  ],
  ['GET', '/state', ({ res }) => json(res, 200, store.snapshot())],
  [
    'GET',
    '/backends',
    async ({ res }) =>
      json(res, 200, (await backends.status()) satisfies BackendsReply),
  ],
  [
    'GET',
    '/healthz',
    ({ res }) => {
      res.writeHead(200);
      res.end('ok');
    },
  ],
];
