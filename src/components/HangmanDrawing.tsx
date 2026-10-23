import { useEffect, useRef, type ReactNode } from 'react'
import { CastanyeraScene } from '../seasonal/CastanyeraScene'

type Props = {
  errors: number
  /** Localised error label for standalone informative drawings. Omit beside an existing announcement. */
  label?: string
  mood?: 'neutral' | 'win' | 'loss'
  size?: 'large' | 'compact'
  /** Decorative previews/verdicts can retain their ordinary pose while showing the actual seasonal fire. */
  seasonalErrors?: number
}

// Adapted from Lovable's barretina illustration. Gallows never consume an error.
const PART_ERROR = { head: 1, torso: 2, leftArm: 3, rightArm: 4, leftLeg: 5, rightLeg: 6 } as const

export function HangmanDrawing({ errors, label, mood = 'neutral', size = 'large', seasonalErrors = errors }: Props) {
  const previousErrors = useRef(errors)
  useEffect(() => { previousErrors.current = errors }, [errors])
  const rescued = mood === 'win'
  const part = (name: keyof typeof PART_ERROR, shape: ReactNode) => {
    const threshold = PART_ERROR[name]
    return (rescued || errors >= threshold) && <g data-part={name} className={`hangman-part${!rescued && threshold > previousErrors.current && threshold <= errors ? ' hangman-part--entering' : ''}`}>{shape}</g>
  }

  return <svg className={`hangman hangman--${size}`} width={size === 'compact' ? 44 : 240} height={size === 'compact' ? 48 : 260} viewBox="0 0 240 260"
    role={label ? 'img' : undefined} aria-label={label ? `${label}: ${errors} / 6` : undefined} aria-hidden={label ? undefined : true} focusable="false">
    <g className="ordinary-drawing">
    <circle cx="206" cy="110" r="22" fill="var(--safra)" opacity={mood === 'loss' ? .4 : .9} />
    <path d="M14 238 Q120 228 226 238" stroke="var(--ink)" strokeWidth="3" fill="none" strokeLinecap="round" />
    {!rescued && <g className="gallows" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" fill="none">
      <path d="M50 236 L50 30 M44 30 L156 30 M50 66 L86 30" />
      <path d="M150 30 L150 58" stroke="var(--magrana)" strokeWidth="3" />
    </g>}
    <g className="figure" transform={rescued ? 'translate(-30 34)' : undefined} stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" fill="none">
      {part('head', <>
        <circle cx="150" cy="80" r="20" fill="var(--surface)" />
        <path data-accessory="hat" d="M131 72 Q138 46 168 54 Q176 60 170 70 Z" fill="var(--magrana)" strokeWidth="3" />
        <g fill="var(--ink)" stroke="none"><circle cx="144" cy="83" r="2.4" /><circle cx="157" cy="83" r="2.4" /></g>
        <path d={rescued ? 'M143 91 Q150 99 158 91' : mood === 'loss' ? 'M143 95 Q150 90 158 95' : 'M144 93 L157 93'} strokeWidth="2.5" />
      </>)}
      {part('torso', <><path d="M150 100 L150 160" /><path data-accessory="scarf" d="M138 108 Q150 114 162 108" stroke="var(--safra)" strokeWidth="6" /></>)}
      {part('leftArm', <path d={rescued ? 'M150 116 L124 96' : 'M150 116 L124 140'} />)}
      {part('rightArm', <path d={rescued ? 'M150 116 L176 96' : 'M150 116 L176 140'} />)}
      {part('leftLeg', <path d="M150 160 L130 198" />)}
      {part('rightLeg', <path d="M150 160 L170 198" />)}
    </g>
    {rescued && <path d="M62 100 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="var(--mar)" />}
    </g>
    <g className="spooky-only"><CastanyeraScene errors={seasonalErrors} mood={mood} /></g>
  </svg>
}
