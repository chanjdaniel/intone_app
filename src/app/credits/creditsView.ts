import type { Html, HtmlBuilder } from 'foldkit/html'
import { type ModelId, modelCredits } from 'virtual:intone/models'

import type { StarterPack } from '../../services/starter-records'
import { firstLines } from '../line/lines'
import { reviewNoteOf, starterPack } from '../line/starter'
import { pageFrame } from '../pageFrame'

// /credits: every model the app ships, read from the build's own model
// list, so a model added there is credited here, with its licence and
// its source, and the tokeniser that reads the reading dictionary; the
// recordings the app brings, the starter set's read from its pack
// (../line/starter.ts), each with its author, source, licence and what
// was done to it, as CC BY and CC BY-SA ask; and the software's notices,
// which every copy of the app carries at /NOTICES.md. Each model runs on
// this device, served by the app itself; the links to their sources are
// opened in a new tab, never fetched.

const externalLink = <ViewMessage>(
  href: string,
  name: string,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.a(
    [
      h.Href(href),
      h.Target('_blank'),
      h.Rel('noopener noreferrer'),
      h.Class(
        'inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4 focus-ring',
      ),
    ],
    [name],
  )

const section = <ViewMessage>(
  id: string,
  heading: string,
  body: ReadonlyArray<Html>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.section(
    [
      h.AriaLabelledBy(id),
      h.Class(
        'flex flex-col gap-4 rounded-lg border border-line bg-raised p-5 sm:p-6',
      ),
    ],
    [h.h2([h.Id(id), h.Class('text-xl font-bold')], [heading]), ...body],
  )

// What each model does in the app.
const usedFor: Readonly<Record<ModelId, string>> = {
  'swift-f0': 'Finds the pitch of your voice and of each line.',
  'silero-vad': 'Finds the speech in a clip you bring, to cut it into lines.',
  'whisper-base':
    'Writes out the text of a clip you bring, once you agree to its download.',
  'whisper-small': 'The larger model for the text, if you choose it instead.',
  'lindera-ipadic':
    'The dictionary that gives a line’s kanji their readings in kana, once you turn readings on.',
}

// The tokeniser that reads the dictionary, a package the app ships (its
// version is the one package.json pins).
const tokeniser = {
  name: 'Lindera 6.2.0',
  licence: 'MIT',
  source: 'https://github.com/lindera/lindera/tree/v6.2.0',
}

const credit = <ViewMessage>(
  key: string,
  entry: Readonly<{ name: string; licence: string; source: string }>,
  usedFor: string,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.keyed('li')(
    key,
    [h.Class('flex flex-col gap-1')],
    [
      h.h3([h.Class('text-lg font-semibold')], [entry.name]),
      h.p([h.Class('text-base text-ink')], [usedFor]),
      h.p([h.Class('text-sm text-muted')], [`Licence: ${entry.licence}`]),
      h.div(
        [h.Class('flex')],
        [externalLink(entry.source, `Source of ${entry.name}`, h)],
      ),
    ],
  )

// `pack` is the starter set's, the app's own unless a test gives another.
export const creditsView = <ViewMessage>(
  h: HtmlBuilder<ViewMessage>,
  pack: StarterPack = starterPack,
): Html =>
  pageFrame(
    'Credits',
    [
      h.h1([h.Class('text-3xl font-bold sm:text-5xl')], ['Credits']),
      section(
        'credits-models-heading',
        'Models and the tokeniser',
        [
          h.p(
            [h.Class('text-base text-ink')],
            [
              'Each runs on this device, downloaded from Intone itself; nothing you record or bring is sent anywhere.',
            ],
          ),
          h.ul(
            [h.Class('flex flex-col gap-4')],
            [
              ...modelCredits.map(model =>
                credit(model.id, model, usedFor[model.id], h),
              ),
              credit(
                'lindera',
                tokeniser,
                'Reads a line’s text into words, so the dictionary can give each its reading.',
                h,
              ),
            ],
          ),
        ],
        h,
      ),
      section(
        'credits-recordings-heading',
        'Recordings',
        [
          h.ul(
            [h.Class('flex flex-col gap-2')],
            firstLines.map(line =>
              h.keyed('li')(
                `${line.clipId}/${line.lineId}`,
                [h.Class('text-base text-ink')],
                [h.span([h.Lang('ja')], [line.text]), `: ${line.credit}`],
              ),
            ),
          ),
          ...pack.levels.map(level =>
            h.keyed('div')(
              level.id,
              [h.Class('flex flex-col gap-3')],
              [
                h.h3([h.Class('text-lg font-semibold')], [level.name]),
                h.ul(
                  [h.Class('flex flex-col gap-3')],
                  level.lines.map(line =>
                    h.keyed('li')(
                      line.id,
                      [h.Class('flex flex-col gap-0.5')],
                      [
                        h.p(
                          [h.Class('text-base text-ink')],
                          [
                            h.span([h.Lang('ja')], [line.text]),
                            ` (`,
                            h.span([h.Lang('ja')], [line.kana]),
                            `): ${line.credit.author}`,
                          ],
                        ),
                        h.p(
                          [h.Class('text-sm text-muted')],
                          [`${line.credit.changes} ${reviewNoteOf(line)}`],
                        ),
                        h.div(
                          [h.Class('flex flex-wrap gap-x-4')],
                          [
                            ...(line.credit.source === 'VOICEVOX'
                              ? []
                              : [
                                  externalLink(
                                    line.credit.page,
                                    `${line.text} on ${line.credit.source}`,
                                    h,
                                  ),
                                ]),
                            externalLink(
                              line.credit.licenceUrl,
                              line.credit.licence,
                              h,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          h.p(
            [h.Class('text-sm text-muted')],
            [
              'Each word’s accent type was checked against UniDic 2023.02, under its BSD licence, and against Wiktionary, under CC BY-SA 4.0; no dictionary ships in the app.',
            ],
          ),
        ],
        h,
      ),
      section(
        'credits-software-heading',
        'Software',
        [
          h.p(
            [h.Class('text-base text-ink')],
            [
              'Intone’s own code is all rights reserved. The packages it is built with, and the models’ files, are listed with their licences in its notices.',
            ],
          ),
          h.a(
            [
              h.Href(`${import.meta.env.BASE_URL}NOTICES.md`),
              h.Class(
                'inline-flex min-h-11 items-center self-start rounded-md text-accent underline underline-offset-4 focus-ring',
              ),
            ],
            ['The notices'],
          ),
        ],
        h,
      ),
    ],
    h,
  )
