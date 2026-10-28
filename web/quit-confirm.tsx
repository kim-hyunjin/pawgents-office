// The 퇴근 confirmation: a dialog with a "don't ask again" box, remembered per browser. A forced close (the session
// isn't idle, so its terminal tab or process is killed) is remembered apart from a clean /exit: skipping the harmless
// question must not silence the one that cuts work off. confirmQuit() asks; <QuitConfirm> (in app.tsx) shows the
// question while one is open.
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { SessionSnapshot } from '../shared/api.ts';
import { closeSession } from './api.ts';
import { Modal } from './modal.tsx';
import { createStore, useStore } from './store.ts';
import { css } from './style.ts';
import { busyLabel, quitTitle, storage } from './ui.ts';

css(/* css */ `
#quit-confirm {
  width: min(380px, calc(100vw - 32px)); padding: 0; border: 1px solid #3b3f5c; border-radius: 10px;
  background: var(--panel); color: var(--text); box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  &::backdrop { background: rgba(8,9,20,0.6); }
  & form { padding: 16px 18px; display: grid; gap: 12px; }
  & h2 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
  & p { margin: 0; font-size: 13px; line-height: 1.5; }
  & label.check { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
  & label.check input { margin: 0; accent-color: var(--accent); }
  & .row { display: flex; gap: 8px; justify-content: flex-end; }
  & button { font: inherit; font-size: 12.5px; padding: 6px 14px; border-radius: 6px; border: 0; cursor: pointer; background: var(--panel-2); color: var(--text); }
  & button.primary { background: var(--accent); color: #1f2233; font-weight: 700; }
  & button.danger { background: #f87171; color: #1f2233; font-weight: 700; }
}
`);

const NO_ASK = 'pawgents-office:quit-no-ask',
  NO_ASK_FORCE = 'pawgents-office:force-quit-no-ask';

interface Ask {
  s: SessionSnapshot;
  force: boolean;
  /** Called once with the answer (and whether to skip the question from now on). */
  answer: (yes: boolean, skip: boolean) => void;
}
/** The question open now, if any. */
const asking = createStore<{ ask: Ask | null }, void>({ ask: null });
const setAsk = (ask: Ask | null) =>
  asking.update((st) => {
    st.ask = ask;
  });

/** Ask before sending session `s` home; true: go ahead. `force`: it isn't idle, so it will be killed, not /exit-ed. */
export function confirmQuit(s: SessionSnapshot, force: boolean) {
  const key = force ? NO_ASK_FORCE : NO_ASK;
  if (storage.get(key) === '1') return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    setAsk({
      s,
      force,
      answer(yes, skip) {
        if (yes && skip) storage.set(key, '1');
        setAsk(null);
        resolve(yes);
      },
    });
  });
}

/**
 * Send session `s` home once the confirmation says so: idle → a clean end (`/exit`, or closing a headless one's
 * input), anything else → a forced close. Typing `/exit` into a permission dialog could hit its default option, so
 * only an idle prompt gets text. `onGo(force)` hears it is going ahead; false: the user said no. Throws what the
 * server said.
 */
export async function quitSession(
  s: SessionSnapshot,
  onGo?: (force: boolean) => void,
) {
  const force = s.state !== 'idle';
  if (!(await confirmQuit(s, force))) return false;
  onGo?.(force);
  await closeSession(s.id, force);
  return true;
}

export function QuitConfirm() {
  const { ask } = useStore(asking);
  const ok = useRef<HTMLButtonElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    skip = useRef<HTMLInputElement>(null);
  // after Modal's showModal (child effects run first): a kill isn't one Enter away
  useEffect(() => {
    if (ask) (ask.force ? cancel : ok).current?.focus();
  }, [ask]);
  const s = ask?.s;
  return (
    <Modal
      id="quit-confirm"
      open={!!ask}
      onClose={() => ask?.answer(false, false)} // Esc or the backdrop
    >
      {ask && s && (
        <form
          method="dialog"
          onSubmit={(e) => {
            // answer now rather than on the dialog's close event, which comes later (after a quick reopen, too)
            e.preventDefault();
            const yes =
              (e.submitter as HTMLButtonElement | null)?.value === 'ok';
            ask.answer(yes, !!skip.current?.checked);
          }}
        >
          <h2>{`${s.name || s.id.slice(0, 8)} 퇴근시킬까요?`}</h2>
          <p class="dim">
            {ask.force
              ? `${busyLabel(s.state)}입니다. ${quitTitle(s, true)}.`
              : `${quitTitle(s, false)}.`}
          </p>
          <label class="check">
            <input type="checkbox" ref={skip} /> 다음부터 묻지 않기
          </label>
          <div class="row">
            <button type="submit" value="" ref={cancel}>
              취소
            </button>
            <button
              type="submit"
              value="ok"
              ref={ok}
              class={ask.force ? 'primary danger' : 'primary'}
            >
              {ask.force ? '강제 종료' : '퇴근'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
