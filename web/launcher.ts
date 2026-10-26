// "새 직원" dialog: start claude sessions through the server's POST /launch, either in an Orca terminal (Orca CLI)
// or headless (`claude -p` behind a per-session runner). Opened from the #t-new toolbar button.
import type { Backend } from '../server/types.ts';
import { MAX_HIRES, WORKTREE_NAME_RE } from '../shared/limits.ts';
import { api, post } from './api.ts';
import { $, bindDialogClose, esc, setMsg as setMsgOn, storage } from './ui.ts';

const dlg = $<HTMLDialogElement>('launcher'),
  form = $<HTMLFormElement>('l-form'),
  msg = $('l-msg'),
  submit = $<HTMLButtonElement>('l-submit');
const backendBox = $('l-backend'),
  backendHint = $('l-backend-hint'),
  radios = [
    ...form.querySelectorAll<HTMLInputElement>('input[name="backend"]'),
  ];
const sel = $<HTMLSelectElement>('l-worktree'),
  wtRow = $('l-worktree-row');
const cwdSel = $<HTMLSelectElement>('l-cwd'),
  cwdRow = $('l-cwd-row'),
  cwdCustom = $<HTMLInputElement>('l-cwd-custom'),
  permRow = $('l-perm-row'),
  perm = $<HTMLSelectElement>('l-perm');
const model = $<HTMLInputElement>('l-model'),
  prompt = $<HTMLTextAreaElement>('l-prompt');
const newWt = $<HTMLInputElement>('l-new'),
  newHint = $('l-new-hint'),
  nameRow = $('l-name-row'),
  nameIn = $<HTMLInputElement>('l-name');
const countIn = $<HTMLInputElement>('l-count'),
  countHint = $('l-count-hint');
countIn.max = String(MAX_HIRES); // the one copy of the limit: index.html leaves max off

const CUSTOM = '__custom';
const LAST_WT = 'pawgents-office:last-worktree',
  LAST_CWD = 'pawgents-office:last-cwd',
  LAST_BACKEND = 'pawgents-office:last-backend';
const HINT: Record<Backend, string> = {
  orca: 'Orca 터미널 탭에서 실행합니다. 터미널에서도 바로 볼 수 있어요.',
  headless: '사무실 서버가 claude -p 를 직접 띄웁니다. Orca가 없어도 돼요.',
};
let backend: Backend | null = null; // null while /backends is loading or nothing is available
interface Worktree {
  id: string;
  repo: string;
  branch?: string;
  name?: string;
  path: string;
  isMain?: boolean;
  head?: string;
}
const lists: Record<Backend, Worktree[]> = { orca: [], headless: [] };
let loadSeq = 0; // a slower list for a backend the user already switched away from must not overwrite the current one
const setMsg = (text: string, kind = '') => setMsgOn(msg, text, kind);
const opt = (value: string, label: string, title = '', selected = false) =>
  `<option value="${esc(value)}"${title ? ` title="${esc(title)}"` : ''}${selected ? ' selected' : ''}>${esc(label)}</option>`;

async function loadWorktrees(b: Backend) {
  const seq = ++loadSeq,
    box = b === 'orca' ? sel : cwdSel;
  box.disabled = true;
  box.innerHTML = '<option value="">불러오는 중…</option>';
  try {
    const list =
      (await api<{ worktrees?: Worktree[] }>(`/worktrees?backend=${b}`))
        .worktrees || [];
    if (seq !== loadSeq) return;
    lists[b] = list;
    if (b === 'orca') {
      if (!list.length) throw new Error('Orca에 등록된 워크트리가 없습니다.');
      const last = storage.get(LAST_WT) || '';
      sel.innerHTML = list
        .map((w) =>
          opt(
            w.id,
            `${w.repo}${w.branch ? ` · ${w.branch}` : ''}${w.name && w.name !== w.branch ? ` (${w.name})` : ''}`,
            w.path,
            w.id === last,
          ),
        )
        .join('');
    } else {
      // the last folder, else the first main checkout; a typed folder that isn't listed comes back as 직접 입력
      const last = storage.get(LAST_CWD) || '',
        hit = list.find((w) => w.path === last),
        pick = hit
          ? hit.path
          : last
            ? CUSTOM
            : list.find((w) => w.isMain)?.path;
      cwdSel.innerHTML =
        list
          .map((w) =>
            opt(
              w.path,
              `${w.repo}${w.branch ? ` · ${w.branch}` : ''}${w.isMain ? ' (main)' : ''}`,
              w.path,
              w.path === pick,
            ),
          )
          .join('') +
        opt(CUSTOM, '직접 입력…', '', pick === CUSTOM || !list.length);
      if (cwdSel.value === CUSTOM && !hit && last && !cwdCustom.value)
        cwdCustom.value = last;
    }
    box.disabled = false;
  } catch (e) {
    if (seq !== loadSeq) return;
    box.innerHTML = '<option value="">—</option>';
    setMsg((e as Error).message, 'err');
  }
  syncForm();
}

/** Show the rows of the chosen backend and explain what the choices will do (branch source, how hires spread). */
function syncForm() {
  const orca = backend === 'orca',
    hl = backend === 'headless';
  wtRow.hidden = !orca;
  cwdRow.hidden = permRow.hidden = !hl;
  sel.required = orca; // a hidden required select would block the submit
  backendHint.textContent = (backend && HINT[backend]) || '';
  const custom = hl && cwdSel.value === CUSTOM;
  cwdCustom.hidden = !custom;
  const base = orca
    ? lists.orca.find((w) => w.id === sel.value)
    : hl && !custom
      ? lists.headless.find((w) => w.path === cwdSel.value)
      : null;
  const from = base
    ? base.branch || (base.head ? base.head.slice(0, 7) : '')
    : '';
  newHint.textContent = from
    ? `(${from} 에서 분기)`
    : hl
      ? '(선택한 폴더의 브랜치에서 분기)'
      : '(선택한 워크트리의 브랜치에서 분기)';
  nameRow.hidden = !newWt.checked;
  const n = Math.min(
    MAX_HIRES,
    Math.max(1, Math.floor(Number(countIn.value) || 1)),
  );
  const nm = nameIn.value.trim() || '이름';
  countHint.textContent = newWt.checked
    ? n > 1
      ? `(워크트리 ${n}개: ${nm}-1 … ${nm}-${n}, 한 명씩)`
      : '(새 워크트리 1개)'
    : n > 1
      ? hl
        ? `(같은 폴더에 ${n}명)`
        : `(같은 워크트리에 탭 ${n}개)`
      : '';
}
sel.addEventListener('change', syncForm);
cwdSel.addEventListener('change', () => {
  syncForm();
  if (cwdSel.value === CUSTOM) cwdCustom.focus();
});
countIn.addEventListener('input', syncForm);
nameIn.addEventListener('input', syncForm);
newWt.addEventListener('change', () => {
  if (newWt.checked && !nameIn.value.trim())
    nameIn.value = `cat-${Math.random().toString(36).slice(2, 6)}`;
  syncForm();
  if (newWt.checked) nameIn.select();
});
for (const r of radios)
  r.addEventListener('change', () => {
    if (!r.checked) return;
    backend = r.value as Backend;
    setMsg('');
    syncForm();
    loadWorktrees(backend);
  });

interface BackendsReply {
  forced?: boolean;
  default?: Backend;
  orca?: { available: boolean };
  headless?: { available: boolean };
}
export async function openLauncher() {
  if (dlg.open) return;
  // every open starts from the defaults (the lists still preselect the last worktree / folder used)
  newWt.checked = false;
  nameIn.value = '';
  countIn.value = '1';
  model.value = '';
  prompt.value = '';
  cwdCustom.value = '';
  perm.value = 'default';
  backend = null;
  backendBox.hidden = true;
  submit.disabled = true;
  setMsg('');
  syncForm();
  dlg.showModal();
  prompt.focus();
  let d: BackendsReply;
  try {
    d = await api('/backends');
  } catch (e) {
    setMsg((e as Error).message, 'err');
    return;
  }
  // a forced backend (PAWGENTS_OFFICE_BACKEND) that works is the only choice offered
  const ok =
    d.forced && d.default
      ? [d.default]
      : (['orca', 'headless'] as const).filter((b) => d[b]?.available);
  if (!ok.length) {
    setMsg('Orca CLI도 claude CLI도 찾을 수 없습니다.', 'err');
    return;
  }
  const last = storage.get(LAST_BACKEND);
  backend = ok.includes(last as Backend)
    ? (last as Backend)
    : ok.includes(d.default!)
      ? d.default!
      : ok[0];
  backendBox.hidden = ok.length < 2;
  for (const r of radios) r.checked = r.value === backend;
  submit.disabled = false;
  syncForm();
  loadWorktrees(backend);
}
bindDialogClose(dlg, $('l-cancel'));
prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!backend || submit.disabled) return;
  const hl = backend === 'headless',
    custom = hl && cwdSel.value === CUSTOM;
  const cwd = hl ? (custom ? cwdCustom.value.trim() : cwdSel.value) : '';
  if (!hl && !sel.value) return;
  if (hl && !cwd) {
    setMsg('작업 폴더를 입력해 주세요.', 'err');
    if (custom) cwdCustom.focus();
    return;
  }
  const count = Math.floor(Number(countIn.value));
  if (!(count >= 1 && count <= MAX_HIRES)) {
    setMsg(`인원은 1~${MAX_HIRES}명이에요.`, 'err');
    return;
  }
  const name = nameIn.value.trim();
  if (newWt.checked && !WORKTREE_NAME_RE.test(name)) {
    setMsg('워크트리 이름은 영문·숫자·. _ - 만, 60자까지 쓸 수 있어요.', 'err');
    return;
  }
  submit.disabled = true;
  setMsg(
    hl
      ? newWt.checked
        ? `워크트리를 만들고 ${count}명 시작하는 중…`
        : `${count}명 시작하는 중…`
      : newWt.checked
        ? `워크트리를 만들고 ${count}명 채용하는 중… (조금 걸려요)`
        : `Orca에서 ${count}명 시작하는 중…`,
  );
  try {
    const d = await post<{ started: number; errors?: string[] }>('/launch', {
      backend,
      ...(hl ? { cwd, permissionMode: perm.value } : { worktreeId: sel.value }),
      newWorktree: newWt.checked ? { name } : null,
      prompt: prompt.value.trim(),
      model: model.value.trim(),
      count,
    });
    storage.set(LAST_BACKEND, backend);
    if (hl) storage.set(LAST_CWD, cwd);
    else storage.set(LAST_WT, sel.value);
    if (d.errors?.length) {
      // some hires failed: keep the dialog open with what went wrong
      setMsg(
        `${d.started}명 시작, ${d.errors.length}명 실패:\n${d.errors.join('\n')}`,
        'err',
      );
      submit.disabled = false;
      return;
    }
    setMsg(`${d.started}명 시작됨 — 곧 로비로 들어옵니다.`, 'ok');
    setTimeout(() => dlg.close(), 900);
  } catch (err) {
    setMsg((err as Error).message, 'err');
    submit.disabled = false;
  }
});
