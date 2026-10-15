/** Tiny method + path-pattern router (`/api/crm/properties/:objectType`). */
import type { Route } from './types';
import { ConnectorError } from './http';

interface CompiledRoute {
  route: Route;
  regex: RegExp;
  keys: string[];
}

export type RouteMatch =
  | { kind: 'match'; route: Route; params: Record<string, string> }
  | { kind: 'method-not-allowed'; allow: string[] }
  | { kind: 'not-found' };

function compile(route: Route): CompiledRoute {
  const keys: string[] = [];
  const source = route.path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { route, regex: new RegExp(`^${source}$`), keys };
}

/** Drop a trailing slash ("/api/me/" → "/api/me"). */
export function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

export class Router {
  private readonly compiled: CompiledRoute[] = [];

  constructor(routes: Route[] = []) {
    for (const r of routes) this.add(r);
  }

  add(route: Route): this {
    this.compiled.push(compile(route));
    return this;
  }

  get routes(): Route[] {
    return this.compiled.map((c) => c.route);
  }

  match(method: string, pathname: string): RouteMatch {
    const path = normalizePath(pathname);
    const allow = new Set<string>();
    for (const c of this.compiled) {
      const m = c.regex.exec(path);
      if (!m) continue;
      if (c.route.method !== method) {
        allow.add(c.route.method);
        continue;
      }
      const params: Record<string, string> = {};
      c.keys.forEach((key, i) => {
        try {
          params[key] = decodeURIComponent(m[i + 1]);
        } catch {
          throw new ConnectorError(400, 'bad_request', 'The address contains invalid characters.');
        }
      });
      return { kind: 'match', route: c.route, params };
    }
    if (allow.size > 0) return { kind: 'method-not-allowed', allow: [...allow] };
    return { kind: 'not-found' };
  }
}
