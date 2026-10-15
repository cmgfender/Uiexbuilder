/** Props of every dialog mounted by the shell. Each dialog renders only when open. */
export interface DialogComponentProps {
  open: boolean;
  onClose: () => void;
  /** Optional argument passed via useDialogs().open(name, arg). */
  arg?: string | null;
}
