/**
 * The last publish of each project and which "Finish in HubSpot" steps the admin ticked, so the
 * checklist is still there when they come back (localStorage `uiex-builder:publish:<projectId>`;
 * links and ids only — never the personal access key).
 */
import { useCallback, useEffect, useState } from 'react';
import type { DeployStatus } from '../../connect/types';

export const PUBLISH_KEY_PREFIX = 'uiex-builder:publish:';

export interface LastPublish {
  v: 1;
  portalId?: number;
  projectName: string;
  projectUrl?: string;
  installUrl?: string;
  buildId?: number;
  /** ISO time of the publish. */
  at: string;
  /** Checklist items ticked (ChecklistItem.key). */
  done: string[];
}

const SAFE_URL = /^https?:\/\/[^\s"'<>]+$/;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readLastPublish(projectId: string): LastPublish | null {
  try {
    const raw = storage()?.getItem(PUBLISH_KEY_PREFIX + projectId);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<LastPublish>;
    if (!d || typeof d !== 'object' || typeof d.at !== 'string') return null;
    return {
      v: 1,
      portalId: typeof d.portalId === 'number' ? d.portalId : undefined,
      projectName: typeof d.projectName === 'string' ? d.projectName : '',
      projectUrl: typeof d.projectUrl === 'string' && SAFE_URL.test(d.projectUrl) ? d.projectUrl : undefined,
      installUrl: typeof d.installUrl === 'string' && SAFE_URL.test(d.installUrl) ? d.installUrl : undefined,
      buildId: typeof d.buildId === 'number' ? d.buildId : undefined,
      at: d.at,
      done: Array.isArray(d.done) ? d.done.filter((k): k is string => typeof k === 'string').slice(0, 100) : [],
    };
  } catch {
    return null;
  }
}

function write(projectId: string, value: LastPublish): void {
  try {
    storage()?.setItem(PUBLISH_KEY_PREFIX + projectId, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the checklist just isn't remembered */
  }
}

/** Records a successful publish; ticks are kept when it went to the same account again. */
export function recordPublish(projectId: string, status: DeployStatus, now = new Date()): LastPublish {
  const prev = readLastPublish(projectId);
  const value: LastPublish = {
    v: 1,
    portalId: status.portalId,
    projectName: status.projectName,
    projectUrl: status.projectUrl && SAFE_URL.test(status.projectUrl) ? status.projectUrl : undefined,
    installUrl: status.installUrl && SAFE_URL.test(status.installUrl) ? status.installUrl : prev?.installUrl,
    buildId: status.buildId,
    at: now.toISOString(),
    // Installing and placing the card are one-time steps; looking at the card again is worth doing
    // after every publish.
    done: prev && prev.portalId === status.portalId ? prev.done.filter((k) => k !== 'open') : [],
  };
  write(projectId, value);
  return value;
}

export function setChecklistItem(projectId: string, key: string, done: boolean): LastPublish | null {
  const prev = readLastPublish(projectId);
  if (!prev) return null;
  const set = new Set(prev.done);
  if (done) set.add(key);
  else set.delete(key);
  const value = { ...prev, done: [...set] };
  write(projectId, value);
  return value;
}

/** The project's last publish and a setter for checklist ticks (re-read when the project changes). */
export function useLastPublish(projectId: string): {
  last: LastPublish | null;
  record: (status: DeployStatus) => void;
  toggle: (key: string, done: boolean) => void;
} {
  const [last, setLast] = useState<LastPublish | null>(() => readLastPublish(projectId));
  useEffect(() => setLast(readLastPublish(projectId)), [projectId]);
  const record = useCallback((status: DeployStatus) => setLast(recordPublish(projectId, status)), [projectId]);
  const toggle = useCallback((key: string, done: boolean) => setLast(setChecklistItem(projectId, key, done)), [projectId]);
  return { last, record, toggle };
}
