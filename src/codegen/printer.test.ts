import { describe, expect, it } from 'vitest';
import {
  asConditionalTest,
  asOperand,
  dedentStatements,
  formatJson,
  isJsxTextSafe,
  jsArray,
  jsCode,
  jsObject,
  jsxAttributeString,
  negate,
  normalizeExpression,
  printCall,
  printJs,
  propertyKey,
  quoteString,
  scanCode,
} from './printer';

describe('quoteString', () => {
  it('prefers single quotes and escapes', () => {
    expect(quoteString('hello')).toBe("'hello'");
    expect(quoteString("it's")).toBe('"it\'s"');
    expect(quoteString('a\nb\\c\t')).toBe("'a\\nb\\\\c\\t'");
    expect(quoteString(`'"'`)).toBe(`"'\\"'"`);
  });

  it('round-trips through JavaScript evaluation', () => {
    for (const value of ['plain', "it's", 'say "hi"', 'back\\slash', 'line\nbreak', ' ', '${x}', '`tick`']) {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      expect(new Function(`return ${quoteString(value)};`)()).toBe(value);
    }
  });
});

describe('propertyKey', () => {
  it('quotes keys that are not identifiers', () => {
    expect(propertyKey('label')).toBe('label');
    expect(propertyKey('aria-label')).toBe("'aria-label'");
    expect(propertyKey('12')).toBe('12');
    expect(propertyKey('1a')).toBe("'1a'");
  });
});

describe('JSX escaping', () => {
  it('detects text that can be emitted verbatim', () => {
    expect(isJsxTextSafe('Hello world')).toBe(true);
    expect(isJsxTextSafe("It's \"fine\"")).toBe(true);
    expect(isJsxTextSafe('a {b}')).toBe(false);
    expect(isJsxTextSafe('a < b')).toBe(false);
    expect(isJsxTextSafe('Tom & Jerry')).toBe(false);
    expect(isJsxTextSafe(' padded')).toBe(false);
    expect(isJsxTextSafe('two\nlines')).toBe(false);
  });

  it('uses attribute strings only when safe', () => {
    expect(jsxAttributeString('primary')).toBe('"primary"');
    expect(jsxAttributeString('{not an expression}')).toBe('"{not an expression}"');
    expect(jsxAttributeString('say "hi"')).toBeNull();
    expect(jsxAttributeString('a & b')).toBeNull();
    expect(jsxAttributeString('back\\slash')).toBeNull();
  });
});

describe('scanCode', () => {
  it('finds referenced identifiers, ignoring property names, strings and comments', () => {
    const ids = scanCode("user.name + other?.field + 'quoted' // comment ref\n + /* block */ total").identifiers;
    expect([...ids].sort()).toEqual(['other', 'total', 'user']);
  });

  it('looks into template literal interpolations and spreads', () => {
    expect([...scanCode('`a ${b} c ${d.e}`').identifiers].sort()).toEqual(['b', 'd']);
    expect([...scanCode('{ ...rest, key: value }').identifiers].sort()).toEqual(['key', 'rest', 'value']);
    expect([...scanCode('`outer ${`inner ${deep}`}`').identifiers]).toEqual(['deep']);
  });

  it('skips regex literals', () => {
    expect([...scanCode("text.replace(/it's/g, '')").identifiers]).toEqual(['text']);
  });

  it('reports top-level operators', () => {
    expect(scanCode('a, b').topComma).toBe(true);
    expect(scanCode('f(a, b)').topComma).toBe(false);
    expect(scanCode('a ? b : c').topConditional).toBe(true);
    expect(scanCode('a?.b ?? c').topConditional).toBe(false);
    expect(scanCode('a = 1').topAssignment).toBe(true);
    expect(scanCode('a === 1 && b <= 2').topAssignment).toBe(false);
    expect(scanCode('x => x').topArrow).toBe(true);
    expect(scanCode('a // b').hasLineComment).toBe(true);
    expect(scanCode("'http://x'").hasLineComment).toBe(false);
  });
});

describe('expression helpers', () => {
  it('normalizes user expressions', () => {
    expect(normalizeExpression('  count + 1; ')).toBe('count + 1');
    expect(normalizeExpression("count // the count\n + 1")).toBe('count \n + 1');
    expect(normalizeExpression("'https://x.com' // url")).toBe("'https://x.com'");
  });

  it('adds parentheses only where needed', () => {
    expect(asOperand('a, b')).toBe('(a, b)');
    expect(asOperand('a + b')).toBe('a + b');
    expect(asConditionalTest('a || b')).toBe('a || b');
    expect(asConditionalTest('a ? b : c')).toBe('(a ? b : c)');
    expect(negate('enabled')).toBe('!enabled');
    expect(negate('a.b')).toBe('!a.b');
    expect(negate('a || b')).toBe('!(a || b)');
  });
});

describe('printJs / printCall', () => {
  const options = jsArray([
    jsObject([
      ['label', jsCode("'Alpha'")],
      ['value', jsCode("'a'")],
    ]),
    jsObject([
      ['label', jsCode("'Beta'")],
      ['value', jsCode("'b'")],
    ]),
  ]);

  it('keeps values on one line when they fit', () => {
    expect(printJs(options, 0)).toEqual(["[{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }]"]);
  });

  it('breaks arrays and objects with trailing commas when they do not fit', () => {
    expect(printJs(options, 40)).toEqual([
      '[',
      "  { label: 'Alpha', value: 'a' },",
      "  { label: 'Beta', value: 'b' },",
      ']',
    ]);
  });

  it('measures nested values from their line indentation', () => {
    const long = jsObject([['filters', jsArray([jsObject([['propertyName', jsCode("'city'")], ['value', jsCode("'Boston'")]])])]]);
    // Starts at column 40 of a line indented by 20: the object breaks, its entries fit at 22.
    expect(printJs(long, 20, 40)).toEqual(['{', "  filters: [{ propertyName: 'city', value: 'Boston' }],", '}']);
  });

  it('lays out calls like prettier', () => {
    expect(printCall('f', [jsCode('a'), jsCode('b')], 0)).toEqual(['f(a, b)']);
    const obj = jsObject([
      ['method', jsCode("'POST'")],
      ['body', jsCode('{ name, email, phone, company, website }')],
    ]);
    expect(printCall('hubspot.fetch', [jsCode("'https://api.example.com/save'"), obj], 6, 6)).toEqual([
      "hubspot.fetch('https://api.example.com/save', {",
      "  method: 'POST',",
      '  body: { name, email, phone, company, website },',
      '})',
    ]);
    const longUrl = jsCode('`https://api.example.com/a/very/long/path/${toText(name)}/more`');
    expect(printCall('hubspot.fetch', [longUrl, jsObject([['method', jsCode("'GET'")]])], 6, 30)).toEqual([
      'hubspot.fetch(',
      '  `https://api.example.com/a/very/long/path/${toText(name)}/more`,',
      "  { method: 'GET' },",
      ')',
    ]);
  });
});

describe('formatJson', () => {
  it('keeps short primitive arrays inline like the HubSpot templates', () => {
    expect(formatJson({ uid: 'x', config: { objectTypes: ['contacts'], empty: [], nested: { a: 1 } } })).toBe(
      '{\n  "uid": "x",\n  "config": {\n    "objectTypes": ["contacts"],\n    "empty": [],\n    "nested": {\n      "a": 1\n    }\n  }\n}\n',
    );
  });

  it('breaks long arrays and drops undefined values', () => {
    const scopes = Array.from({ length: 6 }, (_, i) => `crm.objects.custom_object_${i}.read`);
    const out = formatJson({ scopes, skip: undefined });
    expect(out).toContain('"scopes": [\n    "crm.objects.custom_object_0.read",');
    expect(out).not.toContain('skip');
    expect(JSON.parse(out)).toEqual({ scopes });
  });
});

describe('dedentStatements', () => {
  it('removes common indentation', () => {
    expect(dedentStatements('    a();\n      b();\n')).toEqual(['a();', '  b();']);
  });

  it('keeps lines untouched when a literal spans lines', () => {
    expect(dedentStatements('  const s = `a\n  b`;')).toEqual(['  const s = `a', '  b`;']);
  });
});
