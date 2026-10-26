// The HTTP API: every route table, wired to its use cases. Anything unmatched falls through to static files
// (GET) or 404 (see createApp in server/index.ts).
import { createLaunch } from '../../app/launch.ts';
import { consoleLogger } from '../../app/log.ts';
import { createOfficeActions } from '../../app/offices.ts';
import type { Logger } from '../../app/ports.ts';
import { createSessionActions } from '../../app/sessions.ts';
import { createSkinActions } from '../../app/skins.ts';
import type { BackendRegistry } from '../../backends/index.ts';
import type { Sse } from '../../sse.ts';
import type { Store } from '../../store.ts';
import { diffRoutes } from './diff.ts';
import { hookRoutes } from './hook.ts';
import { launchRoutes } from './launch.ts';
import { officeRoutes } from './office.ts';
import { sessionRoutes } from './session.ts';
import { skinRoutes } from './skin.ts';
import { stateRoutes } from './state.ts';
import type { Route } from './types.ts';

export type { Route, RouteCtx } from './types.ts';

export function makeRoutes({
  store,
  sse,
  backends,
  logger = consoleLogger,
}: {
  store: Store;
  sse: Sse;
  backends: BackendRegistry;
  logger?: Logger;
}): Route[] {
  const sessions = createSessionActions({ store, backends, logger });
  return [
    ...hookRoutes({ sessions }),
    ...stateRoutes({ store, sse, backends }),
    ...sessionRoutes({ store, sessions }),
    ...diffRoutes({ store, sessions }),
    ...officeRoutes({ store, offices: createOfficeActions({ store, logger }) }),
    ...skinRoutes({ skins: createSkinActions({ store, logger }) }),
    ...launchRoutes({
      backends,
      launch: createLaunch({ launchers: backends.byId, logger }),
    }),
  ];
}
