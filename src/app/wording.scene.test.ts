import { Option } from 'effect'
import { Mount, expect, given, scene, text } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { wordsOf } from '../engine/text/readings'
import type { TextChoice } from '../services/history-records'
import {
  ClipWaveform,
  EditSaving,
  type LineEditor,
  initialEditor,
} from './level/editor'
import { FollowLineEditorPointer } from './level/editorPointer'
import {
  ClipsPage,
  DeleteState,
  type LevelClip,
  LevelPage,
  LevelStars,
  levelClipOf,
  levelClipOfBundled,
} from './level/level'
import { sampleClip, samplePack } from './level/testClips'
import { bundledClips } from './line/lines'
import { NativeCurve } from './line/native'
import { LinePlace } from './line/place'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from './main'
import {
  LineReadingsState,
  ReadingFixForm,
  ReadingsChoice,
  ReadingsTool,
  shownWordsOf,
} from './readings/readings'
import { ReturnNote } from './returns/lineReturn'
import { DuePage } from './returns/returns'
import { DrawCurvePair } from './take/curvePair'
import {
  type FinishedTake,
  Take,
  TakeResult,
  TakeScore,
  isBlindUnderWay,
  levelMeterFloorDb,
} from './take/take'
import {
  sampleCurve,
  sampleFeatures,
  sampleKept,
  sampleLine,
  sampleScore,
} from './take/testCurves'
import {
  LineTextEdit,
  TextChoiceState,
  TextFormStatus,
  TextJob,
  TextPurpose,
  TextStep,
} from './text/text'
import { PackJob, PackStep, UploadJob, UploadStep } from './upload/upload'

// The app claims only what it compared (report section 3): no screen
// says "accuracy", or that a take is correct. Every state of every
// screen is read here; tests/build/production-build.test.ts reads the
// built bundle's strings, labels included.

const line = AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })
const readingsLine = { clipId: 'ame-ga-suki', lineId: '1', text: '雨が好き' }
const shownReadings = ReadingsChoice.Read({ maybeShown: Option.some('Shown') })

const finishedWith = (score: TakeScore): FinishedTake => ({
  takeNumber: 1,
  mode: 'Guided',
  maybeOutcome: Option.none(),
  result: TakeResult.Tracked({ curve: sampleCurve, score, kept: sampleKept }),
})

const everyTake: ReadonlyArray<Take> = [
  Take.Idle(),
  Take.PlayingNative({ mode: 'Guided', takeNumber: 1, tracker: 'Loading' }),
  Take.Preparing({ mode: 'Guided', takeNumber: 1 }),
  Take.AwaitingMic({ mode: 'Guided', takeNumber: 1 }),
  Take.MicPromptIgnored({ mode: 'Guided', takeNumber: 1 }),
  Take.Recording({
    mode: 'Guided',
    takeNumber: 1,
    elapsedSeconds: 1,
    levelDb: levelMeterFloorDb,
    maybeOnsetSeconds: Option.some(0.2),
  }),
  Take.Analysing({ mode: 'Guided', takeNumber: 1 }),
  Take.ShowingResult(finishedWith(sampleScore)),
  Take.ShowingResult(finishedWith({ ...sampleScore, provisional: false })),
  ...(['TooQuiet', 'TooLittleVoiced', 'LengthMismatch'] as const).map(reason =>
    Take.ShowingResult(
      finishedWith(TakeScore.CouldNotCompare({ version: 1, reason })),
    ),
  ),
  Take.ShowingResult({
    mode: 'Guided' as const,
    maybeOutcome: Option.none(),
    takeNumber: 1,
    result: TakeResult.TooQuiet(),
  }),
  Take.ShowingResult({
    mode: 'Guided' as const,
    maybeOutcome: Option.none(),
    takeNumber: 1,
    result: TakeResult.TooNoisy(),
  }),
  Take.Listening({
    voice: 'Take',
    extent: 'WorstStretch',
    maybeTake: Option.some(finishedWith(sampleScore)),
  }),
  Take.Listening({ voice: 'Line', extent: 'Whole', maybeTake: Option.none() }),
  Take.MicDenied(),
  Take.NoMicDevice(),
  Take.MicFailed({ reason: 'busy' }),
  Take.AnalysisFailed({ reason: 'crashed' }),
  // A blind take, and what takes did for the line's stars.
  Take.PlayingNative({ mode: 'Blind', takeNumber: 1, tracker: 'Ready' }),
  Take.Recording({
    mode: 'Blind',
    takeNumber: 1,
    elapsedSeconds: 1,
    levelDb: levelMeterFloorDb,
    maybeOnsetSeconds: Option.some(0.2),
  }),
  Take.Analysing({ mode: 'Blind', takeNumber: 1 }),
  ...(
    [
      [0, 1, Option.some(0.6), true],
      [1, 2, Option.some(0.8), true],
      [2, 3, Option.some(0.95), false],
      [3, 3, Option.none(), false],
    ] as const
  ).map(([starsBefore, starsAfter, maybePreviousBest, isPersonalBest]) =>
    Take.ShowingResult({
      ...finishedWith(sampleScore),
      mode: starsAfter === 3 ? 'Blind' : 'Guided',
      maybeOutcome: Option.some({
        starsBefore,
        starsAfter,
        maybePreviousBest,
        isPersonalBest,
        returnNote:
          starsAfter === 3
            ? ReturnNote.ComesBack({ on: '2026-11-13' })
            : ReturnNote.StillDue(),
      }),
    }),
  ),
  Take.ShowingResult({
    ...finishedWith(
      TakeScore.CouldNotCompare({ version: 1, reason: 'TooQuiet' }),
    ),
    mode: 'Blind',
    maybeOutcome: Option.some({
      starsBefore: 2,
      starsAfter: 2,
      maybePreviousBest: Option.some(0.9),
      isPersonalBest: false,
      returnNote: ReturnNote.Quiet(),
    }),
  }),
]

// What no screen offers (report section 5, "Left out"): leaderboards,
// coins, shops, lives, or a streak to lose.
const gamified =
  /leaderboard|\bcoins?\b|\bshops?\b|\blives\b|\bhearts?\b|streak/i

const bundledLevel = levelClipOfBundled(bundledClips[0]!)

const ready = NativeCurve.Ready({
  clipId: 'ame-ga-suki',
  lineId: '1',
  line: sampleLine,
  curve: sampleCurve,
  features: sampleFeatures,
})

const textLevel = (clip: LevelClip): Model => ({
  ...initialModel(
    AppRoute.Level({ clipId: clip.id, maybeFind: Option.none() }),
  ),
  textChoice: TextChoiceState.Read({ maybeChoice: Option.none() }),
  level: LevelPage.Ready({
    stars: LevelStars.Ready({ lines: [] }),
    clip,
    shownRows: 50,
    deleting: DeleteState.Idle(),
    editor: initialEditor(clip),
  }),
})

const screens: ReadonlyArray<readonly [string, Model, boolean]> = [
  ['home', initialModel(AppRoute.Home({ maybeFind: Option.none() })), false],
  [
    'home with clips',
    {
      ...initialModel(AppRoute.Home({ maybeFind: Option.none() })),
      clips: ClipsPage.Ready({
        clips: [
          {
            id: 'c1',
            name: 'a.mp3',
            seconds: 9,
            lines: 3,
            hasAudio: false,
            isPack: false,
          },
        ],
      }),
    },
    false,
  ],
  ...[
    DuePage.Ready({
      today: '2026-11-10',
      lines: [],
      maybeNextOn: Option.some('2026-11-14'),
      shownRows: 50,
    }),
    DuePage.Ready({
      today: '2026-11-10',
      lines: [
        {
          clipId: 'ame-ga-suki',
          lineId: '1',
          title: '雨が好き',
          titleIsText: true,
          levelName: '雨が好き',
          number: 1,
          stars: 3,
          lineReturn: { streak: 0, setOn: '2026-10-01', dueOn: '2026-10-02' },
        },
      ],
      maybeNextOn: Option.none(),
      shownRows: 50,
    }),
  ].map(
    (due, k) =>
      [
        `home, lines due back ${k}`,
        {
          ...initialModel(AppRoute.Home({ maybeFind: Option.none() })),
          due,
        },
        false,
      ] as const,
  ),
  ['upload', initialModel(AppRoute.Upload()), false],
  ...[
    UploadJob.Working({
      jobNumber: 1,
      file: new File([new Uint8Array(4)], 'a.mp3'),
      step: UploadStep.TrackingLines({ done: 1, total: 3 }),
    }),
    UploadJob.Refused({ name: 'a.txt', reason: 'It is not an audio file.' }),
    UploadJob.Cancelled({ name: 'a.mp3' }),
  ].map(
    job =>
      [
        `upload, ${job._tag}`,
        {
          ...initialModel(AppRoute.Upload()),
          upload: { ...initialModel(AppRoute.Upload()).upload, job },
        },
        false,
      ] as const,
  ),
  ...[
    PackJob.Working({
      jobNumber: 1,
      files: [new File(['{}'], 'pack.json')],
      step: PackStep.TrackingLines({ done: 1, total: 3 }),
    }),
    PackJob.Refused({ reason: 'pack.json is not JSON.' }),
    PackJob.Cancelled(),
  ].map(
    packJob =>
      [
        `upload, the pack ${packJob._tag}`,
        {
          ...initialModel(AppRoute.Upload()),
          upload: { ...initialModel(AppRoute.Upload()).upload, packJob },
        },
        false,
      ] as const,
  ),
  [
    'a level from the local pack',
    {
      ...initialModel(
        AppRoute.Level({ clipId: 'pack-example', maybeFind: Option.none() }),
      ),
      level: LevelPage.Ready({
        stars: LevelStars.Ready({ lines: [] }),
        clip: levelClipOf(samplePack),
        shownRows: 50,
        deleting: DeleteState.Idle(),
        editor: initialEditor(levelClipOf(samplePack)),
      }),
    },
    false,
  ],
  [
    'level',
    {
      ...initialModel(
        AppRoute.Level({ clipId: 'c1', maybeFind: Option.none() }),
      ),
      level: LevelPage.Ready({
        stars: LevelStars.Ready({ lines: [] }),
        clip: sampleClip(20, false),
        shownRows: 50,
        deleting: DeleteState.Idle(),
        editor: initialEditor(sampleClip(20, false)),
      }),
    },
    false,
  ],
  ['not found', initialModel(AppRoute.NotFound({ path: '/nope' })), false],
  ['credits', initialModel(AppRoute.Credits()), false],
  // The text: the consent dialog open, each step of the job, a failure,
  // a written-out level, a line's own text and a pasted one, the settings.
  ...[
    ...[
      TextStep.Decoding(),
      TextStep.Downloading({ done: 1, total: 2 }),
      TextStep.Preparing(),
      TextStep.Transcribing({ done: 1, total: 2 }),
      TextStep.Keeping(),
    ].map(step => ({
      ...textLevel(sampleClip(3)),
      textJob: TextJob.Working({
        jobNumber: 1,
        purpose: TextPurpose.Transcribe({ clipId: 'c1' }),
        model: 'whisper-base' as const,
        step,
      }),
    })),
    {
      ...textLevel(sampleClip(3)),
      textJob: TextJob.Failed({
        purpose: TextPurpose.Transcribe({ clipId: 'c1' }),
        model: 'whisper-base',
        reason: 'gone',
      }),
    },
    {
      ...textLevel({
        ...sampleClip(3),
        maybeWrittenBy: Option.some('whisper-small' as const),
      }),
      lineText: LineTextEdit.OneLine({
        clipId: 'c1',
        lineId: '1',
        draft: '雨',
        status: TextFormStatus.Refused({ reason: 'gone' }),
      }),
    },
    {
      ...textLevel(sampleClip(3)),
      lineText: LineTextEdit.WholeClip({
        clipId: 'c1',
        draft: '雨',
        status: TextFormStatus.Saving(),
      }),
    },
  ].map((model, k) => [`level, text ${k}`, model, false] as const),
  ...[
    Option.none(),
    Option.some<TextChoice>({ _tag: 'Declined' }),
    Option.some<TextChoice>({ _tag: 'Agreed', model: 'whisper-base' }),
  ].map(
    maybeChoice =>
      [
        `settings, text ${Option.match(maybeChoice, { onNone: () => 'unasked', onSome: choice => choice._tag })}`,
        {
          ...initialModel(AppRoute.Settings()),
          textChoice: TextChoiceState.Read({ maybeChoice }),
          textJob: TextJob.Failed({
            purpose: TextPurpose.Download(),
            model: 'whisper-base',
            reason: 'gone',
          }),
        },
        false,
      ] as const,
  ),
  // A line's readings: offered with their size, loading, shown, one of
  // them the learner's, failed, and the form that edits them.
  ...[
    { readingsChoice: ReadingsChoice.Read({ maybeShown: Option.none() }) },
    { readingsChoice: shownReadings },
    {
      readingsChoice: shownReadings,
      readingsTool: ReadingsTool.Failed({ reason: 'gone' }),
    },
    {
      readingsChoice: shownReadings,
      readingsTool: ReadingsTool.Acquired(),
      readings: LineReadingsState.Failed({ ...readingsLine, reason: 'gone' }),
    },
    {
      readingsChoice: shownReadings,
      readingsTool: ReadingsTool.Acquired(),
      readings: LineReadingsState.Ready({
        ...readingsLine,
        words: shownWordsOf(
          '雨が好き',
          wordsOf('雨が好き', [
            { surface: '雨', reading: 'アメ' },
            { surface: 'が', reading: 'ガ' },
            { surface: '好き', reading: 'スキ' },
          ]),
          Option.some({
            text: '雨が好き',
            fixes: [{ from: 0, to: 1, kana: 'あま' }],
          }),
        ),
      }),
      readingFix: ReadingFixForm.Open({
        ...readingsLine,
        drafts: [
          {
            from: 0,
            to: 1,
            surface: '雨',
            draft: 'x',
            maybeDictionaryKana: Option.some('あめ'),
          },
        ],
        status: TextFormStatus.Refused({ reason: 'gone' }),
      }),
    },
  ].map(
    (readings, k) =>
      [
        `line, readings ${k}`,
        { ...initialModel(line), ...readings },
        false,
      ] as const,
  ),
  [
    'line loading',
    {
      ...initialModel(line),
      native: NativeCurve.Loading({ clipId: 'ame-ga-suki', lineId: '1' }),
    },
    false,
  ],
  [
    'line failed',
    {
      ...initialModel(line),
      native: NativeCurve.Failed({
        clipId: 'ame-ga-suki',
        lineId: '1',
        failure: 'Failed',
        reason: 'gone',
      }),
    },
    false,
  ],
  [
    'the bundled level',
    {
      ...initialModel(
        AppRoute.Level({ clipId: 'ame-ga-suki', maybeFind: Option.none() }),
      ),
      level: LevelPage.Ready({
        stars: LevelStars.Ready({
          lines: [
            {
              lineId: '1',
              progress: { stars: 2, maybeBestMatch: Option.some(0.93) },
            },
          ],
        }),
        clip: bundledLevel,
        shownRows: 50,
        deleting: DeleteState.Idle(),
        editor: initialEditor(bundledLevel),
      }),
    },
    false,
  ],
  ...everyTake.map(
    (take, k) =>
      [
        `line, ${k} ${take._tag}`,
        {
          ...initialModel(line),
          native: ready,
          place: LinePlace.Ready({
            clipId: 'ame-ga-suki',
            lineId: '1',
            levelName: '雨が好き',
            progress: { stars: 2, maybeBestMatch: Option.some(0.93) },
            today: '2026-11-10',
            maybeReturn: Option.none(),
            maybeNext:
              k % 2 === 0
                ? Option.none()
                : Option.some({ lineId: '2', title: '2', titleIsText: false }),
          }),
          take,
          takesStarted: 1,
        },
        !isBlindUnderWay(take),
      ] as const,
  ),
]

const drawn = Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair())

describe('the wording', () => {
  test('never says "accuracy" or that a take is correct: the text model’s consent dialog', () => {
    scene(
      { update, view },
      given(
        update(textLevel(sampleClip(3)), Message.ClickedWriteOutText()).model,
      ),
      Mount.resolve(
        Dialog.AcquireResources,
        Dialog.Message.SucceededAcquireResources(),
      ),
      expect(text(/Download the text model\?/)).toExist(),
      expect(text(/accura/i)).toBeAbsent(),
      expect(text(/\b(in)?correct/i)).toBeAbsent(),
      expect(text(gamified)).toBeAbsent(),
    )
  })

  test.each(screens)(
    'never says "accuracy" or that a take is correct: %s',
    (_name, model, drawsCurves) => {
      scene(
        { update, view },
        given(model),
        ...(drawsCurves ? [drawn] : []),
        expect(text(/accura/i)).toBeAbsent(),
        expect(text(/\b(in)?correct/i)).toBeAbsent(),
        expect(text(gamified)).toBeAbsent(),
      )
    },
  )

  // The line editor: a clip with its audio, a line marked both ways, an
  // undo, a change being kept, kept and refused.
  const marked = sampleClip(4)
  const editing: LevelClip = {
    ...marked,
    lines: marked.lines.map(found =>
      found.number === 3
        ? {
            ...found,
            maybeQuality: Option.some({
              speechFrames: 120,
              confidentShare: 0.2,
              pauseFrames: 20,
              pausePitchedShare: 0.9,
            }),
          }
        : found,
    ),
    maybeUndo: Option.some({ kind: 'Split', lineNumber: 2 }),
  }
  const editorStates: ReadonlyArray<readonly [string, LineEditor]> = [
    ['shut', initialEditor(editing)],
    [
      'opening',
      { ...initialEditor(editing), waveform: ClipWaveform.Opening() },
    ],
    [
      'held, line 3',
      {
        ...initialEditor(editing),
        waveform: ClipWaveform.Ready({ peaks: new Uint8Array(1500) }),
        selectedId: '3',
        maybeNotice: Option.some(
          'Line 2 is split at 0:04.0, into lines 2 and 3.',
        ),
      },
    ],
    [
      'saving',
      {
        ...initialEditor(editing),
        waveform: ClipWaveform.Ready({ peaks: new Uint8Array(1500) }),
        saving: EditSaving.Saving({
          maybeSelect: Option.none(),
          index: 0,
          notice: '',
        }),
      },
    ],
    [
      'failed',
      {
        ...initialEditor(editing),
        waveform: ClipWaveform.Failed({ reason: 'It could not be decoded.' }),
        saving: EditSaving.Failed({ reason: 'The disk is full.' }),
      },
    ],
  ]
  test.each(editorStates)(
    'never says "accuracy" or that a take is correct: the line editor, %s',
    (_name, editor) => {
      scene(
        { update, view },
        given({
          ...initialModel(
            AppRoute.Level({ clipId: 'c1', maybeFind: Option.none() }),
          ),
          level: LevelPage.Ready({
            stars: LevelStars.Ready({ lines: [] }),
            clip: editing,
            shownRows: 50,
            deleting: DeleteState.Idle(),
            editor,
          }),
        }),
        ...(editor.waveform._tag === 'Closed'
          ? []
          : [
              Mount.resolve(
                FollowLineEditorPointer,
                Message.CompletedFollowLineEditorPointer(),
              ),
            ]),
        expect(text(/accura/i)).toBeAbsent(),
        expect(text(/\b(in)?correct/i)).toBeAbsent(),
        expect(text(gamified)).toBeAbsent(),
      )
    },
  )
})
