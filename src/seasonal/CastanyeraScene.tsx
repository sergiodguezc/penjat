import { MAX_ERRORS } from '../../shared/game'

/** The fire measures mistakes; the woman and moon never disappear. */
export function CastanyeraScene({ errors, mood = 'neutral' }: { errors: number; mood?: 'neutral' | 'win' | 'loss' }) {
  const remaining = Math.max(0, Math.min(MAX_ERRORS, MAX_ERRORS - Math.floor(errors)))
  const expression = mood === 'win' ? 'warm' : mood === 'loss' || remaining === 0 ? 'sad' : remaining >= 5 ? 'warm' : remaining >= 3 ? 'concerned' : 'worried'
  return <g className="castanyera-scene" stroke="var(--cast-outline)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <g className="castanyera-sky" stroke="none" fill="var(--cast-cream)">
      <circle cx="192" cy="43" r="35" opacity=".055" /><circle data-moon="atmosphere" cx="192" cy="43" r="23" fill="var(--cast-moon)" />
      <g fill="var(--cast-sky)"><circle cx="185" cy="36" r="4" opacity=".22" /><circle cx="199" cy="48" r="3" opacity=".18" /></g>
      <circle cx="29" cy="37" r="1.5" /><circle cx="123" cy="26" r="1.5" /><circle cx="220" cy="105" r="1.5" />
      <path d="m139 64 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" opacity=".7" /><path d="m29 112 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" opacity=".5" />
    </g>
    <ellipse cx="121" cy="239" rx="105" ry="7" fill="var(--cast-outline)" stroke="none" opacity=".3" />
    <ellipse cx="170" cy="208" rx="58" ry="37" fill="var(--cast-flame)" stroke="none" opacity={remaining * .025} />
    <g data-castanyera="visible">
      {/* Wool skirt, slippers and the broad linen apron make the silhouette readable at phone size. */}
      <path d="m47 185-9 43q33 13 68 0l-12-43Z" fill="var(--cast-skirt)" />
      <path d="M48 229q-13 2-12 9h27v-8m22 0v8h27q1-8-12-9" fill="var(--cast-outline)" />
      <path d="M49 103q-16 13-15 48l10 46h56l8-45q2-29-22-49Z" fill="var(--cast-blouse)" />
      <path d="m45 107 25 22 20-24 8 29-28 14-30-14Z" fill="var(--cast-shawl)" />
      <path d="m57 137-9 77q25 10 53 0l-15-77Z" fill="var(--cast-apron)" />
      <path d="M58 142q12 6 27 0M59 179l23 1-1 18q-11 7-22-1Z" fill="none" opacity=".55" />
      <path d="M42 145q-10 15 2 27l9-5-5-18m45-27q9 15 26 20l5-9-23-20" fill="var(--cast-blouse)" />
      <path d="M44 168q-4 12 4 14q8-2 5-15m65-26q9 7 14-1l-7-8-5 3" fill="var(--cast-skin)" />
      {/* Tied headscarf, grey hair, round spectacles and a kindly face. */}
      <path d="M43 78Q31 37 64 32q34-8 38 34l-8 38-20-10-25 7Z" fill="var(--cast-shawl)" />
      <path d="M61 94v13q10 8 20 0V94" fill="var(--cast-skin)" />
      <ellipse cx="70" cy="73" rx="22" ry="26" fill="var(--cast-skin)" />
      <path d="M47 66q-5-25 21-24q23-4 28 19l-10-3-9-10-9 12-12-2Z" fill="var(--cast-cream)" />
      {/* Keep the scarf knot below the chin: its old outline crossed the mouth/jaw. */}
      <path d="M71 104l14-4 13 9-16 4-11-8-9 8-12-8 17-5Z" fill="var(--cast-shawl)" />
      <g fill="none" strokeWidth="1.8"><circle cx="61" cy="74" r="7" /><circle cx="80" cy="74" r="7" /><path d="M68 73h5m-20 0-6-3m40 3 5-3" /><path d="M70 78l-2 6h3" /></g>
      <g data-expression={expression}>
        <g fill="var(--cast-outline)" stroke="none"><circle cx="61" cy={expression === 'sad' ? 76 : 74} r="1.7" /><circle cx="80" cy={expression === 'sad' ? 76 : 74} r="1.7" /></g>
        {expression === 'sad' && <path d="M56 72q5 4 10 0M75 72q5 4 10 0" fill="none" strokeWidth="1.5" />}
        <path d={expression === 'warm' ? 'M56 64q5-3 10-1m9 0q6-2 10 1' : expression === 'concerned' ? 'M56 65q5-3 10-2M75 63q5-1 10 2' : 'M56 66q5 0 10-3M75 63q5 3 10 3'} fill="none" strokeWidth="1.5" />
        <path d={expression === 'warm' ? 'M63 89Q71 96 78 89' : expression === 'concerned' ? 'M64 91Q71 92 78 91' : expression === 'worried' ? 'M64 92Q71 88 78 92' : 'M63 93Q70 84 78 93'} fill="none" strokeWidth="2" />
      </g>
      <g fill="var(--cast-shawl)" stroke="none" opacity=".3"><ellipse cx="54" cy="85" rx="4" ry="2.5" /><ellipse cx="85" cy="85" rx="4" ry="2.5" /></g>
    </g>
    {/* Six independent tongues of fire, with space between them. No outlined "dead flames" to miscount. */}
    <g className="castanyera-fire">
      {Array.from({ length: remaining }, (_, index) => <g key={index} data-flame={index + 1} transform={`translate(${123 + index * 17} 169)`} stroke="none">
        <path d="M0 32C-9 26-7 17-2 12Q2 8 1 0C12 11 6 16 8 21Q12 28 5 32Z" fill="var(--cast-flame)" />
        <path d="M1 31Q-4 26 2 18Q8 27 4 31Z" fill="var(--cast-moon)" />
      </g>)}
    </g>
    <g data-brazier={remaining ? 'warm' : 'cold'}>
      <path d="m114 203 8 25q46 12 97-1l8-24Z" fill="var(--cast-metal)" />
      <path d="m129 231-4 10m81-10 5 10M133 213h16m13 0h16m13 0h15" fill="none" />
      {!remaining && <g data-embers="cold" stroke="var(--cast-ash)" strokeWidth="4"><path d="m127 199 12 1m10-2 12 1m12-1 13 1m12 0 12-1" /></g>}
    </g>
    {/* The shallow roasting pan and its long handle are separate from the fire. */}
    <path d="m116 158-14-15m16 17q46 18 109-1l-8 13q-45 12-94-1Z" fill="var(--cast-metal)" />
    <ellipse cx="172" cy="157" rx="56" ry="8" fill="var(--cast-outline)" />
    {[131, 148, 165, 182, 199, 215].map((x, index) => <g key={x} transform={`translate(${x} ${155 + index % 2 * 3})`} strokeWidth="1.2">
      <path d="M-6 1q-1-8 6-8q8 2 6 8q-5 7-12 0Z" fill="var(--cast-chestnut)" /><path d="m-2-3 4 5m-5-2 6-2" stroke="var(--cast-apron)" />
    </g>)}
  </g>
}
