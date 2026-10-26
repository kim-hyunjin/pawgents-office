// The launcher: worktrees to hire into, and POST /launch (the hire itself, see app/launch.ts).
import type { LaunchReply, WorktreesReply } from '../../../shared/api.ts';
import { BAD_REQUEST } from '../../app/errors.ts';
import { type LaunchRequest, parseLaunchBody } from '../../app/launch.ts';
import type { BackendRegistry } from '../../backends/index.ts';
import { json, readJson, sendError } from '../common.ts';
import type { Route } from './types.ts';

export const launchRoutes = ({
  backends,
  launch,
}: {
  backends: BackendRegistry;
  launch: (req: LaunchRequest) => Promise<LaunchReply>;
}): Route[] => [
  [
    'GET',
    '/worktrees',
    async ({ res, url }) => {
      const id =
        url.searchParams.get('backend') || (await backends.status()).default;
      const b = id ? backends.find(id) : null;
      try {
        if (b)
          json(res, 200, {
            worktrees: await b.listWorktrees(),
          } satisfies WorktreesReply);
        else json(res, 400, { error: '알 수 없는 백엔드입니다.' });
      } catch (e) {
        sendError(res, e);
      }
    },
  ],
  [
    'POST',
    '/launch',
    async ({ req, res }) => {
      const data = await readJson(req, res);
      if (!data) return;
      const hire = parseLaunchBody(data);
      if (!hire) {
        json(res, 400, { error: BAD_REQUEST });
        return;
      }
      try {
        json(res, 200, (await launch(hire)) satisfies LaunchReply);
      } catch (e) {
        sendError(res, e);
      }
    },
  ],
];
