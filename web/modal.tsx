// Shared dialog parts: Modal (a <dialog> opened and closed by a prop), BigDialog (the large reply / diff dialog with
// its title, copy and close buttons) and CopyButton.

import type { ComponentChildren } from 'preact';
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { css } from './style.ts';

css(/* css */ `
.big-dialog {
  width: min(880px, calc(100vw - 32px)); height: min(86vh, 1000px); padding: 0; border: 1px solid #3b3f5c; border-radius: 10px;
  background: var(--panel); color: var(--text); box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  &[open] { display: flex; flex-direction: column; }
  &::backdrop { background: rgba(8,9,20,0.6); }
  & header { display: flex; align-items: flex-start; gap: 8px; padding: 14px 16px 12px 22px; border-bottom: 1px solid #2f3352; }
  & header > div { flex: 1; min-width: 0; }
  & header h2 { margin: 0; font-size: 16px; }
  & header .sub { margin: 4px 0 0; font-size: 12px; color: var(--dim); overflow-wrap: anywhere; }
  & header button { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 0; cursor: pointer; background: var(--panel-2); color: var(--text); }
  & header button.close { font-size: 18px; padding: 0 10px; line-height: 28px; }
}
`);

/**
 * A modal <dialog>, shown while `open`. Esc and a click on its backdrop ask `onClose` (the owner drops `open`, which
 * closes it); buttons inside call the owner's close directly. Either way the owner hears of it right away: the
 * dialog's own close event comes a moment later, too late for an owner that opens it again at once.
 */
export function Modal({
  open,
  onClose,
  children,
  ...attrs
}: {
  open: boolean;
  onClose: () => void;
  children: ComponentChildren;
  id?: string;
  class?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const live = useRef(open);
  live.current = open;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the dialog itself is one on its backdrop; Esc is the keyboard's way out
    <dialog
      {...attrs}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault(); // Esc: the owner closes it
        onClose();
      }}
      // news only when the owner still has it open and it stayed closed (a method="dialog" form closed it, say);
      // one from a close the owner asked for can arrive after it was shown again
      onClose={(e) => {
        if (live.current && !e.currentTarget.open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

/** The reply / diff dialog: a header (title, meta line, 복사, ×) over its body. */
export function BigDialog({
  id,
  open,
  onClose,
  title,
  meta,
  copyTitle,
  copy,
  children,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  title: string;
  meta: string;
  copyTitle: string;
  /** The text 복사 copies; undefined: nothing to copy yet. */
  copy: () => string | undefined;
  children: ComponentChildren;
}) {
  return (
    <Modal id={id} class="big-dialog" open={open} onClose={onClose}>
      <header>
        <div>
          <h2>{title}</h2>
          <p class="sub">{meta}</p>
        </div>
        <CopyButton title={copyTitle} text={copy} />
        <button
          type="button"
          class="close"
          title="닫기 (Esc)"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {children}
    </Modal>
  );
}

/** A 복사 button: copies text() (undefined: no-op) and says how that went for a moment. */
export function CopyButton({
  title,
  text,
}: {
  title: string;
  text: () => string | undefined;
}) {
  const [label, setLabel] = useState('복사');
  return (
    <button
      type="button"
      title={title}
      onClick={async () => {
        const t = text();
        if (t === undefined) return;
        try {
          await navigator.clipboard.writeText(t);
          setLabel('복사됨 ✓');
        } catch {
          setLabel('복사 실패');
        }
        setTimeout(() => setLabel('복사'), 1500);
      }}
    >
      {label}
    </button>
  );
}
