// The pictures inside the welcome page's product previews: small flat landscapes and rooms, drawn in SVG in the brand's muted palette. They stand where a
// person's work sample would be, and they are illustrations, not photographs of anyone's work: every preview they sit in says it is illustrative. They are
// decorative (hidden from a screen reader) and scale to the box they are in, cropping rather than stretching.
const svg = (viewBox, children, extra = {}) => function Scene({ className = '' }) {
  return (
    <svg className={`wp-scene${className ? ` ${className}` : ''}`} viewBox={viewBox} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" {...extra}>
      {children}
    </svg>
  );
};

// A wind turbine: a tower, a hub and three blades, at (x, y) the foot of the tower, `s` times its size, the blades turned by `turn` degrees.
function Turbine({ x, y, s = 1, turn = 0 }) {
  const top = y - 78 * s;
  return (
    <g stroke="#f6f4ee" strokeLinecap="round">
      <line x1={x} y1={y} x2={x} y2={top} strokeWidth={2.2 * s} />
      {[0, 120, 240].map((a) => {
        const r = ((a + turn - 90) * Math.PI) / 180;
        return <line key={a} x1={x} y1={top} x2={x + Math.cos(r) * 40 * s} y2={top + Math.sin(r) * 40 * s} strokeWidth={1.8 * s} />;
      })}
      <circle cx={x} cy={top} r={2.4 * s} fill="#f6f4ee" stroke="none" />
    </g>
  );
}

// Rolling hills under a hazy sky with three turbines: "Making energy easier to understand".
export const SceneTurbines = svg('0 0 400 190', (
  <>
    <defs>
      <linearGradient id="wt-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c3cfd3" /><stop offset=".6" stopColor="#e4e3da" /><stop offset="1" stopColor="#efe8d4" /></linearGradient>
    </defs>
    <rect width="400" height="190" fill="url(#wt-sky)" />
    <path d="M0 112 C70 96 130 108 200 100 C270 92 340 104 400 94 V190 H0Z" fill="#9fb2b6" />
    <path d="M0 128 C80 108 150 130 230 118 C300 108 360 124 400 114 V190 H0Z" fill="#82946f" />
    <Turbine x={92} y={132} s={0.78} turn={20} />
    <Turbine x={206} y={126} s={0.58} turn={70} />
    <Turbine x={318} y={124} s={0.98} turn={5} />
    <path d="M0 152 C90 130 170 156 260 140 C330 128 375 142 400 134 V190 H0Z" fill="#5f6f43" />
    <path d="M0 170 C100 156 200 176 300 162 C350 155 385 160 400 158 V190 H0Z" fill="#475431" />
    <path d="M0 150 C60 138 100 150 150 146" fill="none" stroke="#c9b777" strokeWidth="3" opacity=".5" />
  </>
));

// A turquoise bay under green headlands: "Product teardown".
export const SceneCoast = svg('0 0 300 190', (
  <>
    <defs>
      <linearGradient id="wc-sea" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1f7f93" /><stop offset=".55" stopColor="#38b0b4" /><stop offset="1" stopColor="#8fdcc8" /></linearGradient>
      <linearGradient id="wc-cliff" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7c9b52" /><stop offset="1" stopColor="#4c6a3a" /></linearGradient>
    </defs>
    <rect width="300" height="190" fill="url(#wc-sea)" />
    <path d="M0 0 H150 C140 30 150 52 122 74 C98 92 96 120 62 134 C34 146 14 150 0 168Z" fill="url(#wc-cliff)" />
    <path d="M0 168 C14 150 34 146 62 134 C70 130 74 126 80 122 L96 130 C74 150 40 164 0 190Z" fill="#c8a56a" opacity=".85" />
    <path d="M150 0 H300 V54 C268 50 246 66 226 86 C206 106 176 98 158 78 C146 62 150 30 150 0Z" fill="url(#wc-cliff)" opacity=".92" />
    <path d="M120 78 C140 98 168 112 196 104 C224 96 246 88 262 76" fill="none" stroke="#ffffff" strokeWidth="3" opacity=".75" strokeLinecap="round" />
    <path d="M70 140 C100 150 140 150 176 138" fill="none" stroke="#ffffff" strokeWidth="2" opacity=".5" strokeLinecap="round" />
    <path d="M180 150 C214 156 252 152 290 140" fill="none" stroke="#ffffff" strokeWidth="2" opacity=".45" strokeLinecap="round" />
    <circle cx="214" cy="38" r="3" fill="#e4f3d4" opacity=".6" />
  </>
));

// A glasshouse hall with palms and a long window: "Climate research".
export const SceneGlasshouse = svg('0 0 300 190', (
  <>
    <defs>
      <linearGradient id="wg-wall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#e6ede8" /><stop offset="1" stopColor="#f4f1e8" /></linearGradient>
      <linearGradient id="wg-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bfe0d8" /><stop offset="1" stopColor="#e9f3e8" /></linearGradient>
    </defs>
    <rect width="300" height="190" fill="url(#wg-wall)" />
    <rect x="22" y="14" width="150" height="118" fill="url(#wg-glass)" />
    <path d="M22 14 H172 M22 53 H172 M22 92 H172 M72 14 V132 M122 14 V132" stroke="#f7f9f4" strokeWidth="3" fill="none" />
    <rect x="172" y="8" width="108" height="132" fill="#d9d1bd" />
    <path d="M172 8 L280 8 L280 24 L172 40Z" fill="#cdbf9f" />
    <path d="M186 60 H268 M186 92 H268 M186 124 H268" stroke="#bfb190" strokeWidth="2" />
    <path d="M0 152 H300 V190 H0Z" fill="#c7b48f" />
    <path d="M0 152 H300" stroke="#a89670" strokeWidth="2" />
    <g fill="#2f6a3e">
      <path d="M58 150 C40 110 24 100 8 96 C28 94 46 104 60 128 C64 106 72 92 88 84 C76 100 70 118 68 150Z" />
      <path d="M64 150 C74 120 96 106 118 104 C98 112 82 126 76 150Z" />
      <path d="M232 150 C220 126 232 100 258 88 C246 106 244 128 246 150Z" />
    </g>
    <g fill="#4d8f55">
      <path d="M130 152 C122 134 132 118 150 112 C142 126 142 140 146 152Z" />
      <path d="M154 152 C150 138 160 126 176 124 C168 134 168 144 170 152Z" />
    </g>
    <circle cx="96" cy="64" r="16" fill="#fff6d6" opacity=".55" />
  </>
));

// A small island with a tree in a turquoise sea: "Climate builders".
export const SceneIsland = svg('0 0 120 120', (
  <>
    <defs><linearGradient id="wi-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7ec9c2" /><stop offset="1" stopColor="#2d8a96" /></linearGradient></defs>
    <rect width="120" height="120" fill="url(#wi-sea)" />
    <circle cx="86" cy="24" r="10" fill="#fdeec3" opacity=".9" />
    <path d="M10 92 C26 76 56 70 84 80 C98 86 108 94 120 98 V120 H0 V100Z" fill="#c9a766" />
    <path d="M24 90 C40 80 62 78 82 84 C70 94 44 98 24 90Z" fill="#6f9a52" />
    <path d="M60 82 C58 62 62 48 66 36" stroke="#6b4a2e" strokeWidth="3" fill="none" strokeLinecap="round" />
    <g fill="#2f7a46"><path d="M66 36 C54 30 44 34 38 44 C50 40 58 40 66 36Z" /><path d="M66 36 C78 28 90 32 96 42 C84 38 74 38 66 36Z" /><path d="M66 36 C62 24 64 16 70 10 C72 20 72 28 66 36Z" /></g>
  </>
));

// A greenhouse room with a desk: "First startup roles".
export const SceneStudio = svg('0 0 120 120', (
  <>
    <rect width="120" height="120" fill="#cfe0d2" />
    <path d="M0 0 H120 V70 H0Z" fill="#e8efe4" />
    <path d="M12 12 H108 M12 34 H108 M12 56 H108 M44 12 V70 M76 12 V70" stroke="#f8faf5" strokeWidth="3" />
    <rect x="0" y="70" width="120" height="50" fill="#a8895b" />
    <rect x="22" y="72" width="76" height="8" rx="2" fill="#7a603c" />
    <rect x="44" y="52" width="32" height="20" rx="2" fill="#2d3a38" />
    <rect x="47" y="55" width="26" height="14" fill="#9fd0c4" />
    <g fill="#2f7a46"><path d="M16 70 C6 54 10 40 22 32 C22 46 24 58 24 70Z" /><path d="M100 70 C112 56 110 42 98 36 C98 48 96 60 96 70Z" /></g>
  </>
));

// A person against a bright window, from behind: "People to watch".
export const SceneSilhouette = svg('0 0 120 120', (
  <>
    <defs><linearGradient id="wsl-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f3e3b8" /><stop offset="1" stopColor="#b98f58" /></linearGradient></defs>
    <rect width="120" height="120" fill="url(#wsl-bg)" />
    <circle cx="60" cy="52" r="28" fill="#fff4cf" opacity=".6" />
    <path d="M30 120 C30 92 44 80 60 80 C76 80 90 92 90 120Z" fill="#2c2a2a" />
    <circle cx="60" cy="64" r="12" fill="#2c2a2a" />
    <path d="M40 74 L28 96 M80 74 L92 96" stroke="#2c2a2a" strokeWidth="6" strokeLinecap="round" />
  </>
));

// A glass-and-stone building against the sky: "Riley Watson"'s saved work.
export const SceneBuilding = svg('0 0 120 90', (
  <>
    <defs><linearGradient id="wb-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a9c4d6" /><stop offset="1" stopColor="#e1e9ec" /></linearGradient></defs>
    <rect width="120" height="90" fill="url(#wb-sky)" />
    <path d="M14 90 V46 L52 24 L98 38 V90Z" fill="#6f7f8f" />
    <path d="M52 24 L98 38 V90 H52Z" fill="#8a9bab" />
    <path d="M20 54 H46 M20 64 H46 M20 74 H46 M58 44 H92 M58 54 H92 M58 64 H92 M58 74 H92" stroke="#dbe6ec" strokeWidth="3" opacity=".8" />
    <rect x="0" y="82" width="120" height="8" fill="#52624f" />
  </>
));

// A peak above a turquoise water: "Noah Tan"'s saved work.
export const SceneMountain = svg('0 0 120 90', (
  <>
    <defs><linearGradient id="wm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bcd7e6" /><stop offset="1" stopColor="#eef3ee" /></linearGradient></defs>
    <rect width="120" height="90" fill="url(#wm-sky)" />
    <path d="M0 70 L38 28 L58 44 L82 18 L120 66 V90 H0Z" fill="#6c7b5a" />
    <path d="M82 18 L120 66 L96 62 L84 44Z" fill="#4e5c40" />
    <path d="M38 28 L48 38 L40 40Z M82 18 L88 28 L80 28Z" fill="#f4f6f2" />
    <rect x="0" y="70" width="120" height="20" fill="#3aa3a8" />
    <path d="M0 78 C30 74 60 82 120 76" stroke="#bfeee6" strokeWidth="2" fill="none" opacity=".7" />
  </>
));

// The mark of the company in the hiring preview: a gold sprout on a green tile.
export function SproutMark({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="6" fill="#1d4a34" />
      <path d="M24 38 V22" stroke="#f1cf6a" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 26 C14 26 12 18 13 13 C21 13 25 17 24 26Z" fill="#f1cf6a" />
      <path d="M24 22 C33 22 36 15 35 10 C27 10 22 14 24 22Z" fill="#e7b94e" />
    </svg>
  );
}
