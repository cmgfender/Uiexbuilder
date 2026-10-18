/** The builder's address, its setup checklist and the hosting guide (for explanations and notes). */
import { HOSTING_DOCS_URL, setupPageUrl } from '../connect/ui/links';

export function statusContext(): { builderUrl: string; setupUrl: string; docsUrl: string } {
  const builderUrl = typeof window !== 'undefined' ? window.location.origin : '';
  let setupUrl = setupPageUrl();
  try {
    setupUrl = new URL(setupUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost/').toString();
  } catch {
    /* keep it relative */
  }
  return { builderUrl, setupUrl, docsUrl: HOSTING_DOCS_URL };
}
