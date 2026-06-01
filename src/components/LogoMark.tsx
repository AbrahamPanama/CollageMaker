const STEP_HEART_PATH =
  'M28 7H41V10H48V13H53V17H57V21H59V34H56V38H53V42H49V46H45V50H41V54H36V58H28V54H23V50H19V46H15V42H11V38H8V34H5V21H8V17H12V13H17V10H24V7H28V11H35V7Z';

const TILES: Array<[number, number, number, number]> = [
  [2, 6, 10, 12], [12, 6, 10, 12], [22, 6, 10, 12], [32, 6, 10, 12], [42, 6, 10, 12], [52, 6, 10, 12],
  [2, 18, 10, 12], [12, 18, 10, 12], [22, 18, 10, 12], [32, 18, 10, 12], [42, 18, 10, 12], [52, 18, 10, 12],
  [2, 30, 10, 12], [12, 30, 10, 12], [22, 30, 10, 12], [32, 30, 10, 12], [42, 30, 10, 12], [52, 30, 10, 12],
  [6, 42, 12, 10], [18, 42, 12, 10], [30, 42, 12, 10], [42, 42, 12, 10], [54, 42, 8, 10],
  [18, 52, 12, 9], [30, 52, 12, 9], [42, 52, 12, 9],
];

// Brand mark: mosaic-tile heart in phosphor green on a near-black rounded
// square — a miniature of the app icon, so the header and OS icon match.
export function LogoMark() {
  return (
    <svg className="cm-logo" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="cm-logo-heart">
          <path d={STEP_HEART_PATH} />
        </clipPath>
      </defs>
      <rect x="0" y="0" width="64" height="64" rx="14" fill="#0a0a0b" />
      <g
        clipPath="url(#cm-logo-heart)"
        fill="#34e08a"
        stroke="#0a0a0b"
        strokeWidth="1.5"
        shapeRendering="crispEdges"
      >
        {TILES.map(([x, y, w, h], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} />
        ))}
      </g>
    </svg>
  );
}
