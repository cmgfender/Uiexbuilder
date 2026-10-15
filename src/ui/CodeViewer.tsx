/**
 * Read-only code viewer with syntax highlighting (prism-react-renderer), a line-number gutter,
 * horizontal scrolling and selection-friendly text (line numbers are not part of the selection).
 * Tokens are memoised per (code, language) and colours come from CSS classes, so large files
 * (1000+ lines) render without per-token style work.
 */
import { memo, useMemo } from 'react';
import { Highlight, type PrismTheme } from 'prism-react-renderer';
import './CodeViewer.css';

export interface CodeViewerProps {
  code: string;
  /** 'tsx' | 'ts' | 'js' | 'json' | 'markdown' | 'text' */
  language: string;
  /** Show line numbers. */
  lineNumbers?: boolean;
  className?: string;
}

/** Maps our language names to Prism grammars bundled with prism-react-renderer. */
const PRISM_LANGUAGE: Record<string, string> = {
  tsx: 'tsx',
  jsx: 'jsx',
  ts: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  javascript: 'javascript',
  json: 'json',
  markdown: 'markdown',
  md: 'markdown',
};

/**
 * Light theme matching the builder chrome. Token colours live in CodeViewer.css (`.ub-codeview .token.*`)
 * so the theme only sets the plain text colour; `styles` stays empty to avoid per-token style objects.
 */
const THEME: PrismTheme = { plain: { color: 'var(--ub-text)', backgroundColor: 'transparent' }, styles: [] };

function PlainLines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="ub-codeview__line">
          {line}
        </div>
      ))}
    </>
  );
}

function CodeViewerImpl({ code, language, lineNumbers = false, className }: CodeViewerProps) {
  const text = code.endsWith('\n') ? code.slice(0, -1) : code;
  const lineCount = useMemo(() => text.split('\n').length, [text]);
  const gutter = useMemo(() => {
    if (!lineNumbers) return null;
    let s = '';
    for (let i = 1; i <= lineCount; i++) s += i === lineCount ? String(i) : `${i}\n`;
    return s;
  }, [lineNumbers, lineCount]);
  const prismLang = PRISM_LANGUAGE[language];
  const width = String(lineCount).length;

  return (
    <div
      className={['ub-codeview', className].filter(Boolean).join(' ')}
      style={{ ['--ub-codeview-gutter' as string]: `${Math.max(2, width)}ch` }}
      role="region"
      aria-label={`${language} code`}
      tabIndex={0}
    >
      <div className="ub-codeview__inner">
        {gutter !== null && (
          <pre className="ub-codeview__gutter" aria-hidden>
            {gutter}
          </pre>
        )}
        <pre className="ub-codeview__code">
          <code>
            {prismLang ? (
              <Highlight code={text} language={prismLang} theme={THEME}>
                {({ tokens }) => (
                  <>
                    {tokens.map((line, i) => (
                      <div key={i} className="ub-codeview__line">
                        {line.length === 1 && line[0].empty ? null : (
                          line.map((token, j) =>
                            token.types.length === 1 && token.types[0] === 'plain' ? (
                              token.content
                            ) : (
                              <span key={j} className={`token ${token.types.join(' ')}`}>
                                {token.content}
                              </span>
                            ),
                          )
                        )}
                      </div>
                    ))}
                  </>
                )}
              </Highlight>
            ) : (
              <PlainLines lines={text.split('\n')} />
            )}
          </code>
        </pre>
      </div>
    </div>
  );
}

/** Memoised: re-renders only when code, language, lineNumbers or className change. */
export const CodeViewer = memo(CodeViewerImpl);
