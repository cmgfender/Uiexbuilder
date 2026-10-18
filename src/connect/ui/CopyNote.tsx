/**
 * "Copy a note for …": copies a ready-made message for whoever can fix a problem (the person who set
 * up the builder, a Super Admin) and confirms it. Without clipboard access the note is shown,
 * selected, ready for Ctrl+C. "Show the note" lets people read it first.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../../ui';

export interface CopyNoteProps {
  note: string;
  /** Button label, e.g. "Copy a note for whoever set up this builder". */
  label: string;
  /** Who to send it to, for the confirmation ("whoever set up this builder"). */
  recipient: string;
  variant?: 'primary' | 'default';
}

export function CopyNote({ note, label, recipient, variant = 'primary' }: CopyNoteProps) {
  const id = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState<'copied' | 'select' | null>(null);
  const [showNote, setShowNote] = useState(false);

  useEffect(() => {
    if (showNote) noteRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [showNote]);

  const copy = async () => {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('no clipboard');
      await navigator.clipboard.writeText(note);
      setCopied('copied');
    } catch {
      setShowNote(true);
      setCopied('select');
      requestAnimationFrame(() => {
        noteRef.current?.focus();
        noteRef.current?.select();
      });
    }
  };

  return (
    <div className="ub-cn-copynote">
      <div className="ub-cn-copynote__row">
        <Button size="sm" variant={variant} icon={copied === 'copied' ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} onClick={() => void copy()}>
          {label}
        </Button>
        <button type="button" className="ub-cn-disclosure" aria-expanded={showNote} aria-controls={`${id}-note`} onClick={() => setShowNote((v) => !v)}>
          {showNote ? 'Hide the note' : 'Show the note'}
        </button>
      </div>
      {copied && (
        <p className="ub-cn-copynote__status" role="status">
          {copied === 'copied' ? `Copied. Paste it into an email or chat to ${recipient}.` : 'The note is selected below — press Ctrl+C (⌘C on a Mac) to copy it.'}
        </p>
      )}
      <div id={`${id}-note`}>
        {showNote && <textarea ref={noteRef} className="ub-textarea ub-cn-copynote__text" readOnly rows={7} value={note} aria-label="Note to send" />}
      </div>
    </div>
  );
}
