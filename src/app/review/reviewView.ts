import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { moraeOf } from '../../engine/text/morae'
import type { ReviewDraft } from '../../services/review-store'
import type {
  ReviewExportVerdict,
  ReviewVerdict,
  StarterPack,
  StarterPackLine,
} from '../../services/starter-records'
import { countText } from '../history/format'
import { pageFrame } from '../pageFrame'
import {
  ReviewExported,
  ReviewPage,
  type ReviewReady,
  ReviewSave,
  patternOf,
  verdictOf,
} from './review'

// /review: every starter line with its text, kana, morae and stated
// accent, a button to hear it, and the reviewer's verdict on it (accept,
// reject, or another accent, with a note), kept on the device as it is
// given, then saved as one file for scripts/starter-pack.ts --apply. The
// page is reached only by its address; nothing in the app links to it.

export type ReviewEvents<ViewMessage> = Readonly<{
  changeReviewer: (name: string) => ViewMessage
  chooseVerdict: (lineId: string, verdict: ReviewVerdict) => ViewMessage
  chooseAccent: (lineId: string, accentType: string) => ViewMessage
  changeNote: (lineId: string, note: string) => ViewMessage
  clearVerdict: (lineId: string) => ViewMessage
  play: (lineId: string) => ViewMessage
  stop: ViewMessage
  export: ViewMessage
}>

// The choices, as the reviewer reads them. The export's word for the
// third is the list's own (src/services/starter-records.ts); the page
// says what it does.
const verdictChoices: ReadonlyArray<readonly [ReviewVerdict, string]> = [
  ['accept', 'Accept: the word and its Tokyo accent are right'],
  ['reject', 'Reject: leave this line out'],
  ['correct', 'The accent is another: choose it below'],
]

const accentText = (accentType: number, morae: number): string =>
  `${accentType}, ${patternOf(accentType, morae)}`

const statedAccent = <ViewMessage>(
  line: StarterPackLine,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.ul(
    [h.Class('flex flex-col gap-0.5 text-base text-ink')],
    line.words.map(word =>
      h.li(
        [],
        [
          'Stated: ',
          h.span([h.Lang('ja')], [word.text]),
          ` accent type ${accentText(word.accentType, moraeOf(word.kana).length)}`,
          ...(word.particle === null
            ? []
            : [', then ', h.span([h.Lang('ja')], [word.particle])]),
        ],
      ),
    ),
  )

const playButton = <ViewMessage>(
  line: StarterPackLine,
  playing: boolean,
  events: ReviewEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.OnClick(playing ? events.stop : events.play(line.id)),
      h.AriaLabel(playing ? `Stop ${line.text}` : `Play ${line.text}`),
      h.Class(
        `button ${playing ? 'button-primary' : 'button-secondary'} shrink-0`,
      ),
    ],
    [playing ? 'Stop' : 'Play'],
  )

const verdictFields = <ViewMessage>(
  line: StarterPackLine,
  maybeVerdict: Option.Option<ReviewExportVerdict>,
  events: ReviewEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const [first] = line.words
  const firstMorae = moraeOf(first?.kana ?? line.kana).length
  const chosen = Option.map(maybeVerdict, verdict => verdict.verdict)
  const fieldId = (name: string) => `review-${line.id}-${name}`
  return h.fieldset(
    [h.Class('flex flex-col gap-3')],
    [
      h.legend(
        [h.Class('mb-2 text-base font-semibold')],
        ['Your verdict on ', h.span([h.Lang('ja')], [line.text])],
      ),
      h.div(
        [h.Class('flex flex-col gap-1')],
        verdictChoices.map(([verdict, label]) =>
          h.label(
            [
              h.For(fieldId(verdict)),
              h.Class(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-base text-ink has-focus-visible:outline-2 has-focus-visible:outline-accent',
              ),
            ],
            [
              h.input([
                h.Id(fieldId(verdict)),
                h.Type('radio'),
                h.Name(fieldId('verdict')),
                h.Value(verdict),
                h.Checked(Option.contains(chosen, verdict)),
                h.OnChange(() => events.chooseVerdict(line.id, verdict)),
                h.Class('size-5 accent-accent'),
              ]),
              h.span([], [label]),
            ],
          ),
        ),
      ),
      ...(Option.contains(chosen, 'correct')
        ? [
            h.div(
              [h.Class('flex flex-col gap-1')],
              [
                h.label(
                  [
                    h.For(fieldId('accent')),
                    h.Class('text-base font-semibold'),
                  ],
                  [
                    'Accent type of ',
                    h.span([h.Lang('ja')], [first?.text ?? line.text]),
                  ],
                ),
                h.select(
                  [
                    h.Id(fieldId('accent')),
                    h.OnChange(value => events.chooseAccent(line.id, value)),
                    h.Class(
                      'min-h-11 self-start rounded-md border border-line bg-surface px-3 text-base text-ink focus-ring',
                    ),
                  ],
                  [
                    h.option(
                      [
                        h.Value(''),
                        h.Selected(
                          Option.exists(
                            maybeVerdict,
                            verdict => verdict.accentType === undefined,
                          ),
                        ),
                      ],
                      ['Choose'],
                    ),
                    ...Array.from({ length: firstMorae + 1 }, (_, type) =>
                      h.option(
                        [
                          h.Value(String(type)),
                          h.Selected(
                            Option.exists(
                              maybeVerdict,
                              verdict => verdict.accentType === type,
                            ),
                          ),
                        ],
                        [accentText(type, firstMorae)],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ]
        : []),
      ...(Option.isSome(maybeVerdict)
        ? [
            h.div(
              [h.Class('flex flex-col gap-1')],
              [
                h.label(
                  [h.For(fieldId('note')), h.Class('text-base font-semibold')],
                  ['Note, if any'],
                ),
                h.input([
                  h.Id(fieldId('note')),
                  h.Type('text'),
                  h.Autocomplete('off'),
                  h.Value(maybeVerdict.value.note ?? ''),
                  h.OnInput(note => events.changeNote(line.id, note)),
                  h.Class(
                    'min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink focus-ring',
                  ),
                ]),
              ],
            ),
            h.button(
              [
                h.Type('button'),
                h.OnClick(events.clearVerdict(line.id)),
                h.Class('button button-secondary self-start'),
              ],
              ['Clear this verdict'],
            ),
          ]
        : []),
    ],
  )
}

const lineCard = <ViewMessage>(
  line: StarterPackLine,
  page: ReviewReady,
  events: ReviewEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const playing = page.play._tag === 'Playing' && page.play.lineId === line.id
  return h.keyed('li')(
    line.id,
    [
      h.Class(
        'flex flex-col gap-4 rounded-lg border border-line bg-raised p-4 sm:p-5',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-start justify-between gap-4')],
        [
          h.div(
            [h.Class('flex min-w-0 flex-col gap-1')],
            [
              h.h3(
                [h.Lang('ja'), h.Class('text-2xl font-bold break-words')],
                [line.text],
              ),
              h.p(
                [h.Class('text-base text-muted break-words')],
                [
                  h.span([h.Lang('ja')], [line.kana]),
                  ` · ${countText(line.morae.length, 'mora', 'morae')}: `,
                  h.span([h.Lang('ja')], [line.morae.join('・')]),
                ],
              ),
            ],
          ),
          playButton(line, playing, events, h),
        ],
      ),
      statedAccent(line, h),
      ...(line.flag === null
        ? []
        : [
            h.p(
              [h.Class('text-sm text-warn break-words')],
              [`The sources differ: ${line.flag}`],
            ),
          ]),
      ...(line.note === null
        ? []
        : [h.p([h.Class('text-sm text-muted break-words')], [line.note])]),
      h.p(
        [h.Class('text-sm text-muted break-words')],
        [`Recorded by ${line.credit.author}, from ${line.credit.source}.`],
      ),
      verdictFields(line, verdictOf(page.draft, line.id), events, h),
    ],
  )
}

const saveText = (save: ReviewSave): string =>
  ReviewSave.match(save, {
    Kept: () => 'Your verdicts are kept on this device.',
    Saving: () => 'Keeping your verdicts on this device…',
    Failed: ({ reason }) => `Your last change was not kept. ${reason}`,
  })

const judged = (draft: ReviewDraft, pack: StarterPack): number =>
  pack.levels
    .flatMap(level => level.lines)
    .filter(line => Option.isSome(verdictOf(draft, line.id))).length

const readyBody = <ViewMessage>(
  page: ReviewReady,
  pack: StarterPack,
  events: ReviewEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> => {
  const all = pack.levels.reduce((sum, level) => sum + level.lines.length, 0)
  return [
    h.section(
      [
        h.AriaLabelledBy('review-reviewer-heading'),
        h.Class(
          'flex flex-col gap-3 rounded-lg border border-line bg-raised p-4 sm:p-5',
        ),
      ],
      [
        h.h2(
          [h.Id('review-reviewer-heading'), h.Class('text-xl font-bold')],
          ['The reviewer'],
        ),
        h.label(
          [h.For('review-reviewer'), h.Class('text-base text-ink')],
          [
            'Your name, only if you have agreed in writing to be credited by it; otherwise leave it empty.',
          ],
        ),
        h.input([
          h.Id('review-reviewer'),
          h.Type('text'),
          h.Autocomplete('off'),
          h.Value(page.draft.reviewer),
          h.OnInput(events.changeReviewer),
          h.Class(
            'min-h-11 w-full max-w-md rounded-md border border-line bg-surface px-3 text-base text-ink focus-ring',
          ),
        ]),
      ],
    ),
    h.p(
      [h.Role('status'), h.Class('text-base text-ink')],
      [
        `${judged(page.draft, pack)} of ${countText(all, 'line')} have a verdict. ${saveText(page.save)}`,
      ],
    ),
    ...Option.match(page.maybePlayFailure, {
      onNone: () => [],
      onSome: reason => [
        h.p(
          [h.Role('alert'), h.Class('text-base text-bad break-words')],
          [`The line did not play. ${reason}`],
        ),
      ],
    }),
    ...pack.levels.map(level =>
      h.keyed('section')(
        level.id,
        [
          h.AriaLabelledBy(`review-${level.id}`),
          h.Class('flex flex-col gap-4'),
        ],
        [
          h.h2(
            [h.Id(`review-${level.id}`), h.Class('text-xl font-bold')],
            [level.name],
          ),
          h.ul(
            [h.Class('flex flex-col gap-4')],
            level.lines.map(line => lineCard(line, page, events, h)),
          ),
        ],
      ),
    ),
    h.section(
      [
        h.AriaLabelledBy('review-export-heading'),
        h.Class(
          'flex flex-col gap-3 rounded-lg border border-line bg-raised p-4 sm:p-5',
        ),
      ],
      [
        h.h2(
          [h.Id('review-export-heading'), h.Class('text-xl font-bold')],
          ['Save the verdicts'],
        ),
        h.p(
          [h.Class('text-base text-ink')],
          [
            'One file of every verdict given, dated today, saved where you choose on this device. Nothing is sent anywhere.',
          ],
        ),
        h.button(
          [
            h.Type('button'),
            h.OnClick(events.export),
            h.Class('button button-primary self-start'),
          ],
          ['Save the verdicts as a file'],
        ),
        h.p(
          [h.AriaLive('polite'), h.Class('text-base text-ink empty:hidden')],
          [
            ReviewExported.match(page.exported, {
              Nothing: () => '',
              Saved: ({ fileName, verdicts }) =>
                `Saved ${countText(verdicts, 'verdict')} as ${fileName}.`,
              Refused: ({ reason }) => `Not saved. ${reason}`,
            }),
          ],
        ),
      ],
    ),
  ]
}

export const reviewView = <ViewMessage>(
  page: ReviewPage,
  pack: StarterPack,
  events: ReviewEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  pageFrame(
    'Review',
    [
      h.header(
        [h.Class('flex flex-col gap-2')],
        [
          h.h1(
            [h.Class('text-3xl font-bold sm:text-5xl')],
            ['Review the starter lines'],
          ),
          h.p(
            [h.Class('text-base text-muted')],
            [
              'Hear each line, then say whether its word and its Tokyo accent are right. Each verdict is kept on this device as you give it.',
            ],
          ),
        ],
      ),
      ...ReviewPage.match(page, {
        NotLoaded: () => [],
        Loading: () => [],
        Failed: ({ reason }) => [
          h.p(
            [h.Role('alert'), h.Class('text-base text-bad break-words')],
            [`The review could not be read. ${reason}`],
          ),
        ],
        Ready: ready => readyBody(ready, pack, events, h),
      }),
    ],
    h,
  )
