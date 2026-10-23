/** Small seasonal marks stay decorative and carry no game state. */
export function ChestnutEmblem() {
  return <g className="spooky-only chestnut-emblem" stroke="var(--season-chestnut)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 38Q5 23 32 8q27 15 22 30q-3 20-22 19Q13 58 10 38Z" fill="var(--season-pumpkin)" />
    <path d="M11 40q20 10 42 0q-5 18-21 17Q16 57 11 40Z" fill="var(--season-gold)" />
    <path d="m24 23 16 14m-16 0 16-14" fill="none" />
  </g>
}

export function AutumnLeaf() {
  return <svg className="spooky-only autumn-leaf" viewBox="0 0 80 96" aria-hidden="true" focusable="false">
    <g fill="var(--season-gold)" stroke="var(--season-chestnut)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
      <path d="M39 80 Q7 67 15 51 L6 39 L24 40 L20 20 L35 27 L43 6 L51 27 L65 19 L61 40 L76 39 L66 53 Q70 72 39 80Z" />
      <path d="M40 88 L43 25 M42 49 L26 37 M41 62 L58 49 M40 74 L27 62" fill="none" />
    </g>
  </svg>
}
