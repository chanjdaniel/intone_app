// The real-voice test audio: stretches of LibriVox's CC0 Japanese readings
// on the Internet Archive, for tracking and cutting real speech, and the
// room noise the VOICEVOX fixtures are mixed with. Each source is pinned by
// the SHA-1 the Internet Archive or Wikimedia Commons lists for it, and
// cut at whole samples between pauses found with ffmpeg's silencedetect
// (-40 dB, 0.35 s), so a clip starts and ends in a pause.

export type RealVoiceSource = Readonly<{
  id: string
  // The Internet Archive item and the file in it.
  item: string
  file: string
  sha1: string
  title: string
  author: string
  reader: string
  licence: 'CC0 1.0'
  licenceUrl: string
  // The clip, in seconds of the decoded file.
  fromSeconds: number
  toSeconds: number
}>

const cc0 = 'https://creativecommons.org/publicdomain/zero/1.0/'

export const realVoices: ReadonlyArray<RealVoiceSource> = [
  {
    // The reading T226's transcription spike used.
    id: 'romandourou',
    item: 'romandourou_1212_librivox',
    file: 'romandourou_01_dazai_64kb.mp3',
    sha1: 'e5c760b78449af3120e7f8090e9ae87fa03bfd8d',
    title: 'ろまん燈籠 (Roman Dourou), part 1',
    author: '太宰治 (Osamu Dazai)',
    reader: 'ekzemplaro',
    licence: 'CC0 1.0',
    licenceUrl: cc0,
    fromSeconds: 30.28,
    toSeconds: 89.8,
  },
  {
    id: 'gongitsune',
    item: 'gongitsune_um_librivox',
    file: 'gongitsune_01_niimi_64kb.mp3',
    sha1: 'a187a4cf898fe553ffcb6377fbfe381a2ef33809',
    title: 'ごん狐 (Gongitsune), part 1',
    author: '新美南吉 (Nankichi Niimi)',
    reader: 'ekzemplaro',
    licence: 'CC0 1.0',
    licenceUrl: cc0,
    fromSeconds: 29.75,
    toSeconds: 58.98,
  },
  {
    id: 'good-bye',
    item: 'good-bye_um_librivox',
    file: 'goodbye_01_dazai_64kb.mp3',
    sha1: 'b911f120ef10c05e44fe45b65ceaa0e3a8e0887a',
    title: 'グッド・バイ (Good-Bye), part 1',
    author: '太宰治 (Osamu Dazai)',
    reader: 'ekzemplaro',
    licence: 'CC0 1.0',
    licenceUrl: cc0,
    fromSeconds: 28.55,
    toSeconds: 57.35,
  },
]

export const realVoiceUrl = (source: RealVoiceSource): string =>
  `https://archive.org/download/${source.item}/${source.file}`

export type RealVoiceLabels = Readonly<
  Omit<RealVoiceSource, 'fromSeconds' | 'toSeconds'> & {
    url: string
    itemUrl: string
    sampleRate: number
    samples: number
    durationSeconds: number
    // Where the clip sits in the decoded file, in samples at its rate.
    fromSample: number
    toSample: number
    decoder: string
  }
>

export const roomNoise = {
  id: 'classroom',
  title: 'Geräusche aus einem Chemie-Lehrsaal 20240827 C1003.wav',
  page: 'https://commons.wikimedia.org/wiki/File:Ger%C3%A4usche_aus_einem_Chemie-Lehrsaal_20240827_C1003.wav',
  url: 'https://upload.wikimedia.org/wikipedia/commons/f/f8/Ger%C3%A4usche_aus_einem_Chemie-Lehrsaal_20240827_C1003.wav',
  sha1: 'e1233ff29bd8b8fa4c342016744e10c5a0c949b6',
  author: 'PantheraLeo1359531',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  description:
    'A chemistry classroom: a noisy ceiling light and, probably, the ventilation.',
  changes:
    'Mixed from stereo to mono and resampled from 48 kHz to 24 kHz; mixed under the VOICEVOX fixtures at 20 dB below their speech.',
} as const
