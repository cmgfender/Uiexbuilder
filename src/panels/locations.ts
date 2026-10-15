/** Card locations offered in the extension editors. */
import type { CardLocation } from '../model/types';

export const CARD_LOCATIONS: Array<{ value: CardLocation; label: string; hint: string }> = [
  { value: 'crm.record.tab', label: 'Record tab', hint: 'Middle column of the record page' },
  { value: 'crm.record.sidebar', label: 'Record sidebar', hint: 'Right sidebar of the record page' },
  { value: 'crm.preview', label: 'Preview panel', hint: 'Record preview side panel' },
  { value: 'helpdesk.sidebar', label: 'Help desk sidebar', hint: 'Ticket sidebar in the help desk' },
];
