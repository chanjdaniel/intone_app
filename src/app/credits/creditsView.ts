import type { Html, HtmlBuilder } from 'foldkit/html'
import { modelCredits } from 'virtual:intone/models'

import { bundledLines } from '../line/lines'
import { pageFrame } from '../pageFrame'

// /credits: every model the app ships, read from the build's own model
// list, so a model added there is credited here, with its licence and
// its source; the recordings the app brings, credited as their terms
// ask; and the software's notices, which every copy of the app carries
// at /NOTICES.md. Each model runs on this device, served by the app
// itself; the links to their sources are opened in a new tab, never
// fetched.

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
const usedFor: Readonly<Record<string, string>> = {
  'swift-f0': 'Finds the pitch of your voice and of each line.',
  'silero-vad': 'Finds the speech in a clip you bring, to cut it into lines.',
  'whisper-base':
    'Writes out the text of a clip you bring, once you agree to its download.',
  'whisper-small': 'The larger model for the text, if you choose it instead.',
}

export const creditsView = <ViewMessage>(h: HtmlBuilder<ViewMessage>): Html =>
  pageFrame(
    'Credits',
    [
      h.h1([h.Class('text-3xl font-bold sm:text-5xl')], ['Credits']),
      section(
        'credits-models-heading',
        'Models',
        [
          h.p(
            [h.Class('text-base text-ink')],
            [
              'Each runs on this device, downloaded from Intone itself; nothing you record or bring is sent anywhere.',
            ],
          ),
          h.ul(
            [h.Class('flex flex-col gap-4')],
            modelCredits.map(model =>
              h.keyed('li')(
                model.id,
                [h.Class('flex flex-col gap-1')],
                [
                  h.h3([h.Class('text-lg font-semibold')], [model.name]),
                  h.p(
                    [h.Class('text-base text-ink')],
                    [usedFor[model.id] ?? ''],
                  ),
                  h.p(
                    [h.Class('text-sm text-muted')],
                    [`Licence: ${model.licence}`],
                  ),
                  h.div(
                    [h.Class('flex')],
                    [externalLink(model.source, `Source of ${model.name}`, h)],
                  ),
                ],
              ),
            ),
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
            bundledLines.map(line =>
              h.keyed('li')(
                `${line.clipId}/${line.lineId}`,
                [h.Class('text-base text-ink')],
                [
                  h.span([h.Lang('ja')], [line.text]),
                  `: voice ${line.credit}, made with VOICEVOX.`,
                ],
              ),
            ),
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
