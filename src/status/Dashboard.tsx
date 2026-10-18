/**
 * The status page for admins: counters for the last hour / day, what needs attention (grouped,
 * with what it means and how to fix it), a filterable timeline and what the server is set up with.
 * Refreshes every 30 seconds while the tab is visible.
 */
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Download,
  ExternalLink,
  Info,
  LogIn,
  RefreshCw,
  Rocket,
  Search,
  Server,
  XCircle,
} from 'lucide-react';
import { Button, Segmented, Switch, cx } from '../ui';
import { describeError } from '../connect/describe';
import { isAbortError } from '../connect/client';
import { fetchDiagnostics } from './api';
import { FIX_OWNER_LABEL, explainEvent, feedbackLabel, formatDuration, type ExplainContext, type Explanation, type ExplanationTone } from './explain';
import { DEFAULT_FILTER, attentionItems, clockTime, filterEvents, groupOf, relativeTime, type AttentionItem, type EventFilter, type EventGroup } from './model';
import { currentBuild } from './reporter';
import { statusContext } from './context';
import type { DiagnosticCounters, DiagnosticEvent, DiagnosticsSnapshot } from './types';

export const REFRESH_MS = 30_000;
const PAGE_SIZE = 50;
const AUTO_KEY = 'uiex-builder:status:auto-refresh';

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeAuto(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
  } catch {
    /* per-browser convenience only */
  }
}

const TONE_ICON: Record<ExplanationTone, ReactNode> = {
  ok: <CheckCircle2 size={16} aria-hidden />,
  info: <Info size={16} aria-hidden />,
  warning: <AlertTriangle size={16} aria-hidden />,
  danger: <XCircle size={16} aria-hidden />,
  pending: <CircleDashed size={16} aria-hidden />,
};

const TONE_LABEL: Record<ExplanationTone, string> = { ok: 'Worked', info: 'Note', warning: 'Warning', danger: 'Problem', pending: 'In progress' };

const GROUP_LABEL: Record<ReturnType<typeof groupOf>, string> = { signin: 'Sign-in', publish: 'Publish', errors: 'Error', server: 'Server' };

export function Dashboard() {
  const [snap, setSnap] = useState<DiagnosticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [auto, setAuto] = useState(readAuto);
  const [range, setRange] = useState<'hour' | 'day'>('day');
  const [filter, setFilter] = useState<EventFilter>(DEFAULT_FILTER);
  const ctx = useMemo<ExplainContext>(() => ({ ...statusContext(), currentBuild: currentBuild() }), []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const next = await fetchDiagnostics(signal);
      setSnap(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      if (isAbortError(err)) return;
      setError(describeError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [auto, load]);

  const attention = useMemo(() => (snap ? attentionItems(snap.events, snap.now, ctx) : []), [snap, ctx]);

  useEffect(() => {
    document.title = attention.length ? `(${attention.length}) Builder status` : 'Builder status';
  }, [attention.length]);

  const showInTimeline = (f: EventFilter) => {
    setFilter(f);
    requestAnimationFrame(() => document.getElementById('ub-st-timeline')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const download = () => {
    if (!snap) return;
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `builder-status-${new Date(snap.now).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="ub-st-dash">
      <div className="ub-st-dash__head">
        <div>
          <h1 className="ub-st-title">Builder status</h1>
          <p className="ub-st-subtitle" aria-live="polite">
            {updatedAt ? `Updated ${clockTime(updatedAt, updatedAt)}` : 'Loading…'}
            {auto ? ' · refreshes every 30 seconds' : ''}
          </p>
        </div>
        <div className="ub-st-dash__tools">
          <Switch checked={auto} onChange={(v) => { setAuto(v); writeAuto(v); }} label="Auto-refresh" />
          <Button icon={<RefreshCw size={14} aria-hidden className={cx(loading && 'ub-st-spin')} />} onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
          <Button icon={<Download size={14} aria-hidden />} onClick={download} disabled={!snap} title="Download everything on this page as a JSON file (to share with a developer)">
            Download
          </Button>
        </div>
      </div>

      {error && (
        <div className="ub-st-alert" role="alert">
          <AlertTriangle size={16} aria-hidden />
          <span>{snap ? `Couldn’t refresh: ${error}` : error}</span>
          <Button size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {!snap && !error && (
        <div className="ub-st-checking" role="status">
          Loading the latest events…
        </div>
      )}

      {snap && (
        <div className="ub-st-grid">
          <div className="ub-st-col">
            <MemoryNote snap={snap} />
            <section className="ub-st-section" aria-labelledby="ub-st-summary-title">
              <div className="ub-st-section__head">
                <h2 id="ub-st-summary-title" className="ub-st-h2">
                  At a glance
                </h2>
                <Segmented
                  aria-label="Period"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: 'hour', label: 'Last hour' },
                    { value: 'day', label: 'Last 24 hours' },
                  ]}
                />
              </div>
              <Summary counters={range === 'hour' ? snap.summary.lastHour : snap.summary.lastDay} inProgress={snap.inProgress} onShow={(group) => showInTimeline({ ...DEFAULT_FILTER, group, range })} />
            </section>
            <Attention items={attention} onShow={showInTimeline} />
            <Timeline snap={snap} ctx={ctx} filter={filter} onFilter={setFilter} />
          </div>
          <aside className="ub-st-side" aria-label="About this server">
            <ServerCard snap={snap} ctx={ctx} />
            <PrivacyCard />
          </aside>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ sections

function MemoryNote({ snap }: { snap: DiagnosticsSnapshot }) {
  const since = clockTime(snap.server.startedAt, snap.now);
  return (
    <p className="ub-st-note">
      <Info size={15} aria-hidden />
      <span>
        Showing everything since the server started <strong>{relativeTime(snap.server.startedAt, snap.now)}</strong> ({since}). This list lives in the server’s
        memory: a restart, a new deploy or a free-plan nap after 15 idle minutes clears it. Older events are in your host’s logs — search for{' '}
        <code>[event]</code>.
        {!snap.server.singleProcess && ' On Vercel and Cloudflare each server instance keeps its own list, so this may show only part of the activity.'}
      </span>
    </p>
  );
}

function Stat({ value, label, tone }: { value: number; label: string | [string, string]; tone?: 'ok' | 'warning' | 'danger' | 'pending' }) {
  const text = typeof label === 'string' ? label : value === 1 ? label[0] : label[1];
  return (
    <li className={cx('ub-st-stat', value > 0 && tone && `ub-st-stat--${tone}`)}>
      <span className="ub-st-stat__value">{value}</span> <span className="ub-st-stat__label">{text}</span>
    </li>
  );
}

function Summary({ counters: c, inProgress, onShow }: { counters: DiagnosticCounters; inProgress: DiagnosticsSnapshot['inProgress']; onShow: (group: EventGroup) => void }) {
  const signInProblems = c.signInFailed + c.signInAbandoned;
  const publishProblems = c.publishFailed + c.keyCheckProblems;
  const errors = c.apiErrors + c.clientErrors;
  return (
    <div className="ub-st-cards">
      <SummaryCard icon={<LogIn size={16} aria-hidden />} title="Sign-ins" bad={signInProblems > 0} onShow={() => onShow('signin')}>
        <Stat value={c.signInCompleted} label="signed in" tone="ok" />
        <Stat value={c.signInFailed} label="failed" tone="danger" />
        <Stat value={c.signInAbandoned} label="never came back" tone="warning" />
        {inProgress.signIns > 0 && <Stat value={inProgress.signIns} label="in progress" tone="pending" />}
      </SummaryCard>
      <SummaryCard icon={<Rocket size={16} aria-hidden />} title="Publishes" bad={publishProblems > 0} onShow={() => onShow('publish')}>
        <Stat value={c.publishSucceeded} label="published" tone="ok" />
        <Stat value={c.publishFailed} label="failed" tone="danger" />
        <Stat value={c.keyCheckProblems} label={['key problem', 'key problems']} tone="warning" />
        {inProgress.publishes > 0 && <Stat value={inProgress.publishes} label="in progress" tone="pending" />}
      </SummaryCard>
      <SummaryCard icon={<Bug size={16} aria-hidden />} title="Errors" bad={errors > 0} onShow={() => onShow('errors')}>
        <Stat value={c.apiErrors} label={['refused request', 'refused requests']} tone="warning" />
        <Stat value={c.serverErrors} label={['server error', 'server errors']} tone="danger" />
        <Stat value={c.clientErrors} label={['browser error', 'browser errors']} tone="danger" />
      </SummaryCard>
    </div>
  );
}

function SummaryCard({ icon, title, bad, children, onShow }: { icon: ReactNode; title: string; bad: boolean; children: ReactNode; onShow: () => void }) {
  return (
    <div className={cx('ub-st-card', bad && 'ub-st-card--bad')}>
      <div className="ub-st-card__head">
        <span className="ub-st-card__icon">{icon}</span>
        <h3 className="ub-st-card__title">{title}</h3>
        <button type="button" className="ub-st-link" onClick={onShow}>
          Show<span className="ub-st-sr"> {title.toLowerCase()} in the timeline</span>
        </button>
      </div>
      <ul className="ub-st-stats">{children}</ul>
    </div>
  );
}

function Attention({ items, onShow }: { items: AttentionItem[]; onShow: (f: EventFilter) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 3);
  return (
    <section className="ub-st-section" aria-labelledby="ub-st-attention-title">
      <div className="ub-st-section__head">
        <h2 id="ub-st-attention-title" className="ub-st-h2">
          Needs your attention
        </h2>
        <span className="ub-st-muted">last 24 hours</span>
      </div>
      {items.length === 0 ? (
        <p className="ub-st-allclear">
          <CheckCircle2 size={18} aria-hidden /> Nothing needs your attention. Sign-ins, publishes and the builder itself have been fine.
        </p>
      ) : (
        <ul className="ub-st-attention">
          {shown.map((item) => (
            <li key={item.key} className={cx('ub-st-issue', `ub-st-issue--${item.explanation.tone}`)}>
              <div className="ub-st-issue__head">
                <span className="ub-st-issue__icon">{TONE_ICON[item.explanation.tone]}</span>
                <h3 className="ub-st-issue__title">{item.explanation.title}</h3>
                <span className="ub-st-issue__count">
                  {item.count === 1 ? 'once' : `${item.count} times`}
                  {item.visitors > 1 ? ` · ${item.visitors} visitors` : ''}
                </span>
              </div>
              <ExplanationBody explanation={item.explanation} />
              <div className="ub-st-issue__foot">
                <button type="button" className="ub-st-link" onClick={() => onShow(item.filter)}>
                  Show in the timeline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > 3 && (
        <button type="button" className="ub-st-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show ${items.length - 3} more`}
        </button>
      )}
    </section>
  );
}

function ExplanationBody({ explanation: x, compact }: { explanation: Explanation; compact?: boolean }) {
  return (
    <div className={cx('ub-st-explain', compact && 'ub-st-explain--compact')}>
      {x.meaning && <p className="ub-st-explain__meaning">{x.meaning}</p>}
      {x.visitorSaw && (
        <p className="ub-st-explain__saw">
          <span className="ub-st-explain__label">They saw:</span> “{x.visitorSaw.title}” — {x.visitorSaw.message}
        </p>
      )}
      {x.steps.length > 0 && (
        <>
          <p className="ub-st-explain__who">{FIX_OWNER_LABEL[x.who]}:</p>
          <ol className="ub-st-explain__steps">
            {x.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </>
      )}
      {x.steps.length === 0 && x.who !== 'nobody' && <p className="ub-st-explain__who">{FIX_OWNER_LABEL[x.who]}.</p>}
      {x.links.length > 0 && (
        <p className="ub-st-explain__links">
          {x.links.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
              {l.label} <ExternalLink size={12} aria-hidden />
            </a>
          ))}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ timeline

function Timeline({ snap, ctx, filter, onFilter }: { snap: DiagnosticsSnapshot; ctx: ExplainContext; filter: EventFilter; onFilter: (f: EventFilter) => void }) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const searchId = useId();
  const events = useMemo(() => filterEvents(snap.events, filter, snap.now), [snap, filter]);
  const filtered = filter.group !== 'all' || filter.problemsOnly || filter.range !== 'all' || filter.query.trim() !== '';
  const shown = events.slice(0, limit);
  return (
    <section className="ub-st-section" id="ub-st-timeline" aria-labelledby="ub-st-timeline-title">
      <div className="ub-st-section__head">
        <h2 id="ub-st-timeline-title" className="ub-st-h2">
          Timeline
        </h2>
        <span className="ub-st-muted" aria-live="polite">
          {events.length === snap.events.length ? `${events.length} events` : `${events.length} of ${snap.events.length} events`}
        </span>
      </div>
      <div className="ub-st-filters" role="search">
        <Segmented
          aria-label="Show"
          value={filter.group}
          onChange={(group) => onFilter({ ...filter, group })}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'signin', label: 'Sign-ins' },
            { value: 'publish', label: 'Publishes' },
            { value: 'errors', label: 'Errors' },
          ]}
        />
        <Segmented
          aria-label="When"
          value={filter.range}
          onChange={(range) => onFilter({ ...filter, range })}
          options={[
            { value: 'hour', label: 'Last hour' },
            { value: 'day', label: '24 hours' },
            { value: 'all', label: 'All kept' },
          ]}
        />
        <Switch checked={filter.problemsOnly} onChange={(problemsOnly) => onFilter({ ...filter, problemsOnly })} label="Problems only" />
        <div className="ub-st-search">
          <Search size={14} aria-hidden />
          <label htmlFor={searchId} className="ub-st-sr">
            Search events
          </label>
          <input
            id={searchId}
            type="search"
            className="ub-input"
            placeholder="Code, visitor, account"
            value={filter.query}
            onChange={(e) => onFilter({ ...filter, query: e.target.value })}
          />
        </div>
        {filtered && (
          <button type="button" className="ub-st-link" onClick={() => onFilter(DEFAULT_FILTER)}>
            Clear filters
          </button>
        )}
      </div>
      {events.length === 0 ? (
        <p className="ub-st-empty">{filtered ? 'Nothing matches these filters.' : 'Nothing has happened since the server started.'}</p>
      ) : (
        <ol className="ub-st-events">
          {shown.map((e) => (
            <EventRow key={e.id} event={e} now={snap.now} you={snap.you} ctx={ctx} />
          ))}
        </ol>
      )}
      {events.length > limit && (
        <button type="button" className="ub-st-more" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
          Show {Math.min(PAGE_SIZE, events.length - limit)} more
        </button>
      )}
    </section>
  );
}

function EventRow({ event: e, now, you, ctx }: { event: DiagnosticEvent; now: number; you?: string; ctx: ExplainContext }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const x = explainEvent(e, ctx);
  const group = groupOf(e);
  return (
    <li className={cx('ub-st-event', `ub-st-event--${x.tone}`, open && 'is-open')}>
      <button type="button" className="ub-st-event__row" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span className="ub-st-event__icon" title={TONE_LABEL[x.tone]}>
          {TONE_ICON[x.tone]}
          <span className="ub-st-sr">{TONE_LABEL[x.tone]}: </span>
        </span>
        <span className="ub-st-event__main">
          <span className="ub-st-event__title">{x.title}</span>
          <span className="ub-st-event__meta">
            <span className="ub-st-chip">{GROUP_LABEL[group]}</span>
            {e.count > 1 && <span className="ub-st-chip ub-st-chip--strong">{e.count}×</span>}
            {e.visitor && (
              <span className="ub-st-chip" title="Anonymous visitor (changes every day)">
                Visitor {e.visitor}
                {you && e.visitor === you ? ' (you)' : ''}
              </span>
            )}
            {e.portalId && <span className="ub-st-chip">Account {e.portalId}</span>}
            {e.code && <code className="ub-st-chip ub-st-chip--code">{e.code}</code>}
            {e.durationMs !== undefined && e.outcome !== 'pending' && <span className="ub-st-chip">{formatDuration(e.durationMs)}</span>}
          </span>
        </span>
        <span className="ub-st-event__time" title={new Date(e.lastAt).toLocaleString()}>
          <span>{clockTime(e.lastAt, now)}</span>
          <span className="ub-st-muted">{relativeTime(e.lastAt, now)}</span>
        </span>
        <span className="ub-st-event__chev" aria-hidden>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>
      <div id={id} hidden={!open} className="ub-st-event__details">
        <ExplanationBody explanation={x} compact />
        <Facts event={e} now={now} you={you} />
      </div>
    </li>
  );
}

function Facts({ event: e, now, you }: { event: DiagnosticEvent; now: number; you?: string }) {
  const rows: Array<[string, ReactNode]> = [];
  rows.push([e.count > 1 ? 'First / last' : 'When', e.count > 1 ? `${clockTime(e.at, now)} / ${clockTime(e.lastAt, now)}` : clockTime(e.at, now)]);
  if (e.count > 1) rows.push(['How often', `${e.count} times`]);
  if (e.visitor) rows.push(['Visitor', `${e.visitor}${you === e.visitor ? ' (you)' : ''}`]);
  if (e.portalId) rows.push(['HubSpot account', String(e.portalId)]);
  if (e.code) rows.push(['Code', <code key="c">{e.code}</code>]);
  if (e.status) rows.push(['HTTP status', String(e.status)]);
  if (e.route) rows.push(['Request', <code key="r">{e.route}</code>]);
  if (e.stage) rows.push(['Stopped', e.stage.replace('_', ' ')]);
  if (e.mode) rows.push(['Sign-in window', e.mode === 'redirect' ? 'Full page (this tab)' : 'Pop-up window']);
  if (e.feedback) rows.push(['They said', feedbackLabel(e.feedback)]);
  if (e.developerProjects) rows.push(['Developer projects permission', e.developerProjects]);
  if (e.buildId) rows.push(['HubSpot build', `#${e.buildId}`]);
  if (e.durationMs !== undefined) rows.push(['Took', formatDuration(e.durationMs)]);
  if (e.errorName) rows.push(['Error type', e.errorName]);
  if (e.version) rows.push(['Version', e.version]);
  if (e.client) {
    if (e.client.name) rows.push(['Error type', e.client.name]);
    rows.push(['Message', e.client.message]);
    if (e.client.path) rows.push(['Page', <code key="p">{e.client.path}</code>]);
    if (e.client.build) rows.push(['Builder build', <code key="b">{e.client.build}</code>]);
  }
  return (
    <div className="ub-st-facts">
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="ub-st-facts__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {e.client?.stack && (
        <details className="ub-st-stack">
          <summary>Technical details (stack)</summary>
          <pre>{e.client.stack}</pre>
        </details>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ side cards

function ServerCard({ snap, ctx }: { snap: DiagnosticsSnapshot; ctx: ExplainContext }) {
  const s = snap.server;
  const rows: Array<[string, ReactNode, ('ok' | 'warning')?]> = [
    ['Started', `${relativeTime(s.startedAt, snap.now)} (${clockTime(s.startedAt, snap.now)})`],
    ['Version', `${s.version}${s.commit ? ` · commit ${s.commit}` : ''}`],
    ['This page’s build', ctx.currentBuild ?? 'dev'],
    [
      'Sign in with HubSpot',
      s.signInConfigured ? 'Ready' : `Not set up (missing ${s.missingSettings.join(', ')})`,
      s.signInConfigured ? 'ok' : 'warning',
    ],
    ['Publish to HubSpot', s.deployEnabled ? 'On' : 'Off', s.deployEnabled ? 'ok' : undefined],
    ['Accounts that may sign in', s.allowedPortals.length ? s.allowedPortals.join(', ') : 'Any (ALLOWED_PORTALS is empty)'],
    [
      'Admins',
      [s.adminEmailCount ? `${s.adminEmailCount} email${s.adminEmailCount === 1 ? '' : 's'}` : '', s.adminPortals.length ? `account ${s.adminPortals.join(', ')}` : '']
        .filter(Boolean)
        .join(' + ') || 'None',
    ],
    ['Events kept', `${snap.capacity.kept} of ${snap.capacity.max}${snap.capacity.dropped ? ` (${snap.capacity.dropped} older ones dropped)` : ''}`],
  ];
  return (
    <section className="ub-st-card ub-st-side__card" aria-labelledby="ub-st-server-title">
      <div className="ub-st-card__head">
        <span className="ub-st-card__icon">
          <Server size={16} aria-hidden />
        </span>
        <h2 id="ub-st-server-title" className="ub-st-card__title">
          This server
        </h2>
      </div>
      <dl className="ub-st-kv">
        {rows.map(([k, v, tone]) => (
          <div key={k} className="ub-st-kv__row">
            <dt>{k}</dt>
            <dd className={cx(tone && `ub-st-kv--${tone}`)}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="ub-st-side__links">
        <a href={ctx.setupUrl} target="_blank" rel="noreferrer">
          Setup checklist <ExternalLink size={12} aria-hidden />
        </a>
        <a href={ctx.docsUrl} target="_blank" rel="noreferrer">
          Hosting guide <ExternalLink size={12} aria-hidden />
        </a>
      </p>
    </section>
  );
}

function PrivacyCard() {
  return (
    <section className="ub-st-card ub-st-side__card ub-st-side__card--quiet" aria-labelledby="ub-st-privacy-title">
      <h2 id="ub-st-privacy-title" className="ub-st-card__title">
        What is recorded
      </h2>
      <ul className="ub-st-side__list">
        <li>Sign-ins, publishes, refused requests and errors in visitors’ browsers — with codes, never messages people typed.</li>
        <li>Visitors are an anonymous code that changes every day, plus the HubSpot account they signed in to. No names, emails or IP addresses.</li>
        <li>Never tokens, keys, cookies or CRM records.</li>
        <li>Only the admins in ADMIN_EMAILS / ADMIN_PORTALS can open this page.</li>
      </ul>
    </section>
  );
}
