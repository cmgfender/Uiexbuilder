/** Where the private Status page lives (no dependencies: src/main.tsx imports this before anything else). */
import { STATUS_PAGE_PATH } from './types';

export { STATUS_PAGE_PATH };

/** True for /status (and /status/, /status/anything). */
export function isStatusPath(pathname: string): boolean {
  return pathname === STATUS_PAGE_PATH || pathname.startsWith(`${STATUS_PAGE_PATH}/`);
}
