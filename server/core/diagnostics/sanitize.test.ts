// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cleanClientError, cleanLine, cleanPath, cleanStack, maskSensitive, stripQueryStrings } from './sanitize';

// Token-shaped values are assembled at runtime (never written out whole in the repo).
const KEY = ['CiRuYTEt', 'NDdmYjU2ZGYtYzFjOS00MmI5LWE2'].join('');
const PRIVATE_APP_TOKEN = ['pat', 'na1', 'abcd1234-ef56-7890-abcd-ef1234567890'].join('-');

describe('sanitize', () => {
  it('drops query strings and fragments but keeps line numbers', () => {
    expect(stripQueryStrings('at f (https://b.example/assets/index-B2x9.js?v=3:10:5)')).toBe('at f (https://b.example/assets/index-B2x9.js:10:5)');
    expect(stripQueryStrings('GET https://b.example/api/crm?q=ada&code=xyz failed')).toBe('GET https://b.example/api/crm failed');
    expect(stripQueryStrings('fetch /api/crm/records/contacts/search?q=ada failed')).toBe('fetch /api/crm/records/contacts/search failed');
    expect(stripQueryStrings('see https://b.example/#section')).toBe('see https://b.example/');
  });

  it('masks emails, bearer tokens, keys and private app tokens, but not file paths', () => {
    expect(maskSensitive(`user ada@example.com with ${KEY}`)).toBe('user [email] with [redacted]');
    expect(maskSensitive(`Bearer ${KEY}`)).toBe('Bearer [redacted]');
    expect(maskSensitive(`token ${PRIVATE_APP_TOKEN}`)).toBe('token [redacted]');
    const frame = 'at x (http://localhost:5203/node_modules/.vite/deps/react-dom_client.js:12:3)';
    expect(maskSensitive(frame)).toBe(frame);
    expect(maskSensitive('ConnectButtonPopoverRenderer')).toBe('ConnectButtonPopoverRenderer');
  });

  it('cuts messages and stacks to size and drops control characters', () => {
    expect(cleanLine(`a\u0000b\nc${'x'.repeat(500)}`, 20)).toBe(`a b c${'x'.repeat(14)}…`);
    const stack = cleanStack(Array.from({ length: 30 }, (_, i) => `    at f${i} (https://b.example/a.js?x=1:${i}:1)`).join('\n'))!;
    expect(stack.split('\n')).toHaveLength(12);
    expect(stack).not.toContain('?x=1');
    expect(cleanStack('   ')).toBeUndefined();
  });

  it('keeps only builder paths and simple build ids', () => {
    expect(cleanPath('/status?token=abc#x')).toBe('/status');
    expect(cleanPath('https://evil.example/')).toBeUndefined();
    expect(cleanClientError({ message: 'boom', build: 'B2x9<script>' })).toEqual({ source: 'error', message: 'boom' });
    expect(cleanClientError({ message: '   ' })).toBeNull();
    expect(cleanClientError({ message: 'x', source: 'react', name: 'Type Error!' })).toEqual({ source: 'react', message: 'x' });
  });
});
