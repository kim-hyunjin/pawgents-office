// The page around the office canvas, drawn from the state (state.ts) and redrawn whenever it changes: the office tabs
// and tool buttons above the office, the roster under the HUD and the tooltip over the cat under the pointer. The
// canvas itself is office.ts's: this only puts it in place.
import { Fragment, h } from 'preact';
import { useEffect, useLayoutEffect, useReducer, useRef } from 'preact/hooks';
import { Roster } from './roster.tsx';
import { here, useApp } from './state.ts';
import { Tabs } from './tabs.tsx';
import { CatTip, Tip } from './tip.tsx';
import { Toolbar } from './toolbar.tsx';
import type { Ent } from './world.ts';

export interface AppProps {
  /** The cat with this key, while it is on screen. */
  entOf: (key: string) => Ent | undefined;
  /** Where cat `e` is right now ('' at its desk). */
  placeOf: (e: Ent) => string;
  /** Viewport px just under the HUD's left edge, once a frame has drawn it. */
  rosterAnchor: () => { left: number; top: number } | null;
  /** Show the session in the panel, going to its office first. */
  onPick: (id: string) => void;
  onPickOffice: (id: string) => void;
  /** Gather everyone in this office (null: split up by repo); settles once the server has it. */
  onTogether: (officeId: string | null) => Promise<void>;
  onRosterClose: () => void;
  onNew: () => void;
  onEdit: () => void;
  onLegend: () => void;
  onZoom: (scale: number | null) => void;
  /** The bar above the office changed height (the tabs came or went): the office has another room. */
  onBarResize: () => void;
}

export function App(p: AppProps) {
  const st = useApp();
  const tabs = st.offices.length > 1 || !!st.together;
  const tabsShown = useRef(tabs);
  useLayoutEffect(() => {
    if (tabs === tabsShown.current) return;
    tabsShown.current = tabs;
    p.onBarResize();
  });
  // places change as cats walk around: look again every second while the roster shows them
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!st.rosterOpen) return;
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [st.rosterOpen]);

  const officeName = (id: string | null) =>
    st.offices.find((o) => o.id === id)?.name || '';
  const hovered = st.hoverKey ? p.entOf(st.hoverKey) : undefined;
  const hoveredSession = hovered && st.sessions.get(hovered.sessionId);
  return (
    <>
      <div id="bar">
        {tabs && (
          <Tabs
            offices={st.offices}
            sessions={st.sessions}
            officeId={st.officeId}
            together={st.together}
            onPick={p.onPickOffice}
            onTogether={p.onTogether}
          />
        )}
        <Toolbar
          off={st.editing} // the editor has its own buttons
          zoom={st.zoom}
          onNew={p.onNew}
          onEdit={p.onEdit}
          onLegend={p.onLegend}
          onZoom={p.onZoom}
        />
      </div>
      <canvas id="office" />
      <Roster
        sessions={st.sessions}
        anchor={st.rosterOpen ? p.rosterAnchor() : null}
        onClose={p.onRosterClose}
        onPick={p.onPick}
        placeOf={(id) => {
          const s = st.sessions.get(id);
          if (s && !here(s)) return officeName(s.officeId); // works in another office
          const e = p.entOf(id);
          return e && e.station?.kind !== 'desk' ? p.placeOf(e) : '';
        }}
        palOf={(id) => p.entOf(id)?.pal}
      />
      {hovered && hoveredSession && !st.editing && (
        <Tip at={st.pointer}>
          <CatTip e={hovered} s={hoveredSession} where={p.placeOf(hovered)} />
        </Tip>
      )}
    </>
  );
}
