/**
 * Read-only code viewer. STUB (plain <pre>) — the panels module upgrades it to syntax highlighting
 * (prism-react-renderer) without changing the props.
 */
export interface CodeViewerProps {
  code: string;
  /** 'tsx' | 'ts' | 'js' | 'json' | 'markdown' | 'text' */
  language: string;
  /** Show line numbers. */
  lineNumbers?: boolean;
  className?: string;
}

export function CodeViewer({ code, className }: CodeViewerProps) {
  return (
    <pre className={className} style={{ margin: 0, padding: 12, overflow: 'auto' }}>
      <code>{code}</code>
    </pre>
  );
}
