import { Array, Number, Option, Schema, String, pipe } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import styles from '../../styles.css?raw'
import { type DevEntry, buttonFocusClass, entryFrame } from '../entry'

// The app's tokens, read from the one place they are defined: the
// `@theme` block of `src/app/styles.css`.

// TOKENS

export type Token = Readonly<{ name: string; value: string }>

export type TypeStep = Readonly<{
  name: string
  size: string
  lineHeight: string
}>

export type Tokens = Readonly<{
  colours: ReadonlyArray<Token>
  spacing: string
  radii: ReadonlyArray<Token>
  typeSteps: ReadonlyArray<TypeStep>
  fonts: ReadonlyArray<Token>
}>

const themeBlock = (css: string): string =>
  pipe(
    /@theme\s*\{([\s\S]*?)\n\}/.exec(css),
    Option.fromNullishOr,
    Option.flatMap(match => Option.fromNullishOr(match[1])),
    Option.getOrElse(() => ''),
  )

const themeDeclarations = (css: string): ReadonlyArray<Token> =>
  pipe(
    themeBlock(css).replace(/\/\*[\s\S]*?\*\//g, ''),
    String.split(';'),
    Array.map(declaration =>
      pipe(
        /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(declaration),
        Option.fromNullishOr,
        Option.flatMap(([, name, value]) =>
          name === undefined || value === undefined || value === 'initial'
            ? Option.none()
            : Option.some({ name, value: value.replace(/\s+/g, ' ') }),
        ),
      ),
    ),
    Array.getSomes,
  )

const inFamily =
  (prefix: string) =>
  (token: Token): boolean =>
    String.startsWith(prefix)(token.name) &&
    !token.name.includes('--line-height')

export const readTokens = (css: string): Tokens => {
  const declarations = themeDeclarations(css)
  const valueOf = (name: string): string =>
    pipe(
      Array.findFirst(declarations, token => token.name === name),
      Option.map(token => token.value),
      Option.getOrElse(() => ''),
    )
  return {
    colours: Array.filter(declarations, inFamily('--color-')),
    spacing: valueOf('--spacing'),
    radii: Array.filter(declarations, inFamily('--radius-')),
    typeSteps: Array.map(
      Array.filter(declarations, inFamily('--text-')),
      ({ name, value }) => ({
        name,
        size: value,
        lineHeight: valueOf(`${name}--line-height`),
      }),
    ),
    fonts: Array.filter(declarations, inFamily('--font-')),
  }
}

export const appTokens = readTokens(styles)

// CONTRAST, as WCAG 2 defines it

const channel = (hex: string): number => {
  const value = parseInt(hex, 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

const luminance = (colour: string): Option.Option<number> =>
  pipe(
    /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour),
    Option.fromNullishOr,
    Option.map(
      ([, red = '0', green = '0', blue = '0']) =>
        0.2126 * channel(red) +
        0.7152 * channel(green) +
        0.0722 * channel(blue),
    ),
  )

export const contrast = (a: string, b: string): Option.Option<number> =>
  Option.zipWith(luminance(a), luminance(b), (first, second) =>
    Number.round(
      (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
      1,
    ),
  )

const colourValue = (name: string): string =>
  pipe(
    Array.findFirst(appTokens.colours, token => token.name === name),
    Option.map(token => token.value),
    Option.getOrElse(() => ''),
  )

// MODEL

export const Model = Schema.Struct({
  maybeSelectedColour: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedColour: { name: Schema.String },
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { maybeSelectedColour: Option.none() },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedColour: ({ name }) => ({
      model: modifyFields(model, {
        maybeSelectedColour: () => Option.some(name),
      }),
    }),
  })

// VIEW

const surfaceColour = '--color-surface'
const raisedColour = '--color-raised'

const ratioText = (name: string, against: string): string =>
  Option.match(contrast(colourValue(name), colourValue(against)), {
    onSome: ratio => `${ratio}:1`,
    onNone: () => 'not a plain colour',
  })

export const readOut = (model: Model): string =>
  Option.match(model.maybeSelectedColour, {
    onNone: () =>
      `${appTokens.colours.length} colours, ${appTokens.radii.length} radii, ${appTokens.typeSteps.length} type steps, spacing step ${appTokens.spacing}. Pick a colour to read its contrast.`,
    onSome: name =>
      `${name} ${colourValue(name)}: ${ratioText(name, surfaceColour)} on surface, ${ratioText(name, raisedColour)} on raised.`,
  })

const sectionHeading = (title: string, h: HtmlBuilder<Message>): Html =>
  h.h2([h.Class('text-xl font-bold')], [title])

const coloursView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex flex-col gap-3')],
    [
      sectionHeading('Colour', h),
      h.ul(
        [h.Class('grid grid-cols-2 gap-3 sm:grid-cols-3')],
        Array.map(appTokens.colours, ({ name, value }) =>
          h.keyed('li')(
            name,
            [],
            [
              h.button(
                [
                  h.Type('button'),
                  h.AriaPressed(
                    Option.contains(model.maybeSelectedColour, name)
                      ? 'true'
                      : 'false',
                  ),
                  h.OnClick(Message.SelectedColour({ name })),
                  h.Class(
                    `flex w-full items-center gap-3 rounded-md border border-line bg-surface p-2 text-left aria-pressed:border-accent aria-pressed:bg-raised aria-pressed:ring-1 aria-pressed:ring-accent ${buttonFocusClass}`,
                  ),
                ],
                [
                  h.span([
                    h.Class('size-10 shrink-0 rounded-sm border border-line'),
                    h.Style({ backgroundColor: value }),
                  ]),
                  h.span(
                    [h.Class('flex min-w-0 flex-col')],
                    [
                      h.span(
                        [h.Class('truncate font-mono text-sm')],
                        [String.replace('--color-', '')(name)],
                      ),
                      h.span(
                        [h.Class('font-mono text-xs text-muted')],
                        [value],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    ],
  )

const spacingSteps = [1, 2, 3, 4, 6, 8, 12, 16]

const spacingView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex flex-col gap-3')],
    [
      sectionHeading('Spacing', h),
      h.p(
        [h.Class('text-sm text-muted')],
        [
          `One step is ${appTokens.spacing}; p-4 is four steps. These bars are the steps the app uses most.`,
        ],
      ),
      h.ul(
        [h.Class('flex flex-col gap-2')],
        Array.map(spacingSteps, step =>
          h.keyed('li')(
            `${step}`,
            [h.Class('flex items-center gap-3')],
            [
              h.span(
                [h.Class('w-8 font-mono text-sm text-muted')],
                [`${step}`],
              ),
              h.span([
                h.Class('h-3 rounded-sm bg-accent'),
                h.Style({ width: `calc(var(--spacing) * ${step})` }),
              ]),
            ],
          ),
        ),
      ),
    ],
  )

const radiiView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex flex-col gap-3')],
    [
      sectionHeading('Radius', h),
      h.ul(
        [h.Class('flex flex-wrap gap-4')],
        Array.map(appTokens.radii, ({ name, value }) =>
          h.keyed('li')(
            name,
            [h.Class('flex flex-col items-center gap-2')],
            [
              h.span([
                h.Class('size-16 border-2 border-accent bg-raised'),
                h.Style({ borderRadius: value }),
              ]),
              h.span(
                [h.Class('font-mono text-xs text-muted')],
                [String.replace('--radius-', '')(name)],
              ),
            ],
          ),
        ),
      ),
    ],
  )

const sample = '高低アクセント pitch accent'

const typeView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex flex-col gap-3')],
    [
      sectionHeading('Type scale', h),
      h.ul(
        [h.Class('flex flex-col gap-3')],
        Array.map(appTokens.typeSteps, ({ name, size, lineHeight }) =>
          h.keyed('li')(
            name,
            [h.Class('flex flex-col gap-1')],
            [
              h.span(
                [h.Class('font-mono text-xs text-muted')],
                [
                  `${String.replace('--text-', '')(name)}: ${size} on ${lineHeight}`,
                ],
              ),
              h.span(
                [
                  h.Class('break-words'),
                  h.Style({ fontSize: size, lineHeight }),
                ],
                [sample],
              ),
            ],
          ),
        ),
      ),
    ],
  )

const fontsView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('flex flex-col gap-3')],
    [
      sectionHeading('Fonts', h),
      h.ul(
        [h.Class('flex flex-col gap-4')],
        Array.map(appTokens.fonts, ({ name, value }) =>
          h.keyed('li')(
            name,
            [h.Class('flex flex-col gap-1')],
            [
              h.span(
                [h.Class('font-mono text-xs text-muted')],
                [`${name}: ${value}`],
              ),
              h.span(
                [h.Class('text-xl'), h.Style({ fontFamily: value })],
                ['雨が降っています。 It is raining.'],
              ),
            ],
          ),
        ),
      ),
    ],
  )

export const choices: ReadonlyArray<string> = [
  'Accent is a deep indigo, and the two curves are blue (the native speaker) and orange (you), a pair that stays apart for most colour blindness. Would you rather other colours for the curves?',
  'There is no dark theme yet. Should the app follow the device into dark mode, and from which ticket?',
  "Body text is 16 px on 24 px lines, and Japanese lines may want to be larger than Latin text. Should a line's Japanese text get its own, larger step?",
  "Every font is the device's own, with Hiragino Sans, Noto Sans JP and Yu Gothic first. Is any of them a face you dislike for Japanese?",
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Tokens',
      summary:
        "The app's colours, spacing, radii, type scale and fonts, read from the one place they are defined.",
      demo: [
        coloursView(model, h),
        spacingView(h),
        radiiView(h),
        typeView(h),
        fontsView(h),
      ],
      readOut: readOut(model),
      choices,
    },
    h,
  )

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
