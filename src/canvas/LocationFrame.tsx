/**
 * HubSpot-like surroundings for the card, per extension location. Purely decorative stubs (greyed
 * record summary, tab bars, panel headers) so designers see the card in context; the HubSpot chrome
 * can be switched off to show the bare card at the location's width.
 */
import { memo, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { ExtensionLocation } from '../model/types';
import { cx } from '../ui';
import { CHROME_ATTR } from './domHit';

export interface FrameInfo {
  location: ExtensionLocation;
  extName: string;
  appName: string;
  /** Mock record name (left summary / panel header). */
  recordName: string;
  /** Mock record subtitle (job title / email ...). */
  recordDetail: string;
  /** Singular object label, e.g. "contact". */
  objectLabel: string;
}

/** Natural card widths (px) per location. */
export const LOCATION_WIDTH: Record<ExtensionLocation, number> = {
  'crm.record.tab': 720,
  'crm.record.sidebar': 360,
  'crm.preview': 480,
  'helpdesk.sidebar': 400,
  settings: 960,
  home: 1200,
};

export const LOCATION_LABEL: Record<ExtensionLocation, string> = {
  'crm.record.tab': 'Record page · middle column tab',
  'crm.record.sidebar': 'Record page · right sidebar',
  'crm.preview': 'Record preview panel',
  'helpdesk.sidebar': 'Help desk · ticket sidebar',
  settings: 'App settings page',
  home: 'App home page',
};

interface LocationFrameProps {
  info: FrameInfo;
  chrome: boolean;
  /** Width of the app home / settings page (responsive up to 1200 / 960px). */
  homeWidth: number;
  /** Narrow stage: the record page hides its summary column so the card fits. */
  compact?: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The card body (hsp-root with the rendered extension). */
  children: ReactNode;
}

function Skeleton({ w, h = 8, round }: { w: number | string; h?: number; round?: boolean }) {
  return <span className={cx('ub-cv-skel', round && 'ub-cv-skel--round')} style={{ width: w, height: h }} />;
}

function AppCaption({ appName }: { appName: string }) {
  return <span className="ub-cv-card__app">App: {appName || 'Untitled app'}</span>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'R';
}

/** Collapsible sidebar section header (record sidebar, preview panel, help desk). */
function SectionHeader({ info, collapsed, onToggle }: { info: FrameInfo; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="ub-cv-side-head"
      aria-expanded={!collapsed}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={collapsed ? 'Expand card section' : 'Collapse card section'}
      {...{ [CHROME_ATTR]: '' }}
    >
      {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
      <span className="ub-cv-side-head__title">{info.extName || 'Untitled card'}</span>
      <AppCaption appName={info.appName} />
    </button>
  );
}

function GreySection({ label }: { label: string }) {
  return (
    <div className="ub-cv-side-stub" aria-hidden>
      <ChevronRight size={14} />
      <span>{label}</span>
    </div>
  );
}

export const LocationFrame = memo(function LocationFrame({
  info,
  chrome,
  homeWidth,
  compact,
  collapsed,
  onToggleCollapsed,
  children,
}: LocationFrameProps) {
  const { location } = info;
  const width = location === 'home' || location === 'settings' ? homeWidth : LOCATION_WIDTH[location];

  if (!chrome) {
    return (
      <section className="ub-cv-card ub-cv-card--bare" style={{ width }} aria-label={`${info.extName} card`}>
        {children}
      </section>
    );
  }

  switch (location) {
    case 'crm.record.tab':
      return (
        <div className={cx('ub-cv-loc ub-cv-loc--record', compact && 'ub-cv-loc--compact')} data-location={location}>
          <aside className="ub-cv-rec-left" aria-hidden>
            <div className="ub-cv-rec-avatar">{initials(info.recordName)}</div>
            <div className="ub-cv-rec-name">{info.recordName}</div>
            <div className="ub-cv-rec-detail">{info.recordDetail}</div>
            <div className="ub-cv-rec-actions">
              {['Note', 'Email', 'Call', 'Task', 'Meet'].map((a) => (
                <span key={a} className="ub-cv-rec-action">
                  <Skeleton w={24} h={24} round />
                  <span>{a}</span>
                </span>
              ))}
            </div>
            <div className="ub-cv-rec-section">
              <div className="ub-cv-rec-section__title">About this {info.objectLabel}</div>
              <Skeleton w="40%" />
              <Skeleton w="75%" />
              <Skeleton w="35%" />
              <Skeleton w="65%" />
              <Skeleton w="45%" />
              <Skeleton w="70%" />
            </div>
          </aside>
          <div className="ub-cv-rec-main">
            <div className="ub-cv-rec-tabs" role="presentation">
              <span className="ub-cv-rec-tab">Overview</span>
              <span className="ub-cv-rec-tab">Activities</span>
              <span className="ub-cv-rec-tab ub-cv-rec-tab--active">{info.extName || 'App tab'}</span>
            </div>
            <section className="ub-cv-card" style={{ width }} aria-label={`${info.extName} card`}>
              <header className="ub-cv-card__head">
                <h3 className="ub-cv-card__title">{info.extName || 'Untitled card'}</h3>
                <AppCaption appName={info.appName} />
              </header>
              {children}
            </section>
          </div>
        </div>
      );

    case 'crm.record.sidebar':
      return (
        <div className="ub-cv-loc ub-cv-loc--sidebar" style={{ width }} data-location={location}>
          <GreySection label={`About this ${info.objectLabel}`} />
          <section className="ub-cv-side-card" aria-label={`${info.extName} card`}>
            <SectionHeader info={info} collapsed={collapsed} onToggle={onToggleCollapsed} />
            <div hidden={collapsed}>{children}</div>
          </section>
          <GreySection label="Companies (1)" />
          <GreySection label="Deals (2)" />
        </div>
      );

    case 'crm.preview':
      return (
        <div className="ub-cv-loc ub-cv-loc--panel" style={{ width }} data-location={location}>
          <header className="ub-cv-panel-head" aria-hidden>
            <div className="ub-cv-rec-avatar ub-cv-rec-avatar--sm">{initials(info.recordName)}</div>
            <div className="ub-cv-panel-head__text">
              <div className="ub-cv-rec-name">{info.recordName}</div>
              <div className="ub-cv-rec-detail">{info.recordDetail}</div>
            </div>
            <X size={16} className="ub-cv-panel-head__close" />
          </header>
          <div className="ub-cv-panel-body">
            <GreySection label={`About this ${info.objectLabel}`} />
            <section className="ub-cv-side-card" aria-label={`${info.extName} card`}>
              <SectionHeader info={info} collapsed={collapsed} onToggle={onToggleCollapsed} />
              <div hidden={collapsed}>{children}</div>
            </section>
          </div>
        </div>
      );

    case 'helpdesk.sidebar':
      return (
        <div className="ub-cv-loc ub-cv-loc--helpdesk" style={{ width }} data-location={location}>
          <header className="ub-cv-help-head" aria-hidden>
            <div className="ub-cv-help-head__eyebrow">Ticket</div>
            <div className="ub-cv-rec-name">{info.recordName}</div>
            <div className="ub-cv-help-pills">
              <span className="ub-cv-help-pill">Open</span>
              <span className="ub-cv-help-pill">High priority</span>
            </div>
          </header>
          <section className="ub-cv-side-card" aria-label={`${info.extName} card`}>
            <SectionHeader info={info} collapsed={collapsed} onToggle={onToggleCollapsed} />
            <div hidden={collapsed}>{children}</div>
          </section>
          <GreySection label="Contact (1)" />
        </div>
      );

    case 'settings':
      return (
        <div className="ub-cv-loc ub-cv-loc--page" style={{ width }} data-location={location}>
          <header className="ub-cv-page-head">
            <div className="ub-cv-page-head__eyebrow">Settings</div>
            <h2 className="ub-cv-page-head__title">{info.appName || 'Untitled app'}</h2>
            <div className="ub-cv-page-tabs" role="presentation">
              <span className="ub-cv-rec-tab ub-cv-rec-tab--active">{info.extName || 'Settings'}</span>
            </div>
          </header>
          <section className="ub-cv-card ub-cv-card--page" aria-label={`${info.extName} page`}>
            {children}
          </section>
        </div>
      );

    case 'home':
    default:
      return (
        <div className="ub-cv-loc ub-cv-loc--page" style={{ width }} data-location={location}>
          <header className="ub-cv-page-head">
            <div className="ub-cv-page-head__eyebrow">App home</div>
            <h2 className="ub-cv-page-head__title">{info.appName || 'Untitled app'}</h2>
          </header>
          <section className="ub-cv-card ub-cv-card--page" aria-label={`${info.extName} page`}>
            {children}
          </section>
        </div>
      );
  }
});
