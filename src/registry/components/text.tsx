/**
 * Text & content components: Text, Heading, Image, Icon, Illustration, List, Tag, StatusTag, Tooltip.
 *
 * REFERENCE PATTERN: `Text` below shows the conventions every component definition follows —
 * exact prop names from @hubspot/ui-extensions, inspector metadata, and a preview that spreads
 * `rootProps` on its outermost element and styles itself with `hsp-` classes.
 *
 * Source of truth: node_modules/@hubspot/ui-extensions/dist/shared.synced/types/components/
 * (text, heading, image, icon, illustration, list, tag, status-tag, tooltip).synced.d.ts.
 */
import type { CSSProperties, KeyboardEvent, ReactNode, SyntheticEvent } from 'react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlarmClockIcon,
  AppWindowIcon,
  ArrowDown01Icon,
  ArrowDown10Icon,
  ArrowDownAZIcon,
  ArrowDownIcon,
  ArrowDownWideNarrowIcon,
  ArrowDownZAIcon,
  ArrowUpIcon,
  ArrowUpNarrowWideIcon,
  AtSignIcon,
  BadgeCheckIcon,
  BanIcon,
  BaselineIcon,
  BellIcon,
  BellOffIcon,
  BookOpenCheckIcon,
  BookOpenIcon,
  BookOpenTextIcon,
  BotIcon,
  Building2Icon,
  CalendarClockIcon,
  CalendarIcon,
  CalendarSyncIcon,
  CaptionsIcon,
  CaseSensitiveIcon,
  ChartColumnIcon,
  ChartLineIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleEllipsisIcon,
  CircleIcon,
  CircleMinusIcon,
  CirclePlayIcon,
  CircleQuestionMarkIcon,
  CircleStopIcon,
  CircleXIcon,
  ClapperboardIcon,
  ClipboardListIcon,
  ClipboardPenIcon,
  ClockIcon,
  CloudUploadIcon,
  CogIcon,
  ContactIcon,
  CopyIcon,
  DatabaseZapIcon,
  DownloadIcon,
  EarthIcon,
  EllipsisIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  FileSlidersIcon,
  FilesIcon,
  FileVideoCameraIcon,
  FlameIcon,
  FlaskConicalIcon,
  FolderCodeIcon,
  FolderIcon,
  FolderOpenIcon,
  ForwardIcon,
  FrownIcon,
  FunnelIcon,
  GaugeIcon,
  GiftIcon,
  GitMergeIcon,
  GlobeIcon,
  GraduationCapIcon,
  HashIcon,
  HeadingIcon,
  HistoryIcon,
  HourglassIcon,
  HouseIcon,
  ImageIcon,
  ImagesIcon,
  InboxIcon,
  InfoIcon,
  KeyIcon,
  LandmarkIcon,
  LanguagesIcon,
  LayoutTemplateIcon,
  LightbulbIcon,
  Link2Icon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  LockIcon,
  MailIcon,
  MailOpenIcon,
  MapPinIcon,
  MegaphoneIcon,
  MehIcon,
  MessageCircleQuestionMarkIcon,
  MessageSquareIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  NetworkIcon,
  PackageIcon,
  PaletteIcon,
  PaperclipIcon,
  PencilIcon,
  PencilOffIcon,
  PhoneIcon,
  PhoneMissedIcon,
  PhoneOffIcon,
  PhoneOutgoingIcon,
  PinIcon,
  PlusIcon,
  PresentationIcon,
  PuzzleIcon,
  QuoteIcon,
  ReceiptIcon,
  ReceiptTextIcon,
  Redo2Icon,
  RefreshCcwIcon,
  RefreshCwIcon,
  ReplaceIcon,
  ReplyAllIcon,
  RotateCwIcon,
  RouteIcon,
  RssIcon,
  SaveIcon,
  ScanEyeIcon,
  ScanSearchIcon,
  ScrollTextIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  ShoppingCartIcon,
  SignalIcon,
  SignalLowIcon,
  SignatureIcon,
  SmartphoneIcon,
  SmileIcon,
  SparklesIcon,
  SpellCheckIcon,
  SquareCheckIcon,
  StarIcon,
  StrikethroughIcon,
  SunIcon,
  TableIcon,
  TabletIcon,
  TagIcon,
  TargetIcon,
  TextAlignJustifyIcon,
  TextAlignStartIcon,
  TextQuoteIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TicketIcon,
  Trash2Icon,
  TriangleAlertIcon,
  TrophyIcon,
  TypeIcon,
  Undo2Icon,
  UploadIcon,
  UserIcon,
  UserPlusIcon,
  VideoIcon,
  VoicemailIcon,
  WandSparklesIcon,
  WorkflowIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import type { ComponentDef, EnumOption, EventDef, PreviewProps, PropDef, SlotDef } from '../types';
import type { IconName } from '../constants';
import { STANDARD_DOCS, enumOptions } from '../constants';
import type { UINode } from '../../model/types';
import { cx, hrefUrl, normalizeSize, str } from '../../preview/util';
import '../../preview/styles/text.css';

// ---------------------------------------------------------------------------
// Shared definition pieces
// ---------------------------------------------------------------------------

const TEST_ID_PROP: PropDef = {
  name: 'testId',
  label: 'Test ID',
  type: { kind: 'string' },
  group: 'Advanced',
  description: 'Used by findByTestId() to locate this component in tests.',
};

/** Image and Tag are overlay triggers: clicking them opens the attached Modal/Panel (or shows a Tooltip). */
const OVERLAY_SLOT: SlotDef = {
  name: 'overlay',
  label: 'Overlay',
  accepts: ['Modal', 'Panel', 'Tooltip'],
  max: 1,
  description: 'A Modal or Panel opened on click, or a Tooltip shown on hover.',
};

/** `onClick: ReactionsHandler<ExtensionEvent>` — HubSpot passes (event, reactions). */
const ON_CLICK_EVENT: EventDef = {
  name: 'onClick',
  label: 'On click',
  description: 'Runs when the component is clicked.',
  params: [{ name: 'event', description: 'ExtensionEvent { type, bubbles, timeStamp, id }' }],
};

/** Mirrors HubSpot's ExtensionEvent ({ type, bubbles, timeStamp, id }) handed to onClick handlers. */
function extensionEvent(e: SyntheticEvent, id: string) {
  return { type: e.type, bubbles: e.bubbles, timeStamp: e.timeStamp, id };
}

// ---------------------------------------------------------------------------
// Defensive prop readers (props may come from arbitrary user expressions)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Boolean prop: true only for `true` (or the string 'true' produced by text templates). */
function bool(v: unknown): boolean {
  return v === true || v === 'true';
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Positive pixel number from a number or numeric string; undefined otherwise. */
function px(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function hasEvent(node: UINode, name: string): boolean {
  return (node.events?.[name]?.length ?? 0) > 0;
}

function hasOverlay(node: UINode): boolean {
  return (node.slots?.overlay?.length ?? 0) > 0;
}

/** Own-property lookup so names like "constructor" never resolve to Object.prototype members. */
function lookup<V>(table: Record<string, V>, key: string): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** 'electronicSignatureEmptyState' -> 'Electronic signature empty state'. */
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const FONT_WEIGHTS: Record<string, number> = { regular: 400, demibold: 600, bold: 700 };

function TextPreview({ props, text, rootProps }: PreviewProps) {
  const format = isRecord(props.format) ? props.format : {};
  // `truncate` is `boolean | { maxWidth?: number; tooltipText?: string }`.
  const truncate = props.truncate;
  const truncateOptions = isRecord(truncate) ? truncate : null;
  const truncated = bool(truncate) || truncateOptions !== null;
  const maxWidth = truncateOptions ? px(truncateOptions.maxWidth) : undefined;

  const style: CSSProperties = {
    fontWeight: typeof format.fontWeight === 'string' ? FONT_WEIGHTS[format.fontWeight] : undefined,
    fontStyle: bool(format.italic) ? 'italic' : undefined,
    textDecoration:
      format.lineDecoration === 'underline'
        ? 'underline'
        : format.lineDecoration === 'strikethrough'
          ? 'line-through'
          : undefined,
    textTransform:
      format.textTransform === 'uppercase' || format.textTransform === 'lowercase' || format.textTransform === 'capitalize'
        ? format.textTransform
        : undefined,
    maxWidth: maxWidth !== undefined ? `${maxWidth}px` : undefined,
  };
  let content = text;
  if (format.textTransform === 'sentenceCase' && content) {
    content = content.charAt(0).toUpperCase() + content.slice(1).toLowerCase();
  }
  // HubSpot shows the full text (or the custom tooltipText) in a tooltip when truncated.
  const truncateTitle = truncated
    ? truncateOptions && typeof truncateOptions.tooltipText === 'string' && truncateOptions.tooltipText
      ? truncateOptions.tooltipText
      : content
    : undefined;
  const inline = bool(props.inline);
  const Tag = inline ? 'span' : 'p';
  return (
    <Tag
      {...rootProps}
      className={cx(
        'hsp-text',
        props.variant === 'microcopy' && 'hsp-microcopy',
        truncated && 'hsp-truncate',
        inline && 'hsp-inline',
        rootProps.className,
      )}
      style={style}
      title={rootProps.title ?? truncateTitle}
    >
      {content || ' '}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Heading
// ---------------------------------------------------------------------------

function HeadingPreview({ props, text, rootProps }: PreviewProps) {
  const inline = bool(props.inline);
  const Tag = inline ? 'span' : 'h2';
  return (
    <Tag {...rootProps} className={cx('hsp-heading', inline && 'hsp-inline', rootProps.className)}>
      {text || ' '}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

const DEFAULT_IMAGE_SRC = 'https://placehold.co/400x200/png?text=Image';

function ImagePreview({ node, props, rootProps, trigger, mode }: PreviewProps) {
  const src = typeof props.src === 'string' ? props.src.trim() : '';
  const alt = str(props.alt);
  const width = px(props.width);
  const height = px(props.height);
  const url = hrefUrl(props.href);
  // Remember which src failed so a new src gets a fresh attempt without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src !== '' && failedSrc !== src;
  const clickable = Boolean(url) || hasEvent(node, 'onClick') || hasOverlay(node);

  const media = showImage ? (
    <img
      className="hsp-image-img"
      src={src}
      alt={alt}
      draggable={false}
      style={{ width: width !== undefined ? `${width}px` : undefined, height: height !== undefined ? `${height}px` : 'auto' }}
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <span
      className="hsp-placeholder-media hsp-image-placeholder"
      role="img"
      aria-label={alt || 'Image'}
      style={{ width: `${width ?? 240}px`, height: `${height ?? Math.round((width ?? 240) / 2)}px` }}
    >
      <ImageIcon size={20} aria-hidden />
      <span>{src ? alt || 'Image could not be loaded' : 'Set an image source'}</span>
    </span>
  );

  const className = cx('hsp-image', clickable && 'hsp-clickable', rootProps.className);
  const onClick = (e: SyntheticEvent) => trigger('onClick', extensionEvent(e, node.id));
  // Links only become real anchors in preview mode (design-mode anchors are inert and would swallow
  // selection clicks). They always open in a new tab so the builder itself never navigates away.
  if (url && mode === 'preview') {
    return (
      <a {...rootProps} className={className} href={url} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {media}
      </a>
    );
  }
  return (
    <span {...rootProps} className={className} onClick={onClick}>
      {media}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

/**
 * How a HubSpot icon name is drawn in the designer: a lucide icon (optionally filled), a brand
 * monogram (lucide ships no brand logos), or one of a few hand-drawn glyphs.
 */
type Glyph =
  | { icon: LucideIcon; fill?: 'solid' | 'tint' }
  | { brand: string }
  | { custom: 'exclamation' | 'infoNoCircle' | 'question' | 'instagram' | 'youtube' };

const l = (icon: LucideIcon, fill?: 'solid' | 'tint'): Glyph => ({ icon, fill });

/** Every HubSpot IconNames key mapped to a look-alike glyph (Record<IconName, ...> keeps it complete). */
const ICON_GLYPHS: Record<IconName, Glyph> = {
  add: l(PlusIcon),
  appointment: l(CalendarClockIcon),
  approvals: l(BadgeCheckIcon),
  artificialIntelligence: l(SparklesIcon),
  artificialIntelligenceEnhanced: l(WandSparklesIcon),
  attach: l(PaperclipIcon),
  bank: l(LandmarkIcon),
  block: l(BanIcon),
  book: l(BookOpenIcon),
  bulb: l(LightbulbIcon),
  callTranscript: l(ScrollTextIcon),
  calling: l(PhoneIcon),
  callingHangup: l(PhoneOffIcon),
  callingMade: l(PhoneOutgoingIcon),
  callingMissed: l(PhoneMissedIcon),
  callingVoicemail: l(VoicemailIcon),
  campaigns: l(MegaphoneIcon),
  cap: l(GraduationCapIcon),
  checkCircle: l(CircleCheckIcon),
  circleFilled: l(CircleIcon, 'solid'),
  circleHollow: l(CircleIcon),
  clock: l(ClockIcon),
  comment: l(MessageSquareIcon),
  contact: l(UserIcon),
  copy: l(CopyIcon),
  crm: l(ContactIcon),
  dataSync: l(RefreshCcwIcon),
  date: l(CalendarIcon),
  delay: l(HourglassIcon),
  delete: l(Trash2Icon),
  description: l(TextAlignStartIcon),
  developerProjects: l(FolderCodeIcon),
  documents: l(FilesIcon),
  downCarat: l(ChevronDownIcon),
  download: l(DownloadIcon),
  edit: l(PencilIcon),
  ellipses: l(EllipsisIcon),
  email: l(MailIcon),
  emailOpen: l(MailOpenIcon),
  emailThreadedReplies: l(ReplyAllIcon),
  enrichment: l(DatabaseZapIcon),
  enroll: l(UserPlusIcon),
  exclamation: { custom: 'exclamation' },
  exclamationCircle: l(CircleAlertIcon),
  faceHappy: l(SmileIcon),
  faceHappyFilled: l(SmileIcon, 'tint'),
  faceNeutral: l(MehIcon),
  faceNeutralFilled: l(MehIcon, 'tint'),
  faceSad: l(FrownIcon),
  faceSadFilled: l(FrownIcon, 'tint'),
  facebook: { brand: 'f' },
  favoriteHollow: l(StarIcon),
  file: l(FileIcon),
  filledXCircleIcon: l(CircleXIcon, 'tint'),
  filter: l(FunnelIcon),
  flame: l(FlameIcon),
  folder: l(FolderIcon),
  folderOpen: l(FolderOpenIcon),
  forward: l(ForwardIcon),
  gauge: l(GaugeIcon),
  generateChart: l(ChartColumnIcon),
  gift: l(GiftIcon),
  globe: l(GlobeIcon),
  globeLine: l(EarthIcon),
  goal: l(TargetIcon),
  googlePlus: { brand: 'G+' },
  guidedActions: l(RouteIcon),
  hash: l(HashIcon),
  hide: l(EyeOffIcon),
  home: l(HouseIcon),
  hubDB: l(TableIcon),
  image: l(ImageIcon),
  imageGallery: l(ImagesIcon),
  inbox: l(InboxIcon),
  info: l(InfoIcon),
  infoNoCircle: { custom: 'infoNoCircle' },
  insertVideo: l(ClapperboardIcon),
  instagram: { custom: 'instagram' },
  integrations: l(PuzzleIcon),
  invoice: l(ReceiptIcon),
  key: l(KeyIcon),
  language: l(LanguagesIcon),
  left: l(ChevronLeftIcon),
  lessCircle: l(CircleMinusIcon),
  lesson: l(BookOpenCheckIcon),
  light: l(SunIcon),
  link: l(LinkIcon),
  linkedin: { brand: 'in' },
  listView: l(ListIcon),
  location: l(MapPinIcon),
  locked: l(LockIcon),
  mention: l(AtSignIcon),
  messages: l(MessagesSquareIcon),
  mobile: l(SmartphoneIcon),
  moreCircle: l(CircleEllipsisIcon),
  notEditable: l(PencilOffIcon),
  notification: l(BellIcon),
  notificationOff: l(BellOffIcon),
  objectAssociations: l(Link2Icon),
  objectAssociationsManyToMany: l(NetworkIcon),
  objectAssociationsManyToOne: l(GitMergeIcon),
  office365: { brand: 'O' },
  order: l(ClipboardListIcon),
  paymentSubscriptions: l(CalendarSyncIcon),
  pin: l(PinIcon),
  pinterest: { brand: 'P' },
  powerPointFile: l(FileSlidersIcon),
  presentation: l(PresentationIcon),
  product: l(PackageIcon),
  publish: l(CloudUploadIcon),
  question: { custom: 'question' },
  questionAnswer: l(MessageCircleQuestionMarkIcon),
  questionCircle: l(CircleQuestionMarkIcon),
  quickbooks: { brand: 'qb' },
  quote: l(QuoteIcon),
  readMore: l(BookOpenTextIcon),
  readOnlyView: l(ScanEyeIcon),
  realEstateListing: l(Building2Icon),
  recentlySelected: l(HistoryIcon),
  record: l(CircleDotIcon),
  redo: l(Redo2Icon),
  refresh: l(RefreshCwIcon),
  registration: l(ClipboardPenIcon),
  remove: l(XIcon),
  replace: l(ReplaceIcon),
  reports: l(ChartLineIcon),
  right: l(ChevronRightIcon),
  robot: l(BotIcon),
  rotate: l(RotateCwIcon),
  rss: l(RssIcon),
  salesQuote: l(ReceiptTextIcon),
  salesTemplates: l(LayoutTemplateIcon),
  save: l(SaveIcon),
  search: l(SearchIcon),
  send: l(SendIcon),
  sequences: l(ListOrderedIcon),
  settings: l(SettingsIcon),
  shoppingCart: l(ShoppingCartIcon),
  signal: l(SignalIcon),
  signalPoor: l(SignalLowIcon),
  signature: l(SignatureIcon),
  snooze: l(AlarmClockIcon),
  sortAlpAsc: l(ArrowDownAZIcon),
  sortAlpDesc: l(ArrowDownZAIcon),
  sortAmtAsc: l(ArrowUpNarrowWideIcon),
  sortAmtDesc: l(ArrowDownWideNarrowIcon),
  sortNumAsc: l(ArrowDown01Icon),
  sortNumDesc: l(ArrowDown10Icon),
  sortTableAsc: l(ArrowUpIcon),
  sortTableDesc: l(ArrowDownIcon),
  spellCheck: l(SpellCheckIcon),
  sprocket: l(CogIcon),
  star: l(StarIcon, 'solid'),
  stopRecord: l(CircleStopIcon),
  strike: l(StrikethroughIcon),
  styles: l(PaletteIcon),
  success: l(CheckIcon),
  tablet: l(TabletIcon),
  tag: l(TagIcon),
  tasks: l(SquareCheckIcon),
  test: l(FlaskConicalIcon),
  text: l(TypeIcon),
  textBodyExpanded: l(TextAlignJustifyIcon),
  textColor: l(BaselineIcon),
  textDataType: l(CaseSensitiveIcon),
  textSnippet: l(TextQuoteIcon),
  thumbsDown: l(ThumbsDownIcon),
  thumbsUp: l(ThumbsUpIcon),
  ticket: l(TicketIcon),
  translate: l(LanguagesIcon),
  trophy: l(TrophyIcon),
  twitter: { brand: 'X' },
  undo: l(Undo2Icon),
  upCarat: l(ChevronUpIcon),
  upload: l(UploadIcon),
  video: l(VideoIcon),
  videoFile: l(FileVideoCameraIcon),
  videoPlayerSubtitles: l(CaptionsIcon),
  view: l(EyeIcon),
  viewDetails: l(ScanSearchIcon),
  warning: l(TriangleAlertIcon),
  website: l(AppWindowIcon),
  workflows: l(WorkflowIcon),
  x: l(XIcon),
  xCircle: l(CircleXIcon),
  xing: { brand: 'xi' },
  youtube: { custom: 'youtube' },
  youtubePlay: l(CirclePlayIcon),
  zoomIn: l(ZoomInIcon),
  zoomOut: l(ZoomOutIcon),
};

/** Stroke paths (24×24 grid, lucide style) for glyphs lucide doesn't provide. */
const CUSTOM_GLYPH_PATHS: Record<'exclamation' | 'infoNoCircle' | 'question' | 'instagram', ReactNode> = {
  exclamation: <path d="M12 4v10M12 19.5v.5" />,
  infoNoCircle: <path d="M12 4.5v.5M10 10h2v9.5M9.5 19.5h5" />,
  question: <path d="M8.5 8.5a3.5 3.5 0 1 1 5.2 3.1c-1 .6-1.7 1.3-1.7 2.4v.5M12 19.5v.5" />,
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5v.01" />
    </>
  ),
};

/** Renders the glyph for a HubSpot icon name at 1em (size is driven by the parent's font-size). */
function IconGlyph({ name }: { name: string }) {
  const glyph = lookup<Glyph>(ICON_GLYPHS, name);
  const svgProps = { width: '1em', height: '1em', 'aria-hidden': true, focusable: false } as const;
  if (!glyph) return <CircleDashedIcon {...svgProps} />;
  if ('icon' in glyph) {
    const Icon = glyph.icon;
    const fill = glyph.fill === 'solid' ? { fill: 'currentColor' } : glyph.fill === 'tint' ? { fill: 'currentColor', fillOpacity: 0.2 } : {};
    return <Icon {...svgProps} strokeWidth={2} {...fill} />;
  }
  if ('brand' in glyph) {
    return (
      <svg viewBox="0 0 24 24" {...svgProps}>
        <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" />
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={glyph.brand.length > 1 ? 9.5 : 13}
          fontWeight={700}
          fontFamily="Arial, Helvetica, sans-serif"
          fill="#ffffff"
        >
          {glyph.brand}
        </text>
      </svg>
    );
  }
  if (glyph.custom === 'youtube') {
    return (
      <svg viewBox="0 0 24 24" {...svgProps}>
        <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" />
        <path d="M10 9l5 3-5 3z" fill="#ffffff" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...svgProps}
    >
      {CUSTOM_GLYPH_PATHS[glyph.custom]}
    </svg>
  );
}

/** Explicit icon sizes; without `size` HubSpot sizes the icon from its parent (we use 1em). */
const ICON_SIZES: Record<string, string> = { small: '12px', medium: '16px', large: '24px' };
const ICON_COLORS = ['alert', 'warning', 'success', 'inherit'] as const;

function IconPreview({ props, rootProps }: PreviewProps) {
  const name = typeof props.name === 'string' ? props.name : '';
  const size = ICON_SIZES[normalizeSize(props.size, '')];
  const color = oneOf(props.color, ICON_COLORS, 'inherit');
  const label = typeof props.screenReaderText === 'string' ? props.screenReaderText : '';
  return (
    <span
      {...rootProps}
      className={cx('hsp-icon', `hsp-icon-${color}`, rootProps.className)}
      style={size ? { fontSize: size } : undefined}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <IconGlyph name={name} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Illustration
// ---------------------------------------------------------------------------

/** Keys of `illustrationNames` (the IllustrationNames type) in @hubspot/ui-extensions 0.17.x. */
const ILLUSTRATION_NAMES = [
  'lock',
  'unlock',
  'electronicSignature',
  'electronicSignatureEmptyState',
  'callingSetUp',
  'companies',
  'contacts',
  'multipleObjects',
  'object',
  'task',
  'deals',
  'registration',
  'developerSecurityUpdate',
  'social',
  'leads',
  'target',
  'emailConfirmation',
  'successfullyConnectedEmail',
  'contentStrategy',
  'addOnReporting',
  'productsShoppingCart',
  'store',
  'storeDisabled',
  'customerSupport',
  'customerExperience',
  'api',
  'integrations',
  'sandboxAddOn',
  'customObjects',
  'paymentsButton',
  'automatedTesting',
  'emptyStateCharts',
  'meetings',
  'tickets',
  'errorGeneral',
  'errorHourglass',
  'middlePaneCards',
  'propertiesSidebar',
  'sidebar',
] as const;
type IllustrationName = (typeof ILLUSTRATION_NAMES)[number];

/** Illustration palette (HubSpot spot-illustration colours). */
const C = {
  navy: '#33475b',
  orange: '#ff7a59',
  teal: '#00a4bd',
  green: '#00bda5',
  yellow: '#f5c26b',
  red: '#f2545b',
  light: '#eaf0f6',
  mid: '#cbd6e2',
  white: '#ffffff',
} as const;
const LINE = { stroke: C.navy, strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const THICK = { strokeWidth: 3.5, strokeLinecap: 'round' } as const;

// Illustration primitives — all drawn in a 200×150 viewBox.

function Doc({ x, y, w, h, lines = 3 }: { x: number; y: number; w: number; h: number; lines?: number }) {
  const f = 12; // folded corner size
  return (
    <g>
      <path d={`M${x} ${y}h${w - f}l${f} ${f}v${h - f}h${-w}z`} fill={C.white} {...LINE} />
      <path d={`M${x + w - f} ${y}v${f}h${f}`} fill="none" {...LINE} />
      {Array.from({ length: lines }, (_, i) => (
        <path key={i} d={`M${x + 10} ${y + 24 + i * 12}H${x + w - (i === lines - 1 ? 26 : 12)}`} stroke={C.mid} {...THICK} />
      ))}
    </g>
  );
}

function Envelope({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={4} fill={C.white} {...LINE} />
      <path d={`M${x + 2} ${y + 3}L${x + w / 2} ${y + h * 0.55}L${x + w - 2} ${y + 3}`} fill="none" {...LINE} />
    </g>
  );
}

function Badge({ cx, cy, r = 13, kind, color }: { cx: number; cy: number; r?: number; kind: 'check' | 'x' | 'plus' | 'slash'; color: string }) {
  const k = r * 0.45;
  const mark = { stroke: C.white, strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  const d = {
    check: `M${cx - k} ${cy}l${k * 0.7} ${k * 0.7}l${k * 1.3} ${-k * 1.4}`,
    x: `M${cx - k} ${cy - k}l${2 * k} ${2 * k}M${cx + k} ${cy - k}l${-2 * k} ${2 * k}`,
    plus: `M${cx - k} ${cy}h${2 * k}M${cx} ${cy - k}v${2 * k}`,
    slash: `M${cx - k} ${cy + k}L${cx + k} ${cy - k}`,
  }[kind];
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} {...LINE} />
      <path d={d} {...mark} />
    </g>
  );
}

function Person({ cx, cy, s, color }: { cx: number; cy: number; s: number; color: string }) {
  return (
    <g>
      <path d={`M${cx - s * 0.42} ${cy + s * 0.5}a${s * 0.42} ${s * 0.4} 0 0 1 ${s * 0.84} 0z`} fill={color} {...LINE} />
      <circle cx={cx} cy={cy - s * 0.12} r={s * 0.22} fill={C.white} {...LINE} />
    </g>
  );
}

function Frame({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={C.white} {...LINE} />
      <path d={`M${x} ${y + 14}h${w}`} {...LINE} />
      {[C.red, C.yellow, C.green].map((fill, i) => (
        <circle key={fill} cx={x + 9 + i * 7} cy={y + 7} r={2} fill={fill} />
      ))}
    </g>
  );
}

function Bars({ x, y, w, h, values, colors }: { x: number; y: number; w: number; h: number; values: number[]; colors: string[] }) {
  const gap = 6;
  const bw = (w - gap * (values.length - 1)) / values.length;
  return (
    <g>
      {values.map((v, i) => (
        <rect key={i} x={x + i * (bw + gap)} y={y + h * (1 - v)} width={bw} height={h * v} rx={2} fill={colors[i % colors.length]} {...LINE} strokeWidth={2} />
      ))}
    </g>
  );
}

function Cube({ cx, cy, s, color }: { cx: number; cy: number; s: number; color: string }) {
  const h = s / 2;
  return (
    <g>
      <path d={`M${cx} ${cy - s}L${cx + s} ${cy - h}L${cx} ${cy}L${cx - s} ${cy - h}z`} fill={C.white} {...LINE} />
      <path d={`M${cx - s} ${cy - h}L${cx} ${cy}L${cx} ${cy + s}L${cx - s} ${cy + h}z`} fill={color} {...LINE} />
      <path d={`M${cx + s} ${cy - h}L${cx} ${cy}L${cx} ${cy + s}L${cx + s} ${cy + h}z`} fill={color} fillOpacity={0.6} {...LINE} />
    </g>
  );
}

function Padlock({ cx, cy, open = false }: { cx: number; cy: number; open?: boolean }) {
  const shackle = open ? `M${cx - 16} ${cy - 4}v-30a16 16 0 0 1 32 0v6` : `M${cx - 16} ${cy - 4}v-14a16 16 0 0 1 32 0v14`;
  return (
    <g>
      <path d={shackle} fill="none" {...LINE} strokeWidth={6} />
      <rect x={cx - 28} y={cy - 6} width={56} height={46} rx={6} fill={open ? C.teal : C.orange} {...LINE} />
      <circle cx={cx} cy={cy + 12} r={5} fill={C.navy} />
      <path d={`M${cx} ${cy + 14}v10`} stroke={C.navy} strokeWidth={4} strokeLinecap="round" />
    </g>
  );
}

function StoreFront({ disabled = false }: { disabled?: boolean }) {
  const accent = disabled ? C.mid : C.orange;
  return (
    <g opacity={disabled ? 0.85 : 1}>
      <rect x={56} y={58} width={88} height={60} fill={C.white} {...LINE} />
      <path d="M50 58l8-24h84l8 24z" fill={accent} {...LINE} />
      <path d="M79 36l-4 20M100 36v20M121 36l4 20" stroke={C.white} strokeWidth={4} />
      <rect x={66} y={78} width={24} height={40} fill={disabled ? C.light : C.teal} {...LINE} />
      <rect x={100} y={76} width={34} height={24} rx={2} fill={C.light} {...LINE} />
      {disabled && <Badge cx={142} cy={104} r={15} kind="slash" color={C.red} />}
    </g>
  );
}

const SHIELD = 'M100 26l36 13v26c0 26-17 42-36 50c-19-8-36-24-36-50v-26z';
const FLASK = 'M93 28v28l-23 40a8 8 0 0 0 7 12h46a8 8 0 0 0 7-12l-23-40v-28z';

/** One drawing per illustration name (simple generic look-alikes of HubSpot's spot illustrations). */
const ILLUSTRATIONS: Record<IllustrationName, () => ReactNode> = {
  lock: () => <Padlock cx={100} cy={70} />,
  unlock: () => (
    <>
      <Padlock cx={100} cy={72} open />
      <Badge cx={136} cy={104} kind="check" color={C.green} />
    </>
  ),
  electronicSignature: () => (
    <>
      <Doc x={64} y={24} w={66} h={92} />
      <path d="M74 98c6-14 10-14 12-2s6 8 10-4 8-6 10 2" fill="none" stroke={C.teal} strokeWidth={3} strokeLinecap="round" />
      <g transform="rotate(40 138 82)">
        <rect x={132} y={50} width={12} height={46} rx={2} fill={C.orange} {...LINE} />
        <path d="M132 96l6 12 6-12z" fill={C.white} {...LINE} />
      </g>
    </>
  ),
  electronicSignatureEmptyState: () => (
    <>
      <Doc x={64} y={24} w={72} h={92} />
      <path d="M76 102h48" stroke={C.mid} strokeWidth={2.5} strokeDasharray="4 5" strokeLinecap="round" />
      <path d="M76 90l6 6m0-6l-6 6" stroke={C.orange} strokeWidth={2.5} strokeLinecap="round" />
    </>
  ),
  callingSetUp: () => (
    <>
      <rect x={74} y={26} width={52} height={94} rx={9} fill={C.white} {...LINE} />
      <rect x={81} y={38} width={38} height={64} rx={3} fill={C.light} />
      <path d="M92 60a14 14 0 0 0 18 18" fill="none" stroke={C.teal} strokeWidth={7} strokeLinecap="round" />
      <circle cx={100} cy={111} r={3} fill={C.navy} />
      <Badge cx={130} cy={36} kind="plus" color={C.orange} />
    </>
  ),
  companies: () => (
    <>
      <rect x={70} y={34} width={52} height={86} rx={3} fill={C.white} {...LINE} />
      {[0, 1, 2, 3].flatMap((r) =>
        [0, 1, 2].map((c) => <rect key={`${r}-${c}`} x={78 + c * 14} y={44 + r * 16} width={8} height={9} rx={1} fill={C.teal} opacity={0.7} />),
      )}
      <rect x={89} y={104} width={14} height={16} fill={C.orange} {...LINE} />
      <rect x={122} y={64} width={30} height={56} rx={3} fill={C.light} {...LINE} />
      <path d="M130 76h14M130 90h14M130 104h14" stroke={C.mid} {...THICK} />
    </>
  ),
  contacts: () => (
    <>
      <rect x={50} y={38} width={100} height={68} rx={6} fill={C.white} {...LINE} />
      <Person cx={78} cy={72} s={40} color={C.orange} />
      <path d="M104 62h32M104 74h24M104 86h28" stroke={C.mid} {...THICK} />
    </>
  ),
  multipleObjects: () => (
    <>
      <Cube cx={78} cy={92} s={20} color={C.teal} />
      <Cube cx={122} cy={92} s={20} color={C.orange} />
      <Cube cx={100} cy={56} s={20} color={C.green} />
    </>
  ),
  object: () => <Cube cx={100} cy={74} s={34} color={C.teal} />,
  task: () => (
    <>
      <rect x={68} y={30} width={64} height={88} rx={6} fill={C.white} {...LINE} />
      <rect x={86} y={23} width={28} height={13} rx={3} fill={C.mid} {...LINE} />
      {[0, 1, 2].map((i) => {
        const y = 50 + i * 22;
        return (
          <g key={i}>
            <rect x={78} y={y} width={12} height={12} rx={2} fill={i < 2 ? C.green : C.white} {...LINE} strokeWidth={2} />
            {i < 2 && <path d={`M80.5 ${y + 6}l3 3l5-6`} stroke={C.white} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
            <path d={`M96 ${y + 6}h${i === 1 ? 18 : 26}`} stroke={C.mid} {...THICK} />
          </g>
        );
      })}
    </>
  ),
  deals: () => (
    <>
      <circle cx={92} cy={70} r={32} fill={C.yellow} {...LINE} />
      <circle cx={92} cy={70} r={23} fill="none" stroke={C.navy} strokeWidth={2} opacity={0.4} />
      <text x={92} y={71} textAnchor="middle" dominantBaseline="central" fontSize={30} fontWeight={700} fontFamily="Arial, Helvetica, sans-serif" fill={C.navy}>
        $
      </text>
      <circle cx={134} cy={100} r={16} fill={C.yellow} {...LINE} />
      <circle cx={134} cy={100} r={10} fill="none" stroke={C.navy} strokeWidth={2} opacity={0.4} />
    </>
  ),
  registration: () => (
    <>
      <Doc x={64} y={24} w={72} h={94} lines={0} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={74} y={40 + i * 20} width={50} height={11} rx={2} fill={C.light} stroke={C.mid} strokeWidth={1.5} />
      ))}
      <rect x={74} y={100} width={26} height={10} rx={2} fill={C.orange} />
    </>
  ),
  developerSecurityUpdate: () => (
    <>
      <path d={SHIELD} fill={C.teal} {...LINE} />
      <path d="M90 60l-9 9 9 9M110 60l9 9-9 9M104 56l-8 26" fill="none" stroke={C.white} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  social: () => (
    <>
      <path d="M48 34h64a8 8 0 0 1 8 8v26a8 8 0 0 1-8 8h-44l-12 10v-10h-8a8 8 0 0 1-8-8v-26a8 8 0 0 1 8-8z" fill={C.teal} {...LINE} />
      {[66, 80, 94].map((x) => (
        <circle key={x} cx={x} cy={55} r={3.5} fill={C.white} />
      ))}
      <path d="M92 66h56a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8h-6v10l-12-10h-38a8 8 0 0 1-8-8v-24a8 8 0 0 1 8-8z" fill={C.orange} {...LINE} />
      <path d="M102 80h40M102 92h26" stroke={C.white} {...THICK} />
    </>
  ),
  leads: () => (
    <>
      <path d="M60 44h80l-30 36v30l-20 10v-40z" fill={C.teal} {...LINE} />
      <circle cx={78} cy={28} r={6} fill={C.orange} {...LINE} strokeWidth={2} />
      <circle cx={100} cy={22} r={6} fill={C.yellow} {...LINE} strokeWidth={2} />
      <circle cx={122} cy={28} r={6} fill={C.green} {...LINE} strokeWidth={2} />
      <Badge cx={136} cy={102} kind="plus" color={C.orange} />
    </>
  ),
  target: () => (
    <>
      <circle cx={96} cy={76} r={42} fill={C.white} {...LINE} />
      <circle cx={96} cy={76} r={30} fill={C.red} {...LINE} />
      <circle cx={96} cy={76} r={18} fill={C.white} {...LINE} />
      <circle cx={96} cy={76} r={7} fill={C.red} {...LINE} />
      <path d="M96 76L146 30" {...LINE} strokeWidth={3} />
      <path d="M140 24l8 8M146 18l8 8" stroke={C.orange} strokeWidth={4} strokeLinecap="round" />
    </>
  ),
  emailConfirmation: () => (
    <>
      <Envelope x={54} y={44} w={88} h={60} />
      <Badge cx={140} cy={46} r={15} kind="check" color={C.green} />
    </>
  ),
  successfullyConnectedEmail: () => (
    <>
      <Envelope x={36} y={50} w={64} h={44} />
      <path d="M104 72h24" stroke={C.navy} strokeWidth={2.5} strokeDasharray="4 5" strokeLinecap="round" />
      <rect x={132} y={50} width={36} height={44} rx={6} fill={C.teal} {...LINE} />
      <path d="M142 66h16M142 78h10" stroke={C.white} strokeWidth={3} strokeLinecap="round" />
      <Badge cx={166} cy={50} r={11} kind="check" color={C.green} />
    </>
  ),
  contentStrategy: () => (
    <>
      <Doc x={48} y={30} w={62} h={84} lines={4} />
      <rect x={104} y={58} width={56} height={56} rx={6} fill={C.white} {...LINE} />
      <Bars x={113} y={68} w={38} h={38} values={[0.45, 0.75, 1]} colors={[C.teal, C.orange, C.green]} />
    </>
  ),
  addOnReporting: () => (
    <>
      <Frame x={44} y={28} w={112} h={88} />
      <Bars x={58} y={56} w={70} h={48} values={[0.4, 0.65, 0.5, 0.9]} colors={[C.teal, C.orange, C.teal, C.green]} />
      <Badge cx={152} cy={110} kind="plus" color={C.orange} />
    </>
  ),
  productsShoppingCart: () => (
    <>
      <rect x={78} y={44} width={22} height={22} rx={2} fill={C.yellow} {...LINE} />
      <rect x={102} y={36} width={26} height={30} rx={2} fill={C.teal} {...LINE} />
      <path d="M44 34h14l12 52h64l10-36H64" fill="none" {...LINE} strokeWidth={3} />
      <circle cx={80} cy={100} r={7} fill={C.white} {...LINE} />
      <circle cx={124} cy={100} r={7} fill={C.white} {...LINE} />
    </>
  ),
  store: () => <StoreFront />,
  storeDisabled: () => <StoreFront disabled />,
  customerSupport: () => (
    <>
      <Person cx={100} cy={82} s={64} color={C.teal} />
      <path d="M82 76v-6a18 18 0 0 1 36 0v6" fill="none" stroke={C.navy} strokeWidth={4} strokeLinecap="round" />
      <rect x={77} y={68} width={9} height={16} rx={4} fill={C.orange} {...LINE} strokeWidth={2} />
      <rect x={114} y={68} width={9} height={16} rx={4} fill={C.orange} {...LINE} strokeWidth={2} />
      <path d="M118 84c0 8-6 10-12 10" fill="none" stroke={C.navy} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={105} cy={94} r={2.5} fill={C.navy} />
    </>
  ),
  customerExperience: () => (
    <>
      <path d="M52 36h96a8 8 0 0 1 8 8v52a8 8 0 0 1-8 8h-56l-16 14v-14h-24a8 8 0 0 1-8-8v-52a8 8 0 0 1 8-8z" fill={C.white} {...LINE} />
      <path d="M100 92c-16-10-24-19-24-28a11 11 0 0 1 24-5a11 11 0 0 1 24 5c0 9-8 18-24 28z" fill={C.red} {...LINE} />
    </>
  ),
  api: () => (
    <>
      <Frame x={44} y={30} w={112} h={82} />
      <path d="M84 64l-12 12 12 12M116 64l12 12-12 12M106 58l-12 36" fill="none" stroke={C.teal} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  integrations: () => (
    <>
      <path d="M56 50h22a8 8 0 1 1 16 0h10v22a8 8 0 1 1 0 16v22h-48z" fill={C.teal} {...LINE} />
      <path d="M108 50h40v60h-40v-22a8 8 0 1 0 0-16z" fill={C.orange} {...LINE} />
    </>
  ),
  sandboxAddOn: () => (
    <>
      <path d="M52 70l48-22 48 22-48 22z" fill={C.light} {...LINE} />
      <path d="M70 72c8-6 16-6 24-1s16 5 24-1" fill="none" stroke={C.yellow} strokeWidth={4} strokeLinecap="round" />
      <path d="M52 70v26l48 22v-26z" fill={C.yellow} {...LINE} />
      <path d="M148 70v26l-48 22v-26z" fill={C.yellow} fillOpacity={0.7} {...LINE} />
      <Badge cx={146} cy={44} kind="plus" color={C.teal} />
    </>
  ),
  customObjects: () => (
    <>
      <Cube cx={96} cy={78} s={32} color={C.orange} />
      <Badge cx={136} cy={42} kind="plus" color={C.green} />
    </>
  ),
  paymentsButton: () => (
    <>
      <rect x={46} y={36} width={92} height={58} rx={7} fill={C.teal} {...LINE} />
      <path d="M47 52h90" stroke={C.navy} strokeWidth={8} />
      <rect x={58} y={64} width={16} height={12} rx={2} fill={C.yellow} {...LINE} strokeWidth={1.5} />
      <rect x={96} y={88} width={62} height={24} rx={4} fill={C.orange} {...LINE} />
      <path d="M110 100h34" stroke={C.white} {...THICK} />
    </>
  ),
  automatedTesting: () => (
    <>
      <path d={FLASK} fill={C.white} />
      <path d="M81 78h38l11 18a8 8 0 0 1-7 12h-46a8 8 0 0 1-7-12z" fill={C.green} />
      <circle cx={96} cy={94} r={3} fill={C.white} />
      <circle cx={106} cy={86} r={2} fill={C.white} />
      <path d={FLASK} fill="none" {...LINE} />
      <path d="M88 28h24" {...LINE} />
      <Badge cx={138} cy={46} kind="check" color={C.teal} />
    </>
  ),
  emptyStateCharts: () => (
    <>
      <path d="M50 28v84h104" fill="none" {...LINE} />
      {[0.4, 0.7, 0.55, 0.9].map((v, i) => (
        <rect key={i} x={62 + i * 24} y={112 - 76 * v} width={16} height={76 * v} rx={2} fill={C.light} stroke={C.mid} strokeWidth={2} strokeDasharray="4 3" />
      ))}
    </>
  ),
  meetings: () => (
    <>
      <rect x={52} y={34} width={84} height={76} rx={6} fill={C.white} {...LINE} />
      <path d="M52 40a6 6 0 0 1 6-6h72a6 6 0 0 1 6 6v12h-84z" fill={C.orange} {...LINE} />
      <path d="M70 28v12M118 28v12" {...LINE} strokeWidth={4} />
      {[0, 1, 2].flatMap((r) =>
        [0, 1, 2, 3, 4].map((c) => (
          <rect key={`${r}-${c}`} x={62 + c * 14} y={60 + r * 14} width={8} height={8} rx={1.5} fill={r === 1 && c === 2 ? C.teal : C.light} />
        )),
      )}
      <circle cx={138} cy={100} r={18} fill={C.white} {...LINE} />
      <path d="M138 90v10l7 5" fill="none" {...LINE} />
    </>
  ),
  tickets: () => (
    <g transform="rotate(-8 100 72)">
      <path d="M50 48h100v16a8 8 0 0 0 0 16v16h-100v-16a8 8 0 0 0 0-16z" fill={C.yellow} {...LINE} />
      <path d="M122 52v40" stroke={C.navy} strokeWidth={2} strokeDasharray="3 4" />
      <path d="M66 64h40M66 78h28" stroke={C.white} strokeWidth={4} strokeLinecap="round" />
    </g>
  ),
  errorGeneral: () => (
    <>
      <Frame x={46} y={30} w={108} h={82} />
      <path d="M100 54l20 36h-40z" fill={C.yellow} {...LINE} />
      <path d="M100 66v10M100 83v.5" stroke={C.navy} strokeWidth={3} strokeLinecap="round" />
    </>
  ),
  errorHourglass: () => (
    <>
      <path d="M82 28h36c0 24-14 34-14 44s14 20 14 44h-36c0-24 14-34 14-44s-14-20-14-44z" fill={C.white} {...LINE} />
      <path d="M88 40h24c-2 10-8 16-12 20c-4-4-10-10-12-20z" fill={C.yellow} />
      <path d="M86 112c2-10 8-16 14-18c6 2 12 8 14 18z" fill={C.yellow} />
      <path d="M100 62v30" stroke={C.yellow} strokeWidth={2} />
      <path d="M74 28h52M74 116h52" {...LINE} strokeWidth={5} />
    </>
  ),
  middlePaneCards: () => (
    <>
      <Frame x={36} y={26} w={128} h={94} />
      <rect x={42} y={46} width={22} height={68} rx={2} fill={C.light} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={72} y={46 + i * 24} width={56} height={18} rx={3} fill={C.white} stroke={i === 0 ? C.orange : C.mid} strokeWidth={2} />
          <path d={`M78 ${55 + i * 24}h${30 - i * 6}`} stroke={C.mid} strokeWidth={3} strokeLinecap="round" />
        </g>
      ))}
      <rect x={136} y={46} width={22} height={68} rx={2} fill={C.light} />
    </>
  ),
  propertiesSidebar: () => (
    <>
      <Frame x={36} y={26} w={128} h={94} />
      <path d="M46 50h60M46 62h44M46 74h52" stroke={C.mid} strokeWidth={4} strokeLinecap="round" />
      <rect x={114} y={44} width={44} height={70} rx={3} fill={C.light} stroke={C.teal} strokeWidth={2} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={120} y={52 + i * 15} width={32} height={9} rx={2} fill={C.white} stroke={C.mid} strokeWidth={1.5} />
      ))}
    </>
  ),
  sidebar: () => (
    <>
      <Frame x={36} y={26} w={128} h={94} />
      <rect x={42} y={46} width={36} height={68} rx={3} fill={C.teal} fillOpacity={0.18} stroke={C.teal} strokeWidth={2} />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M48 ${56 + i * 14}h${22 - (i % 2) * 6}`} stroke={i === 0 ? C.orange : C.teal} strokeWidth={4} strokeLinecap="round" />
      ))}
      <rect x={86} y={46} width={70} height={30} rx={3} fill={C.light} />
      <rect x={86} y={82} width={70} height={32} rx={3} fill={C.light} />
    </>
  ),
};

/** Drawn for names that aren't valid IllustrationNames (e.g. a bad expression value). */
function FallbackIllustration() {
  return (
    <>
      <Frame x={50} y={32} w={100} h={78} />
      <path d="M58 102l24-28 16 18 12-12 30 22z" fill={C.teal} fillOpacity={0.5} {...LINE} />
      <circle cx={124} cy={62} r={8} fill={C.yellow} {...LINE} />
    </>
  );
}

function IllustrationPreview({ props, rootProps }: PreviewProps) {
  const name = typeof props.name === 'string' ? props.name : '';
  const draw = lookup<() => ReactNode>(ILLUSTRATIONS, name);
  const w = px(props.width);
  const h = px(props.height);
  // Artwork is 4:3; fill in whichever dimension is missing.
  const width = w ?? (h !== undefined ? Math.round((h * 4) / 3) : 160);
  const height = h ?? Math.round((width * 3) / 4);
  const alt = typeof props.alt === 'string' ? props.alt : '';
  return (
    <span {...rootProps} className={cx('hsp-illustration', rootProps.className)} role="img" aria-label={alt || undefined}>
      <svg viewBox="0 0 200 150" width={width} height={height} preserveAspectRatio="xMidYMid meet" aria-hidden focusable="false">
        <ellipse cx={100} cy={132} rx={62} ry={6} fill={C.mid} opacity={0.6} />
        <circle cx={100} cy={70} r={58} fill={C.light} />
        <circle cx={38} cy={34} r={3} fill={C.orange} opacity={0.7} />
        <circle cx={166} cy={30} r={2.5} fill={C.teal} />
        <circle cx={34} cy={104} r={2} fill={C.green} />
        {draw ? draw() : <FallbackIllustration />}
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const LIST_VARIANTS = ['unordered', 'unordered-styled', 'ordered', 'ordered-styled', 'inline', 'inline-divided'] as const;

/**
 * HubSpot wraps every child in an <li>. Child previews are rendered as direct children here instead
 * (bullets / numbers / dividers come from CSS on `.hsp-list > *`) so that repeated and conditional
 * children each become their own list item and the canvas sees the real child elements.
 */
function ListPreview({ props, children, rootProps }: PreviewProps) {
  const variant = oneOf(props.variant, LIST_VARIANTS, 'unordered');
  return (
    <div {...rootProps} role="list" className={cx('hsp-list', `hsp-list-${variant}`, rootProps.className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

const TAG_VARIANTS = ['default', 'warning', 'success', 'error', 'info'] as const;

function TagPreview({ node, props, text, rootProps, trigger, mode }: PreviewProps) {
  const variant = oneOf(props.variant, TAG_VARIANTS, 'default');
  const clickable = hasEvent(node, 'onClick') || hasOverlay(node);
  const interactive = clickable && mode === 'preview';
  const fire = (e: SyntheticEvent) => trigger('onClick', extensionEvent(e, node.id));
  return (
    <span
      {...rootProps}
      className={cx('hsp-tag', `hsp-tag-${variant}`, bool(props.inline) && 'hsp-tag-inline', clickable && 'hsp-clickable', rootProps.className)}
      onClick={fire}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fire(e);
              }
            }
          : undefined
      }
    >
      {text || ' '}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatusTag
// ---------------------------------------------------------------------------

const STATUS_VARIANTS = ['default', 'success', 'info', 'warning', 'danger'] as const;

function StatusTagPreview({ node, props, text, rootProps, trigger }: PreviewProps) {
  const variant = oneOf(props.variant, STATUS_VARIANTS, 'default');
  const clickable = hasEvent(node, 'onClick');
  return (
    <span
      {...rootProps}
      className={cx(
        'hsp-status-tag',
        `hsp-status-${variant}`,
        bool(props.hollow) && 'hsp-status-hollow',
        clickable && 'hsp-clickable',
        rootProps.className,
      )}
      // HubSpot calls StatusTag onClick / onRemoveClick with no arguments.
      onClick={() => trigger('onClick')}
    >
      <span className="hsp-status-dot" aria-hidden />
      <span className="hsp-status-label">{text || ' '}</span>
      {bool(props.showRemoveIcon) && (
        <button
          type="button"
          className="hsp-status-remove"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            trigger('onRemoveClick');
          }}
        >
          <XIcon size={12} strokeWidth={2.5} aria-hidden />
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

const TOOLTIP_PLACEMENTS = ['top', 'bottom', 'left', 'right'] as const;

/** Drawn as a static bubble; the arrow points at the trigger (opposite the placement side). */
function TooltipPreview({ props, text, rootProps }: PreviewProps) {
  const placement = oneOf(props.placement, TOOLTIP_PLACEMENTS, 'top');
  return (
    <span {...rootProps} role="tooltip" className={cx('hsp-tooltip', `hsp-tooltip-${placement}`, rootProps.className)}>
      {text || ' '}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const TAG_VARIANT_OPTIONS: EnumOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

const STATUS_VARIANT_OPTIONS: EnumOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'danger', label: 'Danger' },
];

const pixelSizeProps = (subject: string): PropDef[] => [
  { name: 'width', label: 'Width', type: { kind: 'number', min: 0, step: 1 }, group: 'Layout', description: `The pixel width of the ${subject}.` },
  { name: 'height', label: 'Height', type: { kind: 'number', min: 0, step: 1 }, group: 'Layout', description: `The pixel height of the ${subject}.` },
];

export const textComponents: ComponentDef[] = [
  {
    type: 'Text',
    label: 'Text',
    category: 'Text & content',
    description: 'Renders text with formatting options. Supports {{ expressions }} for dynamic values.',
    icon: TypeIcon,
    docsUrl: `${STANDARD_DOCS}/text`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['paragraph', 'label', 'copy', 'body', 'microcopy'],
    children: { mode: 'text', defaultText: 'Text' },
    props: [
      {
        name: 'variant',
        label: 'Variant',
        type: { kind: 'enum', options: [{ value: 'bodytext', label: 'Body text' }, { value: 'microcopy', label: 'Microcopy' }] },
        defaultValue: 'bodytext',
        group: 'Appearance',
        description: 'The style of text to display.',
      },
      {
        name: 'format',
        label: 'Format',
        group: 'Appearance',
        description: 'Font weight, italics, line decoration and capitalization.',
        type: {
          kind: 'object',
          fields: [
            {
              name: 'fontWeight',
              label: 'Font weight',
              type: { kind: 'enum', options: enumOptions('regular', 'demibold', 'bold') },
              defaultValue: 'regular',
            },
            { name: 'italic', label: 'Italic', type: { kind: 'boolean' }, defaultValue: false },
            {
              name: 'lineDecoration',
              label: 'Line decoration',
              type: { kind: 'enum', options: enumOptions('none', 'underline', 'strikethrough') },
              defaultValue: 'none',
            },
            {
              name: 'textTransform',
              label: 'Text transform',
              type: {
                kind: 'enum',
                options: [
                  { value: 'none', label: 'None' },
                  { value: 'uppercase', label: 'UPPERCASE' },
                  { value: 'lowercase', label: 'lowercase' },
                  { value: 'capitalize', label: 'Capitalize Each Word' },
                  { value: 'sentenceCase', label: 'Sentence case' },
                ],
              },
              defaultValue: 'none',
            },
          ],
        },
      },
      {
        name: 'inline',
        label: 'Inline',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Insert the text without breaking the line.',
      },
      {
        // TS type is `boolean | { maxWidth?: number; tooltipText?: string }`. The inspector edits the
        // common boolean form; the object form can be supplied as an expression.
        name: 'truncate',
        label: 'Truncate',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description:
          'Truncate long text to one line; the full text shows in a tooltip on hover. For custom options use an expression such as { maxWidth: 200, tooltipText: "…" }.',
      },
      TEST_ID_PROP,
    ],
    preview: TextPreview,
  },
  {
    type: 'Heading',
    label: 'Heading',
    category: 'Text & content',
    description: 'Large heading text to introduce or separate sections of your extension.',
    icon: HeadingIcon,
    docsUrl: `${STANDARD_DOCS}/heading`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['title', 'header', 'h1', 'h2', 'section'],
    children: { mode: 'text', defaultText: 'Heading' },
    props: [
      {
        name: 'inline',
        label: 'Inline',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Keep the heading on the same line as surrounding content.',
      },
      TEST_ID_PROP,
    ],
    preview: HeadingPreview,
  },
  {
    type: 'Image',
    label: 'Image',
    category: 'Text & content',
    description: 'Displays an image such as a logo or product photo. Can link to a URL or open an overlay on click.',
    icon: ImageIcon,
    docsUrl: `${STANDARD_DOCS}/image`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['picture', 'photo', 'logo', 'img', 'media'],
    children: { mode: 'none' },
    slots: [OVERLAY_SLOT],
    events: [ON_CLICK_EVENT],
    create: () => ({ type: 'Image', props: { src: DEFAULT_IMAGE_SRC, alt: 'Placeholder image' } }),
    props: [
      {
        name: 'src',
        label: 'Source URL',
        type: { kind: 'url' },
        required: true,
        group: 'Content',
        description: 'The URL of the image (or an image imported from your project).',
      },
      {
        name: 'alt',
        label: 'Alt text',
        type: { kind: 'string' },
        group: 'Content',
        description: 'Alternative text describing the image for screen readers.',
      },
      {
        name: 'href',
        label: 'Link',
        type: { kind: 'href' },
        group: 'Behavior',
        description:
          'URL opened when the image is clicked. HubSpot app links open in the same tab, others in a new tab unless "external" is set.',
      },
      ...pixelSizeProps('image'),
      TEST_ID_PROP,
    ],
    preview: ImagePreview,
  },
  {
    type: 'Icon',
    label: 'Icon',
    category: 'Text & content',
    description: 'Renders one of HubSpot’s icons, inline with text or inside other components.',
    icon: StarIcon,
    docsUrl: `${STANDARD_DOCS}/icon`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['glyph', 'symbol', 'pictogram', 'emoji'],
    children: { mode: 'none' },
    create: () => ({ type: 'Icon', props: { name: 'star' } }),
    props: [
      {
        name: 'name',
        label: 'Icon',
        type: { kind: 'icon' },
        required: true,
        group: 'Content',
        description: 'The icon to display.',
      },
      {
        name: 'size',
        label: 'Size',
        type: { kind: 'enum', options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] },
        group: 'Appearance',
        description: 'Overrides the size, which is otherwise set automatically from the parent component.',
      },
      {
        name: 'color',
        label: 'Color',
        type: {
          kind: 'enum',
          options: [
            { value: 'inherit', label: 'Inherit' },
            { value: 'alert', label: 'Alert' },
            { value: 'warning', label: 'Warning' },
            { value: 'success', label: 'Success' },
          ],
        },
        defaultValue: 'inherit',
        group: 'Appearance',
        description: 'The color of the icon.',
      },
      {
        name: 'screenReaderText',
        label: 'Screen reader text',
        type: { kind: 'string' },
        group: 'Content',
        description: 'Text that screen readers read for the icon.',
      },
      TEST_ID_PROP,
    ],
    preview: IconPreview,
  },
  {
    type: 'Illustration',
    label: 'Illustration',
    category: 'Text & content',
    description: 'Renders one of HubSpot’s built-in illustrations, e.g. for empty states or onboarding.',
    icon: PaletteIcon,
    docsUrl: `${STANDARD_DOCS}/illustration`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['artwork', 'graphic', 'empty state', 'drawing', 'picture'],
    children: { mode: 'none' },
    create: () => ({ type: 'Illustration', props: { name: 'contacts', alt: 'Contacts illustration', width: 160 } }),
    props: [
      {
        name: 'name',
        label: 'Illustration',
        type: { kind: 'enum', options: ILLUSTRATION_NAMES.map((value) => ({ value, label: humanize(value) })) },
        required: true,
        group: 'Content',
        description: 'The name of the illustration.',
      },
      {
        name: 'alt',
        label: 'Alt text',
        type: { kind: 'string' },
        required: true,
        group: 'Content',
        description: 'The illustration’s alt text for accessibility.',
      },
      ...pixelSizeProps('illustration'),
      TEST_ID_PROP,
    ],
    preview: IllustrationPreview,
  },
  {
    type: 'List',
    label: 'List',
    category: 'Text & content',
    description: 'A bulleted, numbered or inline list. Each child component becomes a list item.',
    icon: ListIcon,
    docsUrl: `${STANDARD_DOCS}/list`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['bullets', 'numbered', 'ordered', 'unordered', 'ul', 'ol', 'items'],
    children: { mode: 'nodes', placeholder: 'Drop list items here', required: true },
    create: () => ({
      type: 'List',
      props: { variant: 'unordered-styled' },
      children: [
        { type: 'Text', text: 'Confirm budget with the decision maker' },
        { type: 'Text', text: 'Send the proposal' },
        { type: 'Text', text: 'Schedule a product demo' },
      ],
    }),
    props: [
      {
        name: 'variant',
        label: 'Variant',
        type: {
          kind: 'enum',
          options: [
            { value: 'unordered', label: 'Unordered (plain)' },
            { value: 'unordered-styled', label: 'Bulleted' },
            { value: 'ordered', label: 'Ordered (plain)' },
            { value: 'ordered-styled', label: 'Numbered' },
            { value: 'inline', label: 'Inline' },
            { value: 'inline-divided', label: 'Inline, divided' },
          ],
        },
        defaultValue: 'unordered',
        group: 'Appearance',
        description: 'The type of list to render. Styled variants show bullets or numbers.',
      },
      TEST_ID_PROP,
    ],
    preview: ListPreview,
  },
  {
    type: 'Tag',
    label: 'Tag',
    category: 'Text & content',
    description: 'A tag to label or categorize information. Can be clickable or open an overlay.',
    icon: TagIcon,
    docsUrl: `${STANDARD_DOCS}/tag`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['badge', 'label', 'chip', 'pill', 'category'],
    children: { mode: 'text', defaultText: 'New' },
    slots: [OVERLAY_SLOT],
    events: [ON_CLICK_EVENT],
    props: [
      {
        name: 'variant',
        label: 'Variant',
        type: { kind: 'enum', options: TAG_VARIANT_OPTIONS },
        defaultValue: 'default',
        group: 'Appearance',
        description: 'The color of the tag.',
      },
      {
        name: 'inline',
        label: 'Inline',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Allow the tag to sit side-by-side with text.',
      },
      TEST_ID_PROP,
    ],
    preview: TagPreview,
  },
  {
    type: 'StatusTag',
    label: 'Status tag',
    category: 'Text & content',
    description: 'Shows the current status of an item with a colored dot. Can be clickable or removable.',
    icon: CircleDotIcon,
    docsUrl: `${STANDARD_DOCS}/status-tag`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['status', 'state', 'indicator', 'dot', 'badge'],
    children: { mode: 'text', defaultText: 'Active' },
    events: [
      { name: 'onClick', label: 'On click', description: 'Runs when the status tag is clicked.', params: [] },
      { name: 'onRemoveClick', label: 'On remove click', description: 'Runs when the remove (x) icon is clicked.', params: [] },
    ],
    create: () => ({ type: 'StatusTag', props: { variant: 'success' }, text: 'Active' }),
    props: [
      {
        name: 'variant',
        label: 'Variant',
        type: { kind: 'enum', options: STATUS_VARIANT_OPTIONS },
        defaultValue: 'default',
        group: 'Appearance',
        description: 'The color of the dot indicator.',
      },
      {
        name: 'hollow',
        label: 'Hollow',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Appearance',
        description: 'Show the dot as a ring instead of a filled circle.',
      },
      {
        name: 'showRemoveIcon',
        label: 'Show remove icon',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Include a small clickable x icon to remove the tag (handle it with On remove click).',
      },
      TEST_ID_PROP,
    ],
    preview: StatusTagPreview,
  },
  {
    type: 'Tooltip',
    label: 'Tooltip',
    category: 'Text & content',
    description: 'Helpful text shown when hovering a Button, Link, Image or Tag. Attach it as the trigger’s overlay.',
    icon: MessageSquareTextIcon,
    docsUrl: `${STANDARD_DOCS}/tooltip`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['hint', 'hover', 'help', 'popover', 'info'],
    slotOnly: true,
    children: { mode: 'text', defaultText: 'Helpful tip' },
    props: [
      {
        name: 'placement',
        label: 'Placement',
        type: { kind: 'enum', options: enumOptions('top', 'bottom', 'left', 'right') },
        defaultValue: 'top',
        group: 'Layout',
        description: 'Where the tooltip appears relative to the component it is attached to.',
      },
      TEST_ID_PROP,
    ],
    preview: TooltipPreview,
  },
];
