// @vitest-environment node
/** The status page's settings (ADMIN_EMAILS, ADMIN_PORTALS, the build commit) and how start-up reports them. */
import { describe, expect, it } from 'vitest';
import { configFromEnv, detectBuildCommit, parseEmailList } from '../config';
import { describeStartup } from '../../node';
import { adminConfigured, isAdminUser } from './access';

const BASE = {
  APP_URL: 'https://builder.example.com',
  HUBSPOT_CLIENT_ID: 'client-id-123',
  HUBSPOT_CLIENT_SECRET: 'super-secret-client-secret',
  SESSION_SECRET: 'x'.repeat(40),
  NODE_ENV: 'production',
};
const START = { listenUrl: 'http://localhost:3000', appUrlSource: 'APP_URL', staticRoot: '/app/dist', staticFound: true };

describe('admin settings', () => {
  it('reads ADMIN_EMAILS (any separators, lower-cased, invalid entries skipped) and ADMIN_PORTALS', () => {
    expect(parseEmailList(' Me@Example.com, you@example.org;them@example.net  not-an-email me@example.com')).toEqual(['me@example.com', 'you@example.org', 'them@example.net']);
    expect(parseEmailList(undefined)).toEqual([]);
    const config = configFromEnv({ ...BASE, ADMIN_EMAILS: 'Owner@Example.com', ADMIN_PORTALS: '123, abc, 456' });
    expect(config.adminEmails).toEqual(['owner@example.com']);
    expect(config.adminPortals).toEqual([123, 456]);
    expect(adminConfigured(config)).toBe(true);
    expect(isAdminUser(config, { portalId: 1, email: 'OWNER@example.com' })).toBe(true);
    expect(isAdminUser(config, { portalId: 456 })).toBe(true);
    expect(isAdminUser(config, { portalId: 1, email: 'someone@example.com' })).toBe(false);
    expect(adminConfigured(configFromEnv(BASE))).toBe(false);
  });

  it('knows which commit the host built from', () => {
    expect(detectBuildCommit({ RENDER_GIT_COMMIT: 'ABCDEF1234567890abcdef1234567890abcdef12' })).toBe('abcdef1');
    expect(detectBuildCommit({ VERCEL_GIT_COMMIT_SHA: '0123456789abcdef' })).toBe('0123456');
    expect(detectBuildCommit({ GIT_COMMIT: 'not a sha' })).toBeUndefined();
    expect(configFromEnv({ ...BASE, RENDER_GIT_COMMIT: 'fedcba9876543' }).buildCommit).toBe('fedcba9');
  });

  it('the start-up summary says where the status page is and who may open it (no email addresses)', () => {
    const none = describeStartup(configFromEnv(BASE), START).join('\n');
    expect(none).toContain('Status page:      https://builder.example.com/status - set ADMIN_EMAILS');
    expect(none).toContain('search these logs for "[event]"');
    const set = describeStartup(configFromEnv({ ...BASE, ADMIN_EMAILS: 'owner@example.com, b@example.com', ADMIN_PORTALS: '123' }), START).join('\n');
    expect(set).toContain('(signed-in admins: 2 emails in ADMIN_EMAILS; account 123 (ADMIN_PORTALS))');
    expect(set).not.toContain('owner@example.com');
  });
});
