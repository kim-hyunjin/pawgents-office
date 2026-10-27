// The 퇴근 confirmation: a dialog with a "don't ask again" box, remembered per browser. A forced close (the session
// isn't idle, so its terminal tab or process is killed) is remembered apart from a clean /exit: skipping the harmless
// question must not silence the one that cuts work off.
import type { SessionSnapshot } from '../shared/api.ts';
import { isBusyState } from '../shared/model.ts';
import { $, quitTitle, storage } from './ui.ts';

const NO_ASK = 'pawgents-office:quit-no-ask',
  NO_ASK_FORCE = 'pawgents-office:force-quit-no-ask';

let dlg: HTMLDialogElement | null = null;

function dialog() {
  if (dlg) return dlg;
  const d = $<HTMLDialogElement>('quit-confirm');
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close(); // backdrop: cancel
  });
  dlg = d;
  return d;
}

/** Ask before sending session `s` home; true: go ahead. `force`: it isn't idle, so it will be killed, not /exit-ed. */
export function confirmQuit(s: SessionSnapshot, force: boolean) {
  const key = force ? NO_ASK_FORCE : NO_ASK;
  if (storage.get(key) === '1') return Promise.resolve(true);
  const d = dialog();
  const ok = $<HTMLButtonElement>('qc-ok'),
    skip = $<HTMLInputElement>('qc-skip');
  $('qc-title').textContent = `${s.name || s.id.slice(0, 8)} 퇴근시킬까요?`;
  $('qc-body').textContent = force
    ? `${isBusyState(s.state) ? '작업 중' : '응답 대기 중'}입니다. ${quitTitle(s, true)}.`
    : `${quitTitle(s, false)}.`;
  ok.textContent = force ? '강제 종료' : '퇴근';
  ok.classList.toggle('danger', force);
  skip.checked = false;
  d.returnValue = '';
  d.showModal();
  (force ? $('qc-cancel') : ok).focus(); // a kill isn't one Enter away
  return new Promise<boolean>((resolve) => {
    d.addEventListener(
      'close',
      () => {
        const yes = d.returnValue === 'ok';
        if (yes && skip.checked) storage.set(key, '1');
        resolve(yes);
      },
      { once: true },
    );
  });
}
