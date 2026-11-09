import { Array, Option } from 'effect'
import { click, expect, given, role, scene, text } from 'foldkit/scene'
import { describe, test, expect as vitestExpect } from 'vitest'

import styles from '../../styles.css?raw'
import { appTokens, contrast, init, readTokens, update, view } from './tokens'

describe('the tokens entry', () => {
  test('shows every colour token defined in styles.css', () => {
    const defined = Array.map(
      [...styles.matchAll(/^\s*(--color-[\w-]+):\s*#/gm)],
      match => match[1] ?? '',
    )
    vitestExpect(defined.length).toBeGreaterThan(0)
    vitestExpect(
      Array.map(appTokens.colours, token => token.name),
    ).toStrictEqual(defined)

    scene(
      { update, view },
      given(init().model),
      ...Array.map(defined, name =>
        expect(
          role('button', { name: new RegExp(name.replace('--color-', '')) }),
        ).toExist(),
      ),
    )
  })

  test('picking a colour reads its contrast out', () => {
    scene(
      { update, view },
      given(init().model),
      expect(text(/Pick a colour to read its contrast/)).toExist(),
      click(role('button', { name: /^ink/ })),
      expect(role('button', { name: /^ink/ })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      expect(text(/--color-ink #16181d: \d+(\.\d)?:1 on surface/)).toExist(),
    )
  })

  test('ends with choices for Daniel', () => {
    scene(
      { update, view },
      given(init().model),
      expect(role('heading', { name: 'Choices for you', level: 2 })).toExist(),
    )
  })
})

describe('readTokens', () => {
  test('reads each family from the @theme block and skips cleared ones', () => {
    const tokens = readTokens(`
@theme {
  --color-*: initial;
  --color-ink: #000000; /* a note */
  --spacing: 0.25rem;
  --radius-md: 0.5rem;
  --text-base: 1rem;
  --text-base--line-height: 1.5rem;
  --font-serif: initial;
  --font-sans: 'A',
    B;
}
`)
    vitestExpect(tokens).toStrictEqual({
      colours: [{ name: '--color-ink', value: '#000000' }],
      spacing: '0.25rem',
      radii: [{ name: '--radius-md', value: '0.5rem' }],
      typeSteps: [{ name: '--text-base', size: '1rem', lineHeight: '1.5rem' }],
      fonts: [{ name: '--font-sans', value: "'A', B" }],
    })
  })

  test('puts the Japanese faces first in the sans stack', () => {
    const sans = Array.findFirst(
      appTokens.fonts,
      font => font.name === '--font-sans',
    )
    vitestExpect(
      Option.map(sans, font => font.value.split(',')[0]),
    ).toStrictEqual(Option.some("'Hiragino Sans'"))
  })
})

describe('contrast', () => {
  test('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    vitestExpect(contrast('#000000', '#ffffff')).toStrictEqual(Option.some(21))
    vitestExpect(contrast('#3346c4', '#3346c4')).toStrictEqual(Option.some(1))
    vitestExpect(contrast('red', '#ffffff')).toStrictEqual(Option.none())
  })
})
