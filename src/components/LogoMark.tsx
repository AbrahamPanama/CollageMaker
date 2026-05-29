const STEP_HEART_PATH =
  'M28 7H41V10H48V13H53V17H57V21H59V34H56V38H53V42H49V46H45V50H41V54H36V58H28V54H23V50H19V46H15V42H11V38H8V34H5V21H8V17H12V13H17V10H24V7H28V11H35V7Z';

export function LogoMark() {
  return (
    <svg
      className="cm-logo"
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="cm-logo-step-heart">
          <path d={STEP_HEART_PATH} />
        </clipPath>
      </defs>
      <rect className="cm-logo-shell" x="1.5" y="1.5" width="61" height="61" rx="13" />
      <g clipPath="url(#cm-logo-step-heart)">
        <rect x="2" y="6" width="10" height="12" className="cm-logo-tile cm-logo-tile-a" />
        <rect x="12" y="6" width="10" height="12" className="cm-logo-tile cm-logo-tile-b" />
        <rect x="22" y="6" width="10" height="12" className="cm-logo-tile cm-logo-tile-c" />
        <rect x="32" y="6" width="10" height="12" className="cm-logo-tile cm-logo-tile-f" />
        <rect x="42" y="6" width="10" height="12" className="cm-logo-tile cm-logo-tile-h" />
        <rect x="52" y="6" width="10" height="12" className="cm-logo-tile cm-logo-tile-a" />

        <rect x="2" y="18" width="10" height="12" className="cm-logo-tile cm-logo-tile-c" />
        <rect x="12" y="18" width="10" height="12" className="cm-logo-tile cm-logo-tile-d" />
        <rect x="22" y="18" width="10" height="12" className="cm-logo-tile cm-logo-tile-e" />
        <rect x="32" y="18" width="10" height="12" className="cm-logo-tile cm-logo-tile-f" />
        <rect x="42" y="18" width="10" height="12" className="cm-logo-tile cm-logo-tile-g" />
        <rect x="52" y="18" width="10" height="12" className="cm-logo-tile cm-logo-tile-h" />

        <rect x="2" y="30" width="10" height="12" className="cm-logo-tile cm-logo-tile-h" />
        <rect x="12" y="30" width="10" height="12" className="cm-logo-tile cm-logo-tile-a" />
        <rect x="22" y="30" width="10" height="12" className="cm-logo-tile cm-logo-tile-b" />
        <rect x="32" y="30" width="10" height="12" className="cm-logo-tile cm-logo-tile-c" />
        <rect x="42" y="30" width="10" height="12" className="cm-logo-tile cm-logo-tile-d" />
        <rect x="52" y="30" width="10" height="12" className="cm-logo-tile cm-logo-tile-e" />

        <rect x="6" y="42" width="12" height="10" className="cm-logo-tile cm-logo-tile-b" />
        <rect x="18" y="42" width="12" height="10" className="cm-logo-tile cm-logo-tile-e" />
        <rect x="30" y="42" width="12" height="10" className="cm-logo-tile cm-logo-tile-g" />
        <rect x="42" y="42" width="12" height="10" className="cm-logo-tile cm-logo-tile-h" />
        <rect x="54" y="42" width="8" height="10" className="cm-logo-tile cm-logo-tile-a" />

        <rect x="18" y="52" width="12" height="9" className="cm-logo-tile cm-logo-tile-c" />
        <rect x="30" y="52" width="12" height="9" className="cm-logo-tile cm-logo-tile-d" />
        <rect x="42" y="52" width="12" height="9" className="cm-logo-tile cm-logo-tile-e" />
      </g>
      <path className="cm-logo-heart-outline" d={STEP_HEART_PATH} />
    </svg>
  );
}
