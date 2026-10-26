// The server's push stream (/events, SSE): every event's JSON goes to its handler, typed by shared/api.ts.
import type { ServerEvents, ServerEventType } from '../../shared/api.ts';

export type EventHandlers = {
  [K in ServerEventType]: (data: ServerEvents[K]) => void;
};

/**
 * Open /events. EventSource reconnects by itself; onOpen(reconnected) runs on every (re)connect — true from the second
 * one on, when events may have been missed — and onError when the connection drops.
 */
export function connectEvents(
  on: EventHandlers,
  {
    onOpen,
    onError,
  }: { onOpen: (reconnected: boolean) => void; onError: () => void },
) {
  const es = new EventSource('/events');
  const listen = <K extends ServerEventType>(type: K) =>
    es.addEventListener(type, (ev) =>
      on[type](JSON.parse(ev.data) as ServerEvents[K]),
    );
  for (const type of Object.keys(on) as ServerEventType[]) listen(type);
  let everConnected = false;
  es.onopen = () => {
    onOpen(everConnected);
    everConnected = true;
  };
  es.onerror = () => onError();
  return es;
}
