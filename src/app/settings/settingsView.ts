import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Dialog } from '@foldkit/ui'

import { bytesText, countText } from '../history/format'
import { pageFrame } from '../pageFrame'
import { creditsRouter } from '../route'
import type { TextChoiceState, TextJob, TextOffer } from '../text/text'
import {
  type TextEvents,
  settingsTextSection,
  textDialogView,
} from '../text/textView'
import {
  BackupState,
  type Browser,
  ClearState,
  type Persistence,
  RestoreState,
  SettingsPage,
  type StorageFacts,
} from './settings'

// /settings: whether takes keep their audio; what the browser promises
// about the device's storage, said plainly, with what Safari needs; the
// backup and the restore; and clearing everything, behind a confirming
// dialog.

export type SettingsEvents<ViewMessage> = Readonly<{
  keepTakeAudio: (keep: boolean) => ViewMessage
  askToPersist: ViewMessage
  includeAudio: (include: boolean) => ViewMessage
  saveBackup: ViewMessage
  restoreBackup: ViewMessage
  clearAll: ViewMessage
  keepEverything: ViewMessage
  confirmClearAll: ViewMessage
  dialog: (message: Dialog.Message) => ViewMessage
  text: Pick<
    TextEvents<ViewMessage>,
    'chooseModel' | 'stop' | 'dialog' | 'selectModel' | 'agree' | 'notNow'
  >
}>

// What the settings show of the text model: the learner's answer, the
// download in the background, and the consent dialog.
export type SettingsText = Readonly<{
  choice: TextChoiceState
  job: TextJob
  offer: TextOffer
  dialog: Dialog.Model
}>

const primaryButton = 'button-primary disabled:opacity-60'
const secondaryButton = 'button-secondary disabled:text-muted'
const dangerButton = 'button bg-bad text-on-accent disabled:opacity-60'

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

const paragraph = <ViewMessage>(
  text: string,
  h: HtmlBuilder<ViewMessage>,
): Html => h.p([h.Class('text-base text-ink')], [text])

const quiet = <ViewMessage>(text: string, h: HtmlBuilder<ViewMessage>): Html =>
  h.p([h.Class('text-sm text-muted')], [text])

// A status line that stays in place, so what it says is heard once.
const statusLine = <ViewMessage>(
  text: string,
  tone: 'muted' | 'bad',
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.p(
    [
      h.Role('status'),
      h.Class(
        `text-base break-words empty:hidden ${tone === 'bad' ? 'text-bad' : 'text-muted'}`,
      ),
    ],
    [text],
  )

const checkbox = <ViewMessage>(
  id: string,
  label: string,
  checked: boolean,
  enabled: boolean,
  toggle: (checked: boolean) => ViewMessage,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.div(
    [h.Class('flex items-center gap-3')],
    [
      h.input([
        h.Id(id),
        h.Type('checkbox'),
        h.Checked(checked),
        ...(enabled ? [h.OnClick(toggle(!checked))] : [h.Disabled(true)]),
        h.Class(`size-6 shrink-0 accent-accent focus-ring`),
      ]),
      h.label(
        [
          h.For(id),
          h.Class(
            `flex min-h-11 items-center text-base ${enabled ? 'text-ink' : 'text-muted'}`,
          ),
        ],
        [label],
      ),
    ],
  )

// What the browser has promised about the app's storage, in words.
export const persistenceText: Readonly<Record<Persistence, string>> = {
  Granted:
    'The browser has agreed to keep Intone’s storage: it will not delete your history to make room on this device. Clearing this site’s data in the browser’s own settings still deletes it.',
  NotGranted:
    'The browser has not agreed to keep Intone’s storage, so it may delete your history if this device runs short of space. A backup keeps a copy that is yours.',
  Unsupported:
    'This browser cannot say whether it keeps Intone’s storage, so it may delete your history. A backup keeps a copy that is yours.',
}

// What Safari needs, and why.
export const safariText: Readonly<Record<Browser, ReadonlyArray<string>>> = {
  Safari: [
    'Safari deletes what a site keeps after seven days without a visit, your history included, unless the site is added to the Home Screen.',
    'Add Intone to your Home Screen (Share, then Add to Home Screen; on a Mac, File, then Add to Dock) and it keeps its storage for as long as it is there.',
    'The Home Screen app starts with storage of its own: save a backup here, then restore it there.',
  ],
  SafariHomeScreen: [
    'Intone is running from your Home Screen, so Safari’s seven-day limit does not apply to its storage.',
  ],
  Other: [],
}

const storageSection = <ViewMessage>(
  storage: StorageFacts,
  events: SettingsEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  section(
    'storage-heading',
    'Storage on this device',
    [
      paragraph(persistenceText[storage.persistence], h),
      ...(storage.persistence === 'NotGranted'
        ? [
            h.button(
              [
                h.Type('button'),
                h.OnClick(events.askToPersist),
                h.Class(`${secondaryButton} self-start`),
              ],
              ['Ask the browser to keep it'],
            ),
          ]
        : []),
      ...Option.match(storage.maybeUsageBytes, {
        onNone: () => [],
        onSome: usage => [
          quiet(
            `Intone uses about ${bytesText(usage)} of this device’s storage${Option.match(
              storage.maybeQuotaBytes,
              {
                onNone: () => '.',
                onSome: quota =>
                  `, of ${bytesText(quota)} the browser allows it.`,
              },
            )}`,
            h,
          ),
        ],
      }),
      ...(storage.browser === 'Other'
        ? []
        : [
            h.div(
              [
                h.Class(
                  'flex flex-col gap-2 rounded-md border border-line bg-surface p-4',
                ),
              ],
              [
                h.h3([h.Class('text-base font-bold')], ['On Safari']),
                ...safariText[storage.browser].map(line => paragraph(line, h)),
              ],
            ),
          ]),
    ],
    h,
  )

const audioSection = <ViewMessage>(
  page: Extract<SettingsPage, { _tag: 'Ready' }>,
  events: SettingsEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  section(
    'audio-heading',
    'Your takes’ audio',
    [
      paragraph(
        'Each take keeps its curve and its match. Its recording is kept too only if you turn that on here, and only on this device; deleting a take deletes its recording.',
        h,
      ),
      checkbox(
        'keep-take-audio',
        'Keep the recording of each take',
        page.keepTakeAudio,
        true,
        events.keepTakeAudio,
        h,
      ),
      quiet(
        page.takesWithAudio === 0
          ? 'No recordings are kept.'
          : `${countText(page.takesWithAudio, 'take has its recording', 'takes have their recordings')} kept.`,
        h,
      ),
      Option.match(page.maybeKeepAudioFailure, {
        onNone: () => statusLine('', 'bad', h),
        onSome: reason =>
          statusLine(`That did not change: ${reason}`, 'bad', h),
      }),
    ],
    h,
  )

const backupText = (backup: BackupState): string =>
  BackupState.match(backup, {
    Idle: () => '',
    Saving: () => 'Making the backup.',
    Saved: ({ fileName, takes }) =>
      `Saved ${fileName}, with ${countText(takes, 'take')}.`,
    Failed: ({ reason }) => `The backup was not saved. ${reason}`,
  })

const restoreText = (restore: RestoreState): string =>
  RestoreState.match(restore, {
    Idle: () => '',
    Restoring: () => 'Choose a backup file. Its takes are checked, then added.',
    Restored: ({ takes }) =>
      `Restored ${countText(takes, 'take')} from the backup.`,
    Failed: ({ reason }) => `Nothing was restored. ${reason}`,
  })

// What including the recordings brings: the takes' kept audio and the
// clips' own audio.
const recordingsLabel = (takes: number, clips: number): string => {
  const parts = [
    ...(takes > 0 ? [countText(takes, 'take')] : []),
    ...(clips > 0 ? [countText(clips, 'clip')] : []),
  ]
  return parts.length === 0
    ? 'Include the recordings (none are kept)'
    : `Include the recordings (${parts.join(' and ')})`
}

const backupSection = <ViewMessage>(
  page: Extract<SettingsPage, { _tag: 'Ready' }>,
  events: SettingsEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  section(
    'backup-heading',
    'Backup',
    [
      paragraph(
        'A backup is one file, saved where you choose, with every take, its curves and its match, and your clips’ lines. Restoring it here or on another device adds them there; nothing is sent anywhere. Recordings stay out of it unless you include them.',
        h,
      ),
      checkbox(
        'backup-audio',
        recordingsLabel(page.takesWithAudio, page.clipsWithAudio),
        page.includeAudio && page.takesWithAudio + page.clipsWithAudio > 0,
        page.takesWithAudio + page.clipsWithAudio > 0,
        events.includeAudio,
        h,
      ),
      h.div(
        [h.Class('flex flex-wrap gap-3')],
        [
          h.button(
            [
              h.Type('button'),
              ...(page.backup._tag === 'Saving'
                ? [h.Disabled(true)]
                : [h.OnClick(events.saveBackup)]),
              h.Class(primaryButton),
            ],
            ['Save a backup'],
          ),
          h.button(
            [
              h.Type('button'),
              ...(page.restore._tag === 'Restoring'
                ? [h.Disabled(true)]
                : [h.OnClick(events.restoreBackup)]),
              h.Class(secondaryButton),
            ],
            ['Restore from a backup'],
          ),
        ],
      ),
      statusLine(
        backupText(page.backup),
        page.backup._tag === 'Failed' ? 'bad' : 'muted',
        h,
      ),
      statusLine(
        restoreText(page.restore),
        page.restore._tag === 'Failed' ? 'bad' : 'muted',
        h,
      ),
    ],
    h,
  )

const clearSection = <ViewMessage>(
  events: SettingsEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  section(
    'clear-heading',
    'Clear all data',
    [
      paragraph(
        'Deletes everything Intone keeps on this device: every take, its curves, match and recording, your clips and their lines, your settings, and the lines’ curves. It cannot be undone; a backup saved first keeps a copy.',
        h,
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(events.clearAll),
          h.Class(`${dangerButton} self-start`),
        ],
        ['Clear all data…'],
      ),
    ],
    h,
  )

// The confirming dialog: the frontend patterns' narrow width for two
// controls, with the body, the error and the actions in one form, so
// Enter confirms.
const clearDialogView = <ViewMessage>(
  dialog: Dialog.Model,
  clearing: ClearState,
  events: SettingsEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.submodel({
    slotId: dialog.id,
    model: dialog,
    view: Dialog.view,
    viewInputs: {
      hasDescription: true,
      toView: ({
        dialog: dialogAttributes,
        backdrop,
        panel,
        title,
        description,
        initialFocus,
        isVisible,
      }) =>
        h.dialog(
          [
            ...dialogAttributes,
            h.Class('bg-transparent p-0 open:flex items-center justify-center'),
          ],
          isVisible
            ? [
                h.div([...backdrop, h.Class('fixed inset-0 bg-ink/50')]),
                h.form(
                  [
                    ...panel,
                    h.OnSubmit(events.confirmClearAll),
                    h.Class(
                      'relative flex w-[min(100%-2rem,26rem)] flex-col gap-4 rounded-lg border border-line bg-surface p-6 text-ink shadow-lg',
                    ),
                  ],
                  [
                    h.h2(
                      [...title, h.Class('text-xl font-bold')],
                      ['Delete everything?'],
                    ),
                    h.p(
                      [...description, h.Class('text-base text-ink')],
                      [
                        'Every take, its curves, match and recording, your clips, your settings and the lines’ curves will be deleted from this device. This cannot be undone.',
                      ],
                    ),
                    h.p(
                      [
                        h.Role('alert'),
                        h.Class('text-base text-bad empty:hidden'),
                      ],
                      [
                        ClearState.match(clearing, {
                          Idle: () => '',
                          Clearing: () => '',
                          Failed: ({ reason }) =>
                            `Nothing was deleted. ${reason}`,
                        }),
                      ],
                    ),
                    h.div(
                      [h.Class('flex flex-wrap justify-end gap-3')],
                      [
                        h.button(
                          [
                            ...initialFocus,
                            h.Type('button'),
                            h.OnClick(events.keepEverything),
                            h.Class(secondaryButton),
                          ],
                          ['Keep everything'],
                        ),
                        h.button(
                          [
                            h.Type('submit'),
                            ...(clearing._tag === 'Clearing'
                              ? [h.Disabled(true)]
                              : []),
                            h.Class(dangerButton),
                          ],
                          [
                            clearing._tag === 'Clearing'
                              ? 'Deleting…'
                              : 'Delete everything',
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage: events.dialog,
  })

const statusBox = <ViewMessage>(
  text: string,
  role: 'status' | 'alert',
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.p(
    [
      h.Role(role),
      h.Class(
        `rounded-lg border border-line bg-raised p-5 text-base break-words ${role === 'alert' ? 'text-bad' : 'text-muted'}`,
      ),
    ],
    [text],
  )

export const settingsView = <ViewMessage>(
  page: SettingsPage,
  maybeNotice: Option.Option<string>,
  dialog: Dialog.Model,
  text: SettingsText,
  events: SettingsEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const heading = h.h1(
    [h.Class('text-3xl font-bold sm:text-5xl')],
    ['Settings'],
  )
  const notice = h.p(
    [
      h.Role('status'),
      h.Class(
        'rounded-lg border border-good bg-surface p-4 text-base text-ink empty:hidden',
      ),
    ],
    [Option.getOrElse(maybeNotice, () => '')],
  )
  const reading = (): ReadonlyArray<Html> => [
    statusBox('Reading what this device keeps.', 'status', h),
  ]
  const body = SettingsPage.match<ReadonlyArray<Html>>(page, {
    NotLoaded: reading,
    Loading: reading,
    Failed: ({ reason }) => [
      statusBox(`The settings could not be read. ${reason}`, 'alert', h),
    ],
    Ready: ready => [
      audioSection(ready, events, h),
      settingsTextSection(text.choice, text.job, events.text, h),
      storageSection(ready.storage, events, h),
      backupSection(ready, events, h),
      clearSection(events, h),
      clearDialogView(dialog, ready.clearing, events, h),
      h.p(
        [h.Class('text-base text-ink')],
        [
          h.a(
            [
              h.Href(creditsRouter()),
              h.Class(
                'inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4 focus-ring',
              ),
            ],
            ['Credits for the models and recordings'],
          ),
        ],
      ),
    ],
  })
  return pageFrame(
    'Settings',
    [
      heading,
      notice,
      ...body,
      textDialogView(text.dialog, text.offer, events.text, h),
    ],
    h,
  )
}
