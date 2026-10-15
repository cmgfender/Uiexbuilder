/**
 * Code editing for the power features (helper functions; reusable for any multi-line code field):
 *
 *  - handleCodeKeyDown(e, onChange): Tab / Shift+Tab indent and outdent the selected lines, Enter
 *    keeps the indentation of the current line (one level deeper after `{`, `(` or `[`). Escape
 *    arms "the next Tab leaves the field" so keyboard users can always move on.
 *  - CodeEditor: a roomy editor with syntax highlighting and line numbers — a transparent
 *    <textarea> (native caret, selection, IME, undo of typing, screen readers) over a highlighted
 *    copy of the text rendered with the same Prism grammar and token colours as the code panel.
 *  - CodeEditorDialog: a large modal around any editor (the "Open in large editor" button of the
 *    Helpers section and computed values) bound live to the same store value.
 */
import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode, type UIEvent } from 'react';
import { Highlight, type PrismTheme } from 'prism-react-renderer';
import { Button, Dialog, cx } from '../ui';
import '../ui/CodeViewer.css';
import './power.css';

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

const INDENT = '  ';

/** Places the caret / selection after React re-rendered the controlled value. */
function select(t: HTMLTextAreaElement, start: number, end = start): void {
  const apply = () => {
    if (t.isConnected) t.setSelectionRange(start, end);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
  else setTimeout(apply, 0);
}

/**
 * Editor keys for a code <textarea>. Returns true when the key was handled (the change went
 * through `onChange`).
 */
export function handleCodeKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, onChange: (value: string) => void): boolean {
  const t = e.currentTarget;
  if (e.key === 'Escape') {
    // The next Tab moves focus out of the editor instead of indenting.
    t.dataset.tabExit = 'true';
    return false;
  }
  if (e.key !== 'Tab') delete t.dataset.tabExit;
  if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return false;
  const { value, selectionStart: start, selectionEnd: end } = t;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;

  if (e.key === 'Enter' && !e.shiftKey) {
    const line = value.slice(lineStart, start);
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    const opens = /[{([]\s*$/.test(line);
    const insert = `\n${indent}${opens ? INDENT : ''}`;
    e.preventDefault();
    onChange(value.slice(0, start) + insert + value.slice(end));
    select(t, start + insert.length);
    return true;
  }

  // A closing bracket typed on an indented, otherwise empty line outdents it one level.
  if ((e.key === '}' || e.key === ')' || e.key === ']') && start === end) {
    const before = value.slice(lineStart, start);
    if (before.length >= INDENT.length && /^[ \t]+$/.test(before)) {
      const kept = before.slice(0, before.length - INDENT.length);
      e.preventDefault();
      onChange(value.slice(0, lineStart) + kept + e.key + value.slice(end));
      select(t, lineStart + kept.length + 1);
      return true;
    }
    return false;
  }

  if (e.key !== 'Tab') return false;
  if (t.dataset.tabExit) {
    delete t.dataset.tabExit;
    return false;
  }
  e.preventDefault();
  if (!e.shiftKey && start === end) {
    onChange(`${value.slice(0, start)}${INDENT}${value.slice(end)}`);
    select(t, start + INDENT.length);
    return true;
  }
  // Indent / outdent every selected line.
  const block = value.slice(lineStart, end);
  const lines = block.split('\n');
  const changed = e.shiftKey ? lines.map((l) => l.replace(/^ {1,2}/, '')) : lines.map((l) => `${INDENT}${l}`);
  const next = value.slice(0, lineStart) + changed.join('\n') + value.slice(end);
  const delta = changed.join('\n').length - block.length;
  const firstDelta = (changed[0]?.length ?? 0) - (lines[0]?.length ?? 0);
  onChange(next);
  select(t, Math.max(lineStart, start + firstDelta), end + delta);
  return true;
}

// ---------------------------------------------------------------------------
// CodeEditor
// ---------------------------------------------------------------------------

const PRISM_LANGUAGE = { ts: 'typescript', tsx: 'tsx', js: 'javascript' } as const;

/** Token colours come from CodeViewer.css (`.ub-codeview .token.*`), shared with the code panel. */
const THEME: PrismTheme = { plain: { color: 'var(--ub-text)', backgroundColor: 'transparent' }, styles: [] };

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: keyof typeof PRISM_LANGUAGE;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  invalid?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function CodeEditor({ value, onChange, language = 'ts', invalid, placeholder, autoFocus, className, ...aria }: CodeEditorProps) {
  const lineCount = useMemo(() => value.split('\n').length, [value]);
  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The textarea is as large as the text, so the outer box scrolls; keep the textarea itself at
  // its origin (a momentary internal scroll would misalign the caret and the highlighting).
  const pin = (e: UIEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    if (t.scrollTop || t.scrollLeft) {
      t.scrollTop = 0;
      t.scrollLeft = 0;
    }
  };
  return (
    <div
      className={cx('ub-codeview ub-pw-ed', invalid && 'ub-pw-ed--invalid', className)}
      style={{ ['--ub-pw-ed-gutter' as string]: `${Math.max(2, String(lineCount).length)}ch` }}
      onMouseDown={(e) => {
        // Clicks on the gutter or the empty area below the text place the caret at the end.
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList?.contains('ub-pw-ed__gutter')) {
          e.preventDefault();
          const t = inputRef.current;
          if (t) {
            t.focus();
            t.setSelectionRange(t.value.length, t.value.length);
          }
        }
      }}
    >
      <div className="ub-pw-ed__inner">
        <pre className="ub-pw-ed__gutter" aria-hidden>
          {gutter}
        </pre>
        <div className="ub-pw-ed__area">
          <pre className="ub-pw-ed__hl" aria-hidden>
            <code>
              <Highlight code={value} language={PRISM_LANGUAGE[language]} theme={THEME}>
                {({ tokens }) => (
                  <>
                    {tokens.map((line, i) => (
                      <div key={i} className="ub-pw-ed__line">
                        {line.map((token, j) =>
                          token.empty ? null : token.types.length === 1 && token.types[0] === 'plain' ? (
                            token.content
                          ) : (
                            <span key={j} className={`token ${token.types.join(' ')}`}>
                              {token.content}
                            </span>
                          ),
                        )}
                      </div>
                    ))}
                  </>
                )}
              </Highlight>
            </code>
          </pre>
          <textarea
            ref={inputRef}
            {...aria}
            className="ub-pw-ed__input"
            value={value}
            placeholder={placeholder}
            wrap="off"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus={autoFocus}
            aria-invalid={invalid || undefined}
            aria-multiline="true"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => handleCodeKeyDown(e, onChange)}
            onScroll={pin}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CodeEditorDialog
// ---------------------------------------------------------------------------

export interface CodeEditorDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Short explanation above the editor. */
  intro?: ReactNode;
  /** The editor (a CodeEditor, an ExpressionInput, …) bound to the store value. */
  children: ReactNode;
  /** Status line below the editor (syntax error, live value, …). */
  status?: ReactNode;
  /** Keyboard hint in the footer (defaults to the code editor keys). */
  keys?: ReactNode;
}

const CODE_KEYS = (
  <>
    Changes apply as you type · <kbd>Tab</kbd> indents · <kbd>Esc</kbd> closes
  </>
);

/**
 * A large modal editor. Edits apply as you type; Escape or Done closes it. The first text field
 * inside is focused once the dialog has opened (after the Dialog recorded the opener, so focus
 * returns to the button that opened it).
 */
export function CodeEditorDialog({ open, onClose, title, intro, children, status, keys = CODE_KEYS }: CodeEditorDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const field = bodyRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input');
    if (!field) return;
    field.focus();
    // A one-line value (an expression) continues at its end; longer code opens at the top.
    if (!field.value.includes('\n')) field.setSelectionRange?.(field.value.length, field.value.length);
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={title}
      footer={
        <>
          <span className="ub-pw-bigeditor__keys">{keys}</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="ub-pw-bigeditor">
        {intro && <div className="ub-pw-muted ub-pw-bigeditor__intro">{intro}</div>}
        {children}
        {status}
      </div>
    </Dialog>
  );
}
