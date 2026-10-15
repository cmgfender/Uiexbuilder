import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CodeViewer } from './CodeViewer';

describe('<CodeViewer>', () => {
  it('highlights TSX with token classes and a line-number gutter', () => {
    const code = "import { Text } from '@hubspot/ui-extensions';\n\nexport const x = 1;\n";
    const { container } = render(<CodeViewer code={code} language="tsx" lineNumbers />);
    const region = screen.getByRole('region', { name: 'tsx code' });
    expect(region).toHaveTextContent("import { Text } from '@hubspot/ui-extensions';");
    expect(container.querySelector('.ub-codeview__gutter')?.textContent).toBe('1\n2\n3');
    expect(container.querySelectorAll('.ub-codeview__line')).toHaveLength(3);
    expect(container.querySelector('.token.keyword')?.textContent).toBe('import');
    expect(container.querySelector('.token.string')?.textContent).toBe("'@hubspot/ui-extensions'");
    // The gutter is not selectable text of the code.
    expect(container.querySelector('.ub-codeview__gutter')).toHaveAttribute('aria-hidden', 'true');
  });

  it('maps json, ts, js and markdown, and renders plain text without highlighting', () => {
    const { container, rerender } = render(<CodeViewer code={'{ "a": 1 }'} language="json" />);
    expect(container.querySelector('.token.property')?.textContent).toBe('"a"');
    expect(container.querySelector('.ub-codeview__gutter')).toBeNull();
    rerender(<CodeViewer code="const a: number = 1;" language="ts" />);
    expect(container.querySelector('.token.keyword')?.textContent).toBe('const');
    rerender(<CodeViewer code="exports.main = () => 1;" language="js" />);
    expect(container.querySelector('.token.operator')).not.toBeNull();
    rerender(<CodeViewer code="# Title" language="markdown" />);
    expect(container.querySelector('.token.title')).not.toBeNull();
    rerender(<CodeViewer code={'line 1\nline <2>'} language="text" lineNumbers className="extra" />);
    expect(container.querySelectorAll('.token')).toHaveLength(0);
    expect(container.querySelectorAll('.ub-codeview__line')).toHaveLength(2);
    expect(container.querySelector('.ub-codeview')).toHaveClass('extra');
  });

  it('renders large files quickly', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `  const value${i} = compute(${i}, 'text'); // comment ${i}`);
    const start = performance.now();
    const { container } = render(<CodeViewer code={lines.join('\n')} language="tsx" lineNumbers />);
    const elapsed = performance.now() - start;
    expect(container.querySelectorAll('.ub-codeview__line')).toHaveLength(2000);
    expect(container.querySelector('.ub-codeview__gutter')?.textContent?.endsWith('2000')).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });
});
