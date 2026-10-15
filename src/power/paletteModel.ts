/**
 * Ranking of command palette results: fuzzy search over titles (keywords and subtitles count with
 * less weight), grouped for display. With an empty query: recent commands first, then every
 * command that can run right now (disabled ones only appear in search results, with their reason).
 */
import { GROUP_ORDER, type Command, type CommandGroup } from './commands';
import { fuzzyMatch, SCORE } from './fuzzy';

/** At most this many results are rendered. */
export const MAX_RESULTS = 50;
/** Recent commands shown above everything else when the query is empty. */
export const MAX_RECENT_SHOWN = 5;

export type DisplayGroup = CommandGroup | 'Recent';

export interface RankedCommand {
  command: Command;
  /** Group heading the result is listed under. */
  group: DisplayGroup;
  /** Matched character positions in the title (for highlighting). */
  indices: number[];
  score: number;
}

export interface RankResult {
  /** Results in display order (grouped). */
  items: RankedCommand[];
  /** How many commands matched in total (before the MAX_RESULTS cap). */
  total: number;
}

const groupRank = (g: CommandGroup) => {
  const i = GROUP_ORDER.indexOf(g);
  return i === -1 ? GROUP_ORDER.length : i;
};

/** Score of one command for a (non-empty) query, or null when it does not match. */
export function scoreCommand(command: Command, query: string): { score: number; indices: number[] } | null {
  let best: { score: number; indices: number[] } | null = null;
  const title = fuzzyMatch(query, command.title);
  if (title) best = title;
  for (const kw of command.keywords ?? []) {
    if (!kw) continue;
    const m = fuzzyMatch(query, kw);
    if (m && m.score >= SCORE.substring) {
      const s = m.score * 0.85;
      if (!best || s > best.score) best = { score: s, indices: [] };
    }
  }
  if (command.subtitle) {
    const m = fuzzyMatch(query, command.subtitle);
    if (m && m.score >= SCORE.wordsAtStarts) {
      const s = m.score * 0.6;
      if (!best || s > best.score) best = { score: s, indices: [] };
    }
  }
  return best;
}

/** Groups results (in order of their best item) without changing order within a group. */
function grouped(items: RankedCommand[]): RankedCommand[] {
  const order: DisplayGroup[] = [];
  const byGroup = new Map<DisplayGroup, RankedCommand[]>();
  for (const item of items) {
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, []);
      order.push(item.group);
    }
    byGroup.get(item.group)!.push(item);
  }
  return order.flatMap((g) => byGroup.get(g)!);
}

export function rankCommands(commands: Command[], query: string, recent: string[] = [], limit = MAX_RESULTS): RankResult {
  const q = query.trim();
  const recentRank = new Map(recent.map((id, i) => [id, i]));

  if (!q) {
    const byId = new Map(commands.map((c) => [c.id, c]));
    const recentItems: RankedCommand[] = [];
    for (const id of recent) {
      const c = byId.get(id);
      if (!c || c.disabledReason || recentItems.length >= MAX_RECENT_SHOWN) continue;
      recentItems.push({ command: c, group: 'Recent', indices: [], score: 0 });
    }
    const shown = new Set(recentItems.map((r) => r.command.id));
    // Commands that cannot run right now are only listed when searched for.
    const rest = commands
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !shown.has(c.id) && !c.disabledReason)
      .sort((a, b) => groupRank(a.c.group) - groupRank(b.c.group) || a.i - b.i)
      .map(({ c }): RankedCommand => ({ command: c, group: c.group, indices: [], score: 0 }));
    const all = [...recentItems, ...rest];
    return { items: all.slice(0, limit), total: all.length };
  }

  const matches: Array<RankedCommand & { order: number }> = [];
  commands.forEach((c, order) => {
    const m = scoreCommand(c, q);
    if (!m) return;
    let score = m.score;
    if (c.disabledReason) score -= 60;
    const r = recentRank.get(c.id);
    if (r !== undefined) score += 15 - r;
    matches.push({ command: c, group: c.group, indices: m.indices, score, order });
  });
  matches.sort((a, b) => b.score - a.score || groupRank(a.command.group) - groupRank(b.command.group) || a.order - b.order);
  const top = matches.slice(0, limit).map(({ order: _order, ...rest }) => rest);
  return { items: grouped(top), total: matches.length };
}
