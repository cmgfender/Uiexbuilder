/**
 * Data panel (left sidebar "Data" tab) for the active extension: state variables, computed values,
 * data sources, app functions, helpers and mock data for the preview.
 */
import { useActiveExtension } from '../model/store';
import { ComputedSection, HelpersSection } from '../power';
import { ExtensionIcon } from './icons';
import { DataSourcesSection } from './data/DataSourcesSection';
import { FunctionsSection } from './data/FunctionsSection';
import { MockSection } from './data/MockSection';
import { StateSection } from './data/StateSection';
import './panels.css';

export function DataPanel() {
  const ext = useActiveExtension();
  if (!ext) return null;
  return (
    <div className="ub-pn-data">
      <div className="ub-pn-data__head">
        <ExtensionIcon kind={ext.kind} size={13} />
        <span className="ub-pn-data__title" title={ext.name}>
          {ext.name}
        </span>
        <span className="ub-pn-muted">data & logic</span>
      </div>
      <StateSection ext={ext} />
      <ComputedSection />
      <DataSourcesSection ext={ext} />
      <FunctionsSection />
      <HelpersSection />
      <MockSection ext={ext} />
    </div>
  );
}
