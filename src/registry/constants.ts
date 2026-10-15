import type { EnumOption } from './types';

/** Docs root for HubSpot UI components (developer platform). */
export const DOCS_BASE =
  'https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/ui-components';
export const STANDARD_DOCS = `${DOCS_BASE}/standard-components`;
export const CRM_DOCS = `${DOCS_BASE}/crm-data-components`;
export const CRM_ACTION_DOCS = `${DOCS_BASE}/crm-action-components`;

/** Every valid IconNames key in @hubspot/ui-extensions 0.17.x (keys of `iconNames`). */
export const ICON_NAMES = ['add','appointment','approvals','artificialIntelligence','artificialIntelligenceEnhanced','attach','bank','block','book','bulb','callTranscript','calling','callingHangup','callingMade','callingMissed','callingVoicemail','campaigns','cap','checkCircle','circleFilled','circleHollow','clock','comment','contact','copy','crm','dataSync','date','delay','delete','description','developerProjects','documents','downCarat','download','edit','ellipses','email','emailOpen','emailThreadedReplies','enrichment','enroll','exclamation','exclamationCircle','faceHappy','faceHappyFilled','faceNeutral','faceNeutralFilled','faceSad','faceSadFilled','facebook','favoriteHollow','file','filledXCircleIcon','filter','flame','folder','folderOpen','forward','gauge','generateChart','gift','globe','globeLine','goal','googlePlus','guidedActions','hash','hide','home','hubDB','image','imageGallery','inbox','info','infoNoCircle','insertVideo','instagram','integrations','invoice','key','language','left','lessCircle','lesson','light','link','linkedin','listView','location','locked','mention','messages','mobile','moreCircle','notEditable','notification','notificationOff','objectAssociations','objectAssociationsManyToMany','objectAssociationsManyToOne','office365','order','paymentSubscriptions','pin','pinterest','powerPointFile','presentation','product','publish','question','questionAnswer','questionCircle','quickbooks','quote','readMore','readOnlyView','realEstateListing','recentlySelected','record','redo','refresh','registration','remove','replace','reports','right','robot','rotate','rss','salesQuote','salesTemplates','save','search','send','sequences','settings','shoppingCart','signal','signalPoor','signature','snooze','sortAlpAsc','sortAlpDesc','sortAmtAsc','sortAmtDesc','sortNumAsc','sortNumDesc','sortTableAsc','sortTableDesc','spellCheck','sprocket','star','stopRecord','strike','styles','success','tablet','tag','tasks','test','text','textBodyExpanded','textColor','textDataType','textSnippet','thumbsDown','thumbsUp','ticket','translate','trophy','twitter','undo','upCarat','upload','video','videoFile','videoPlayerSubtitles','view','viewDetails','warning','website','workflows','x','xCircle','xing','youtube','youtubePlay','zoomIn','zoomOut'] as const;
export type IconName = (typeof ICON_NAMES)[number];

const opts = (...values: Array<string | number | boolean>): EnumOption[] => values.map((value) => ({ value }));

/** AllDistances: 'flush' | AllSizes (both aliases are valid TS; we offer the long names). */
export const DISTANCE_OPTIONS: EnumOption[] = opts('flush', 'extra-small', 'small', 'medium', 'large', 'extra-large');
/** Padding variants exclude 'flush'. */
export const PADDING_OPTIONS: EnumOption[] = opts('extra-small', 'small', 'medium', 'large', 'extra-large');
export const SIZE_XS_MD: EnumOption[] = opts('extra-small', 'small', 'medium');
export const SIZE_ALL: EnumOption[] = opts('extra-small', 'small', 'medium', 'large', 'extra-large');
export const FLEX_JUSTIFY: EnumOption[] = opts('start', 'center', 'end', 'around', 'between');
export const FLEX_ALIGN: EnumOption[] = opts('start', 'center', 'baseline', 'end', 'stretch');
export const ALERT_VARIANTS: EnumOption[] = opts('info', 'warning', 'success', 'error', 'danger', 'tip');
export { opts as enumOptions };

/** Standard CRM object types usable in card objectTypes. */
export const CRM_OBJECT_TYPES: Array<{ value: string; label: string; typeId: string }> = [
  { value: 'contacts', label: 'Contacts', typeId: '0-1' },
  { value: 'companies', label: 'Companies', typeId: '0-2' },
  { value: 'deals', label: 'Deals', typeId: '0-3' },
  { value: 'tickets', label: 'Tickets', typeId: '0-5' },
  { value: 'line_items', label: 'Line items', typeId: '0-8' },
  { value: 'products', label: 'Products', typeId: '0-7' },
  { value: 'quotes', label: 'Quotes', typeId: '0-14' },
  { value: 'calls', label: 'Calls', typeId: '0-48' },
  { value: 'meetings', label: 'Meetings', typeId: '0-47' },
  { value: 'tasks', label: 'Tasks', typeId: '0-27' },
  { value: 'notes', label: 'Notes', typeId: '0-46' },
  { value: 'emails', label: 'Emails', typeId: '0-49' },
  { value: 'invoices', label: 'Invoices', typeId: '0-53' },
  { value: 'orders', label: 'Orders', typeId: '0-123' },
  { value: 'carts', label: 'Carts', typeId: '0-142' },
  { value: 'subscriptions', label: 'Subscriptions', typeId: '0-69' },
  { value: 'leads', label: 'Leads', typeId: '0-136' },
  { value: 'appointments', label: 'Appointments', typeId: '0-421' },
  { value: 'courses', label: 'Courses', typeId: '0-410' },
  { value: 'listings', label: 'Listings', typeId: '0-420' },
  { value: 'services', label: 'Services', typeId: '0-162' },
];
