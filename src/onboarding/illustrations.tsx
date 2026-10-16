/**
 * Tiny pictures of a HubSpot page for the "Where should your card appear?" choices: where the card
 * goes is the highlighted (orange) block. Purely decorative (aria-hidden); colours come from the
 * builder's tokens through the ub-ob-ill classes.
 */
import type { CardLocation } from '../model/types';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg className="ub-ob-ill" viewBox="0 0 120 72" width="120" height="72" aria-hidden="true" focusable="false">
      <rect className="ub-ob-ill__frame" x="0.5" y="0.5" width="119" height="71" rx="6" />
      <rect className="ub-ob-ill__bar" x="0.5" y="0.5" width="119" height="9" rx="6" />
      <rect className="ub-ob-ill__bar" x="0.5" y="5" width="119" height="5" />
      {children}
    </svg>
  );
}

const Block = ({ x, y, w, h, hl = false }: { x: number; y: number; w: number; h: number; hl?: boolean }) => (
  <rect className={hl ? 'ub-ob-ill__hl' : 'ub-ob-ill__block'} x={x} y={y} width={w} height={h} rx="2.5" />
);

/** Three-column record page: left summary, middle tabs, right sidebar. */
function RecordPage({ highlight }: { highlight: 'middle' | 'right' }) {
  return (
    <Frame>
      <Block x={6} y={15} w={26} h={51} />
      <rect className="ub-ob-ill__line" x="38" y="15" width="10" height="3" rx="1.5" />
      <rect className="ub-ob-ill__line" x="51" y="15" width="10" height="3" rx="1.5" />
      <rect className="ub-ob-ill__line" x="64" y="15" width="10" height="3" rx="1.5" />
      <Block x={38} y={22} w={44} h={highlight === 'middle' ? 26 : 20} hl={highlight === 'middle'} />
      <Block x={38} y={highlight === 'middle' ? 52 : 46} w={44} h={highlight === 'middle' ? 14 : 20} />
      <Block x={88} y={15} w={26} h={14} />
      <Block x={88} y={33} w={26} h={highlight === 'right' ? 18 : 14} hl={highlight === 'right'} />
      <Block x={88} y={highlight === 'right' ? 55 : 51} w={26} h={highlight === 'right' ? 11 : 15} />
    </Frame>
  );
}

/** A list of records with the preview panel open on the right. */
function PreviewPanel() {
  return (
    <Frame>
      {[15, 24, 33, 42, 51, 60].map((y) => (
        <rect key={y} className="ub-ob-ill__line" x="6" y={y} width="56" height="4" rx="2" />
      ))}
      <rect className="ub-ob-ill__panel" x="70" y="10" width="49.5" height="61.5" />
      <Block x={75} y={15} w={40} h={8} />
      <Block x={75} y={27} w={40} h={22} hl />
      <Block x={75} y={53} w={40} h={13} />
    </Frame>
  );
}

/** Help desk: ticket list, conversation and the ticket sidebar on the right. */
function HelpDesk() {
  return (
    <Frame>
      {[15, 23, 31, 39].map((y) => (
        <rect key={y} className="ub-ob-ill__line" x="6" y={y} width="24" height="4" rx="2" />
      ))}
      <Block x={36} y={15} w={44} h={10} />
      <Block x={44} y={29} w={36} h={10} />
      <Block x={36} y={43} w={40} h={10} />
      <Block x={86} y={15} w={28} h={12} />
      <Block x={86} y={31} w={28} h={20} hl />
      <Block x={86} y={55} w={28} h={11} />
    </Frame>
  );
}

export function LocationIllustration({ location }: { location: CardLocation }) {
  switch (location) {
    case 'crm.record.sidebar':
      return <RecordPage highlight="right" />;
    case 'crm.preview':
      return <PreviewPanel />;
    case 'helpdesk.sidebar':
      return <HelpDesk />;
    default:
      return <RecordPage highlight="middle" />;
  }
}
