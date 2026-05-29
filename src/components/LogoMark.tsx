export function LogoMark() {
  return (
    <svg
      className="cm-logo"
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="cm-logo-heart-clip">
          <path d="M32 55C32 55 8 39.6 8 22.8C8 13.7 14.4 7.3 22.3 7.3C27.4 7.3 30.5 10.2 32 13.4C33.5 10.2 36.6 7.3 41.7 7.3C49.6 7.3 56 13.7 56 22.8C56 39.6 32 55 32 55Z" />
        </clipPath>
      </defs>
      <rect className="cm-logo-shell" x="3.5" y="3.5" width="57" height="57" rx="12" />
      <g clipPath="url(#cm-logo-heart-clip)">
        <rect x="5" y="5" width="14" height="15" className="cm-logo-tile cm-logo-tile-a" />
        <rect x="19" y="5" width="14" height="15" className="cm-logo-tile cm-logo-tile-b" />
        <rect x="33" y="5" width="14" height="15" className="cm-logo-tile cm-logo-tile-c" />
        <rect x="47" y="5" width="12" height="15" className="cm-logo-tile cm-logo-tile-d" />
        <rect x="5" y="20" width="11" height="12" className="cm-logo-tile cm-logo-tile-e" />
        <rect x="16" y="20" width="17" height="12" className="cm-logo-tile cm-logo-tile-f" />
        <rect x="33" y="20" width="14" height="12" className="cm-logo-tile cm-logo-tile-a" />
        <rect x="47" y="20" width="12" height="12" className="cm-logo-tile cm-logo-tile-b" />
        <rect x="5" y="32" width="14" height="11" className="cm-logo-tile cm-logo-tile-c" />
        <rect x="19" y="32" width="14" height="11" className="cm-logo-tile cm-logo-tile-d" />
        <rect x="33" y="32" width="17" height="11" className="cm-logo-tile cm-logo-tile-e" />
        <rect x="50" y="32" width="9" height="11" className="cm-logo-tile cm-logo-tile-f" />
        <rect x="12" y="43" width="12" height="10" className="cm-logo-tile cm-logo-tile-b" />
        <rect x="24" y="43" width="16" height="10" className="cm-logo-tile cm-logo-tile-a" />
        <rect x="40" y="43" width="12" height="10" className="cm-logo-tile cm-logo-tile-c" />
        <rect x="23" y="53" width="18" height="8" className="cm-logo-tile cm-logo-tile-d" />
      </g>
      <path
        className="cm-logo-heart-outline"
        d="M32 55C32 55 8 39.6 8 22.8C8 13.7 14.4 7.3 22.3 7.3C27.4 7.3 30.5 10.2 32 13.4C33.5 10.2 36.6 7.3 41.7 7.3C49.6 7.3 56 13.7 56 22.8C56 39.6 32 55 32 55Z"
      />
    </svg>
  );
}
