// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEPLOY_LIMITS, filePathProblem, isIgnoredOnUpload, readProjectConfig, uploadSourceFiles, validateDeployFiles } from './paths';
import { sampleProjectFiles } from './testFixtures';

describe('filePathProblem', () => {
  it('accepts clean relative POSIX paths', () => {
    for (const p of ['hsproject.json', 'src/app/cards/DealCard.tsx', 'src/app/functions/get-weather.js', 'src/app/données/é.json', '.gitignore']) {
      expect(filePathProblem(p)).toBeNull();
    }
  });

  it('rejects traversal, absolute, Windows and odd paths', () => {
    const bad: Array<[unknown, RegExp]> = [
      ['', /empty/],
      [undefined, /empty/],
      [42, /empty/],
      ['../etc/passwd', /\. or \.\./],
      ['src/../../x', /\. or \.\./],
      ['src/./x', /\. or \.\./],
      ['/etc/passwd', /relative/],
      ['C:/Windows/x', /relative/],
      ['src\\app\\x.ts', /backslash/],
      ['src//x', /empty folder/],
      ['src/x/', /empty folder/],
      ['src/a\u0000b', /control/],
      ['src/a\nb', /control/],
      ['src/a:b', /not allowed/],
      ['src/a*b', /not allowed/],
      [' src/x', /space/],
      ['src/x ', /space/],
      ['a'.repeat(DEPLOY_LIMITS.maxPathLength + 1), /longer than/],
      [`src/${'b'.repeat(DEPLOY_LIMITS.maxSegmentLength + 1)}`, /longer than/],
    ];
    for (const [p, re] of bad) expect(filePathProblem(p), String(p)).toMatch(re);
  });
});

describe('validateDeployFiles', () => {
  it('accepts the generated project', () => {
    const files = sampleProjectFiles();
    const r = validateDeployFiles(files);
    expect(r.problems).toEqual([]);
    expect(r.files).toHaveLength(files.length);
  });

  it('reports every bad entry in plain language', () => {
    const r = validateDeployFiles([
      { path: 'ok.txt', contents: 'x' },
      { path: '../escape.txt', contents: 'x' },
      { path: 'ok.txt', contents: 'again' },
      { path: 'OK.txt', contents: 'case' },
      { path: 'bin', contents: 5 },
      null,
    ]);
    expect(r.files.map((f) => f.path)).toEqual(['ok.txt']);
    expect(r.problems.join('\n')).toMatch(/\.\.\/escape\.txt: the file path must not contain \. or \.\. folders/);
    expect(r.problems.join('\n')).toMatch(/ok\.txt: the file is listed twice/);
    expect(r.problems.join('\n')).toMatch(/OK\.txt: clashes with ok\.txt/);
    expect(r.problems.join('\n')).toMatch(/bin: the file contents must be text/);
    expect(r.problems.join('\n')).toMatch(/not an object/);
  });

  it('enforces count and size limits', () => {
    expect(validateDeployFiles('nope').problems[0]).toMatch(/missing/);
    expect(validateDeployFiles([]).problems[0]).toMatch(/no files/);
    const many = Array.from({ length: DEPLOY_LIMITS.maxFiles + 1 }, (_, i) => ({ path: `f${i}.txt`, contents: '' }));
    expect(validateDeployFiles(many).problems[0]).toMatch(/limit is 400/);
    const big = validateDeployFiles([{ path: 'big.txt', contents: 'x'.repeat(DEPLOY_LIMITS.maxFileBytes + 1) }]);
    expect(big.problems[0]).toMatch(/big\.txt: the file is 1\.0 MB; the limit is 1\.0 MB per file/);
    const chunk = 'é'.repeat(400 * 1024); // 800 KB in UTF-8
    const total = validateDeployFiles(Array.from({ length: 5 }, (_, i) => ({ path: `p${i}.txt`, contents: chunk })));
    expect(total.problems[0]).toMatch(/add up to 3\.9 MB; the limit is 3\.5 MB/);
  });

  it('rejects a file that is also a folder', () => {
    const r = validateDeployFiles([
      { path: 'src/app', contents: '' },
      { path: 'src/app/x.json', contents: '' },
    ]);
    expect(r.problems.join(' ')).toMatch(/src\/app is a file, so it cannot also be a folder/);
  });
});

describe('upload selection', () => {
  it('follows HubSpot ignore rules', () => {
    for (const p of ['.env', 'app/.prettierrc.json', 'node_modules/x/index.js', 'app/cards/node_modules/a.js', 'npm-debug.log', 'a.swp', 'notes.txt~', 'Thumbs.db', '__MACOSX/x', 'hubspot.config.yml', '.git/config']) {
      expect(isIgnoredOnUpload(p), p).toBe(true);
    }
    for (const p of ['app/cards/DealCard.tsx', 'app/functions/package-lock.json', 'app/cards/eslint.config.js', 'app/app-hsmeta.json']) {
      expect(isIgnoredOnUpload(p), p).toBe(false);
    }
  });

  it('reads hsproject.json and keeps only srcDir files, relative to srcDir', () => {
    const files = sampleProjectFiles();
    const { config, problem } = readProjectConfig(files);
    expect(problem).toBeNull();
    expect(config).toEqual({ name: 'deal-desk', srcDir: 'src', platformVersion: '2026.03' });
    const src = uploadSourceFiles(files, 'src');
    const paths = src.map((f) => f.path);
    expect(paths).toContain('app/app-hsmeta.json');
    expect(paths).toContain('app/cards/DealCard.tsx');
    expect(paths).not.toContain('app/cards/.prettierrc.json');
    expect(paths.some((p) => p.startsWith('src/') || p === 'hsproject.json' || p === 'README.md')).toBe(false);
    expect([...paths].sort()).toEqual(paths);
  });

  it('normalises srcDir and reports bad project configs', () => {
    const cfg = (contents: string) => readProjectConfig([{ path: 'hsproject.json', contents }]);
    expect(cfg('{"srcDir":"./src/"}').config?.srcDir).toBe('src');
    expect(cfg('{"srcDir":"."}').config?.srcDir).toBe('');
    expect(cfg('{"srcDir":"../outside"}').problem).toMatch(/inside the project/);
    expect(cfg('{"name":"x"}').problem).toMatch(/srcDir/);
    expect(cfg('not json').problem).toMatch(/not valid JSON/);
    expect(cfg('[]').problem).toMatch(/JSON object/);
    expect(readProjectConfig([]).config).toBeNull();
    expect(uploadSourceFiles([{ path: 'hsproject.json', contents: '{}' }, { path: 'app/a.json', contents: '' }], '').map((f) => f.path)).toEqual(['app/a.json', 'hsproject.json']);
  });
});
