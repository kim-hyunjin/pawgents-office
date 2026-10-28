// "새 직원" dialog: start claude sessions through the server's POST /launch, either in an Orca terminal (Orca CLI)
// or headless (`claude -p` behind a per-session runner). Opened from the toolbar's 새 직원 button (app.tsx).
import { Fragment, h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Backend, WorktreeInfo as Worktree } from '../shared/api.ts';
import { MAX_HIRES, WORKTREE_NAME_RE } from '../shared/limits.ts';
import { getBackends, getWorktrees, launch } from './api.ts';
import { Modal } from './modal.tsx';
import { css } from './style.ts';
import { storage } from './ui.ts';

css(/* css */ `
#launcher {
  width: min(460px, calc(100vw - 32px)); padding: 0; border: 1px solid #3b3f5c; border-radius: 10px;
  background: var(--panel); color: var(--text); box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  &::backdrop { background: rgba(8,9,20,0.6); }
  & form { padding: 16px 18px; display: grid; gap: 12px; }
  & h2 { margin: 0; font-size: 16px; }
  & label { display: grid; gap: 5px; font-size: 12px; color: var(--dim); }
  & label .dim { opacity: .75; }
  & textarea, & input, & select {
    width: 100%; font: inherit; font-size: 13px; color: var(--text); background: var(--panel-2);
    border: 1px solid #3b3f5c; border-radius: 6px; padding: 7px 9px;
    &:focus { outline: none; border-color: var(--accent); }
  }
  & textarea { resize: vertical; line-height: 1.45; }
  & label.check { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 13px; cursor: pointer; }
  & label.check input { width: auto; margin: 0; accent-color: var(--accent); }
  & .count { width: 80px; appearance: textfield; -moz-appearance: textfield; } /* no spinner arrows */
  & .count::-webkit-inner-spin-button, & .count::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  & .msg { white-space: pre-line; }
  & fieldset { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 5px 18px; }
  & legend { padding: 0 0 5px; font-size: 12px; color: var(--dim); }
  & fieldset p { flex-basis: 100%; margin: 0; font-size: 12px; }
  & .row { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
  & button {
    font: inherit; font-size: 12.5px; padding: 6px 14px; border-radius: 6px; border: 0; cursor: pointer;
    background: var(--panel-2); color: var(--text);
  }
}
`);

const CUSTOM = '__custom';
const LAST_WT = 'pawgents-office:last-worktree',
  LAST_CWD = 'pawgents-office:last-cwd',
  LAST_BACKEND = 'pawgents-office:last-backend';
const HINT: Record<Backend, string> = {
  orca: 'Orca 터미널 탭에서 실행합니다. 터미널에서도 바로 볼 수 있어요.',
  headless: '사무실 서버가 claude -p 를 직접 띄웁니다. Orca가 없어도 돼요.',
};

type Msg = { text: string; kind: '' | 'ok' | 'err' };
/** A backend's list: loading, loaded, or failed (the select stays disabled). */
type List = Worktree[] | 'loading' | 'error';
const label = (w: Worktree, extra: string) =>
  `${w.repo}${w.branch ? ` · ${w.branch}` : ''}${extra}`;

/** Mount it anew (a new `key`) for each open: every field starts from its default. */
export function Launcher({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [msg, setMsgState] = useState<Msg>({ text: '', kind: '' });
  const setMsg = (text: string, kind: Msg['kind'] = '') =>
    setMsgState({ text, kind });
  // null while /backends is loading or nothing is available
  const [backend, setBackend] = useState<Backend | null>(null);
  const [offered, setOffered] = useState<Backend[]>([]);
  const [lists, setLists] = useState<Partial<Record<Backend, List>>>({});
  const [worktreeId, setWorktreeId] = useState('');
  const [cwd, setCwd] = useState('');
  const [cwdCustom, setCwdCustom] = useState('');
  const [perm, setPerm] = useState('default');
  const [newWt, setNewWt] = useState(false);
  const [name, setName] = useState('');
  const [count, setCount] = useState('1');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const loadSeq = useRef(0); // a slower list for a backend the user already switched away from must not land
  const form = useRef<HTMLFormElement>(null),
    promptEl = useRef<HTMLTextAreaElement>(null),
    customEl = useRef<HTMLInputElement>(null),
    nameEl = useRef<HTMLInputElement>(null);

  async function loadWorktrees(b: Backend) {
    const seq = ++loadSeq.current;
    setLists((l) => ({ ...l, [b]: 'loading' }));
    try {
      const list = (await getWorktrees(b)).worktrees || [];
      if (seq !== loadSeq.current) return;
      if (b === 'orca') {
        if (!list.length) throw new Error('Orca에 등록된 워크트리가 없습니다.');
        const last = storage.get(LAST_WT) || '';
        setWorktreeId(list.some((w) => w.id === last) ? last : list[0]!.id);
      } else {
        // the last folder, else the first main checkout; a typed folder that isn't listed comes back as 직접 입력
        const last = storage.get(LAST_CWD) || '',
          hit = list.find((w) => w.path === last);
        const pick = hit
          ? hit.path
          : last || !list.length
            ? CUSTOM
            : (list.find((w) => w.isMain) ?? list[0])!.path;
        setCwd(pick);
        if (pick === CUSTOM && last) setCwdCustom((c) => c || last);
      }
      setLists((l) => ({ ...l, [b]: list }));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setLists((l) => ({ ...l, [b]: 'error' }));
      setMsg((e as Error).message, 'err');
    }
  }

  // which backends there are, once per open
  useEffect(() => {
    if (!open) return;
    promptEl.current?.focus(); // after Modal's showModal: child effects run first
    let gone = false;
    getBackends().then(
      (d) => {
        if (gone) return;
        // a forced backend (PAWGENTS_OFFICE_BACKEND) that works is the only choice offered
        const ok =
          d.forced && d.default
            ? [d.default]
            : (['orca', 'headless'] as const).filter((b) => d[b]?.available);
        const [first] = ok;
        if (!first) {
          setMsg('Orca CLI도 claude CLI도 찾을 수 없습니다.', 'err');
          return;
        }
        const last = storage.get(LAST_BACKEND) as Backend | null;
        const b =
          last && ok.includes(last)
            ? last
            : d.default && ok.includes(d.default)
              ? d.default
              : first;
        setOffered(ok);
        setBackend(b);
        loadWorktrees(b);
      },
      (e: Error) => {
        if (!gone) setMsg(e.message, 'err');
      },
    );
    return () => {
      gone = true;
    };
  }, [open]);

  const orca = backend === 'orca',
    hl = backend === 'headless';
  const custom = hl && cwd === CUSTOM;
  const orcaList = lists.orca,
    hlList = lists.headless;
  const base = orca
    ? Array.isArray(orcaList) && orcaList.find((w) => w.id === worktreeId)
    : hl && !custom
      ? Array.isArray(hlList) && hlList.find((w) => w.path === cwd)
      : null;
  const from = base
    ? base.branch || (base.head ? base.head.slice(0, 7) : '')
    : '';
  const n = Math.min(MAX_HIRES, Math.max(1, Math.floor(Number(count) || 1)));
  const nm = name.trim() || '이름';
  const countHint = newWt
    ? n > 1
      ? `(워크트리 ${n}개: ${nm}-1 … ${nm}-${n}, 한 명씩)`
      : '(새 워크트리 1개)'
    : n > 1
      ? hl
        ? `(같은 폴더에 ${n}명)`
        : `(같은 워크트리에 탭 ${n}개)`
      : '';

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!backend || busy) return;
    const dir = hl ? (custom ? cwdCustom.trim() : cwd) : '';
    if (!hl && !worktreeId) return;
    if (hl && !dir) {
      setMsg('작업 폴더를 입력해 주세요.', 'err');
      if (custom) customEl.current?.focus();
      return;
    }
    const k = Math.floor(Number(count));
    if (!(k >= 1 && k <= MAX_HIRES)) {
      setMsg(`인원은 1~${MAX_HIRES}명이에요.`, 'err');
      return;
    }
    const wtName = name.trim();
    if (newWt && !WORKTREE_NAME_RE.test(wtName)) {
      setMsg(
        '워크트리 이름은 영문·숫자·. _ - 만, 60자까지 쓸 수 있어요.',
        'err',
      );
      return;
    }
    setBusy(true);
    setMsg(
      hl
        ? newWt
          ? `워크트리를 만들고 ${k}명 시작하는 중…`
          : `${k}명 시작하는 중…`
        : newWt
          ? `워크트리를 만들고 ${k}명 채용하는 중… (조금 걸려요)`
          : `Orca에서 ${k}명 시작하는 중…`,
    );
    try {
      const d = await launch({
        backend,
        ...(hl ? { cwd: dir, permissionMode: perm } : { worktreeId }),
        newWorktree: newWt ? { name: wtName } : null,
        prompt: prompt.trim(),
        model: model.trim(),
        count: k,
      });
      storage.set(LAST_BACKEND, backend);
      if (hl) storage.set(LAST_CWD, dir);
      else storage.set(LAST_WT, worktreeId);
      if (d.errors?.length) {
        // some hires failed: keep the dialog open with what went wrong
        setMsg(
          `${d.started}명 시작, ${d.errors.length}명 실패:\n${d.errors.join('\n')}`,
          'err',
        );
        setBusy(false);
        return;
      }
      setMsg(`${d.started}명 시작됨 — 곧 로비로 들어옵니다.`, 'ok');
      setTimeout(onClose, 900);
    } catch (err) {
      setMsg((err as Error).message, 'err');
      setBusy(false);
    }
  }

  /** A worktree / folder select's options while its list loads, failed, or is in. */
  const placeholder = (l: List | undefined) =>
    !Array.isArray(l) && (
      <option value="">{l === 'error' ? '—' : '불러오는 중…'}</option>
    );

  return (
    <Modal id="launcher" open={open} onClose={onClose}>
      <form method="dialog" ref={form} onSubmit={onSubmit}>
        <h2>새 직원 채용</h2>
        {offered.length > 1 && (
          <fieldset>
            <legend>실행 방식</legend>
            {(['orca', 'headless'] as const).map((b) => (
              <label key={b} class="check">
                <input
                  type="radio"
                  name="backend"
                  value={b}
                  checked={backend === b}
                  onChange={() => {
                    setBackend(b);
                    setMsg('');
                    loadWorktrees(b);
                  }}
                />{' '}
                {b === 'orca' ? 'Orca' : '직접 실행 (claude -p)'}
              </label>
            ))}
            <p class="dim">{(backend && HINT[backend]) || ''}</p>
          </fieldset>
        )}
        {orca && (
          <label>
            워크트리
            <select
              required
              disabled={!Array.isArray(orcaList)}
              value={worktreeId}
              onChange={(e) => setWorktreeId(e.currentTarget.value)}
            >
              {placeholder(orcaList)}
              {Array.isArray(orcaList) &&
                orcaList.map((w) => (
                  <option key={w.id} value={w.id} title={w.path}>
                    {label(
                      w,
                      w.name && w.name !== w.branch ? ` (${w.name})` : '',
                    )}
                  </option>
                ))}
            </select>
          </label>
        )}
        {hl && (
          <label>
            작업 폴더
            <select
              disabled={!Array.isArray(hlList)}
              value={cwd}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setCwd(v);
                if (v === CUSTOM) setTimeout(() => customEl.current?.focus());
              }}
            >
              {placeholder(hlList)}
              {Array.isArray(hlList) && (
                <>
                  {hlList.map((w) => (
                    <option key={w.path} value={w.path} title={w.path}>
                      {label(w, w.isMain ? ' (main)' : '')}
                    </option>
                  ))}
                  <option value={CUSTOM}>직접 입력…</option>
                </>
              )}
            </select>
            {custom && (
              <input
                ref={customEl}
                autocomplete="off"
                spellcheck={false}
                placeholder="C:\path\to\repo"
                value={cwdCustom}
                onInput={(e) => setCwdCustom(e.currentTarget.value)}
              />
            )}
          </label>
        )}
        {hl && (
          <label>
            권한 모드
            <select
              value={perm}
              onChange={(e) => setPerm(e.currentTarget.value)}
            >
              <option value="default">기본 (사무실에서 승인)</option>
              <option value="acceptEdits">편집 자동 승인</option>
              <option value="auto">자동 (분류기 판단)</option>
            </select>
          </label>
        )}
        <label class="check">
          <input
            type="checkbox"
            checked={newWt}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              setNewWt(on);
              if (on && !name.trim())
                setName(`cat-${Math.random().toString(36).slice(2, 6)}`);
              if (on) setTimeout(() => nameEl.current?.select());
            }}
          />{' '}
          새 워크트리 만들기{' '}
          <span class="dim">
            {from
              ? `(${from} 에서 분기)`
              : hl
                ? '(선택한 폴더의 브랜치에서 분기)'
                : '(선택한 워크트리의 브랜치에서 분기)'}
          </span>
        </label>
        {newWt && (
          <label>
            새 워크트리 이름 <span class="dim">(브랜치 이름으로도 쓰여요)</span>
            <input
              ref={nameEl}
              autocomplete="off"
              spellcheck={false}
              maxLength={60}
              placeholder="예: feature-login"
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
        )}
        <label>
          인원 <span class="dim">{countHint}</span>
          <input
            class="count"
            type="number"
            min={1}
            max={MAX_HIRES}
            value={count}
            onInput={(e) => setCount(e.currentTarget.value)}
          />
        </label>
        <label>
          모델 <span class="dim">(비우면 기본값)</span>
          <input
            list="l-models"
            placeholder="opus / sonnet / haiku / 모델 ID"
            autocomplete="off"
            value={model}
            onInput={(e) => setModel(e.currentTarget.value)}
          />
          <datalist id="l-models">
            <option value="opus" />
            <option value="sonnet" />
            <option value="haiku" />
          </datalist>
        </label>
        <label>
          첫 지시 <span class="dim">(선택)</span>
          <textarea
            ref={promptEl}
            rows={5}
            placeholder="무엇을 할지 적어주세요. 비우면 빈 세션으로 시작합니다."
            value={prompt}
            onInput={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                (e.ctrlKey || e.metaKey) &&
                !e.isComposing
              ) {
                e.preventDefault();
                form.current?.requestSubmit();
              }
            }}
          />
        </label>
        <p class={`msg ${msg.kind}`}>{msg.text}</p>
        <div class="row">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" class="primary" disabled={!backend || busy}>
            시작
          </button>
        </div>
      </form>
    </Modal>
  );
}
