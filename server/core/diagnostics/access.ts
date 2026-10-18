/**
 * Who may open the status page: someone signed in with HubSpot whose HubSpot user email is in
 * ADMIN_EMAILS, or who signed in to a HubSpot account listed in ADMIN_PORTALS. With neither set,
 * nobody can (the page then explains how to set them).
 */
import type { ServerConfig } from '../types';

export function adminConfigured(config: Pick<ServerConfig, 'adminEmails' | 'adminPortals'>): boolean {
  return (config.adminEmails?.length ?? 0) > 0 || (config.adminPortals?.length ?? 0) > 0;
}

export function isAdminUser(config: Pick<ServerConfig, 'adminEmails' | 'adminPortals'>, user: { portalId: number; email?: string }): boolean {
  const email = user.email?.trim().toLowerCase();
  if (email && (config.adminEmails ?? []).includes(email)) return true;
  return (config.adminPortals ?? []).includes(user.portalId);
}
