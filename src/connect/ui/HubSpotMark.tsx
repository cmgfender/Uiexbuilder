/** A small sprocket-style glyph used on "Connect HubSpot" controls (decorative). */
export function HubSpotMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false" className={className}>
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="15" cy="14.5" r="4.2" />
        <path d="M15 10.3V5.8" />
        <path d="M11.6 12 6.4 8.2" />
        <path d="M12 17.6 8.6 20.4" />
      </g>
      <circle cx="15" cy="4.2" r="2" fill="currentColor" />
      <circle cx="5.2" cy="7.3" r="1.9" fill="currentColor" />
      <circle cx="7.6" cy="21" r="1.4" fill="currentColor" />
    </svg>
  );
}
