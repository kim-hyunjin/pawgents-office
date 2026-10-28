// The page around the office canvas, drawn from the state (state.ts) and redrawn whenever it changes: the office tabs
// and tool buttons above the office, the roster under the HUD, the tooltip over the cat under the pointer, and the
// dialogs the toolbar and the roster open. The canvas itself is office.ts's: this only puts it in place.
import { Fragment, h } from 'preact';
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'preact/hooks';
import { EditorPanel } from './editor/panel.tsx';
import type { Editor } from './editor.ts';
import { Ticker } from './feed.tsx';
import { Launcher } from './launcher.tsx';
import { Legend } from './legend.tsx';
import { Panel } from './panel.tsx';
import { QuitConfirm } from './quit-confirm.tsx';
import { Roster } from './roster.tsx';
import { here, useApp } from './state.ts';
import { Tabs } from './tabs.tsx';
import { CatTip, Tip } from './tip.tsx';
import { Toolbar } from './toolbar.tsx';
import type { Ent } from './world.ts';

export interface AppProps {
  /** The layout editor (made once the canvas this puts in place exists); its side panel shows while editing. */
  editor: () => Editor;
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
  onEdit: () => void;
  onZoom: (scale: number | null) => void;
  /** The bar above the office changed height (the tabs came or went): the office has another room. */
  onBarResize: () => void;
  /** The user closed the panel (× or Esc). */
  onPanelClose: () => void;
  /** The panel opened or closed. */
  onSideChange: () => void;
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
  const shown = (st.panelId && st.sessions.get(st.panelId)) || null;
  const panelOpen = useRef(!!shown);
  useLayoutEffect(() => {
    if (!!shown === panelOpen.current) return;
    panelOpen.current = !!shown;
    p.onSideChange();
  });
  // places change as cats walk around: look again every second while the roster shows them
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!st.rosterOpen) return;
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [st.rosterOpen]);

  const [dialog, setDialog] = useState<'launcher' | 'legend' | null>(null);
  const [hires, setHires] = useState(0); // each 새 직원 opens a fresh form
  const close = () => setDialog(null);

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
          onNew={() => {
            if (dialog === 'launcher') return;
            setHires((n) => n + 1);
            setDialog('launcher');
          }}
          onEdit={p.onEdit}
          onLegend={() => setDialog('legend')}
          onZoom={p.onZoom}
        />
      </div>
      <canvas id="office" />
      <Ticker />
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
        <Tip>
          <CatTip e={hovered} s={hoveredSession} where={p.placeOf(hovered)} />
        </Tip>
      )}
      <Launcher key={hires} open={dialog === 'launcher'} onClose={close} />
      <Legend
        open={dialog === 'legend'}
        onClose={close}
        sessions={st.sessions}
        looks={st.looks}
      />
      <Panel s={shown} onClose={p.onPanelClose} />
      {st.editing && <EditorPanel ed={p.editor()} />}
      <QuitConfirm />
    </>
  );
}
