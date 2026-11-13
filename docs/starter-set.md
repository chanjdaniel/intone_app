# The starter set

The starter set is the lines the app brings with it, so there is something to practise with no upload: about fifty lines in six levels, one per Tokyo accent pattern and then pairs and phrases, as the 2023 slides' lessons ran, from single words with their particle to short phrases.
Every recording is openly licensed and credited; none is from JSUT, OJAD, Suzuki-kun, Kanjium or YouTube.
Each line is marked unreviewed until a native speaker has heard it (ticket 25), on the review page this ticket builds.
`AGENTS.md`, "The starter set", says where the code is.

## What is in it

| Level     | Lines | What it practises                                                                                                         |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| Heiban    | 6     | 水が, 鳥が (2 morae), 桜が, 名前が (3), 学校が, 友達が (4): low, then high to the end, the particle too                   |
| Atamadaka | 6     | 猫が, 秋が, 命が, 緑が, 経済が, 玄関が: high on the first mora, low after                                                 |
| Nakadaka  | 4     | 昨日が, 一人が (3 morae), 湖が, 先生が (4): a fall inside the word; no word of two morae can have one                     |
| Odaka     | 6     | 山が, 犬が, 男が, 休みが, 弟が, 妹が: flat on its own, the fall onto the particle                                         |
| Pairs     | 15    | 雨が好き and 飴が好き; 橋が, 箸が and 端が; 花が and 鼻が; 柿が and 牡蠣が; 神が and 紙が; 酒が and 鮭が; 雲が and 蜘蛛が |
| Phrases   | 12    | A noun and its particle, then a verb in its ます form: 橋を渡ります, 時計が動きます, 薬を飲みます and nine more           |

The list starts from the six examples of the slides, marked `seed` in `starter/lines.json`: 学校が, 猫が, 昨日が, 弟が, and 雨が好き against 飴が好き.
Each sits in its pattern's level, in its place by length, rather than first, so a level runs from two morae to four.

## Where the recordings come from

The source each recording may come from, in the order the plan prefers them: Lingua Libre and other Wikimedia Commons files under CC0, CC BY or CC BY-SA, read per file from Commons' own licence metadata; LibriVox's CC0 or public-domain readings; and VOICEVOX under the recorded terms of a voice, as the last choice.
`src/services/starter-records.ts` holds that list as Schemas, so a recording outside it does not decode, and `tests/build/starter-licences.test.ts` fails on one.

- **The phrases** are Lingua Libre recordings on Commons, by its speakers Zsrtrgh (CC0) and Fukujinzuke (CC BY 4.0) in turn, whose files carry those licences in Commons' metadata; where both recorded a phrase, one is used.
  Lingua Libre's metadata does not say whether a speaker is native; ticket 25's review is where that is heard.
- **The words with their particle** are VOICEVOX, in 冥鳴ひまり and 玄野武宏, line by line in turn, because no Commons file holds a word followed by its particle: all 5,236 files of Lingua Libre's Japanese category and the 248 of "Japanese pronunciation" were read by title on 2026-11-13, and they are words alone or sentences.
  A word alone cannot be the line: an odaka word sounds as heiban until its particle falls, which is why the slides teach every word with its particle.
  Each is synthesised by VOICEVOX CORE 0.17.1 with its pitch set mora by mora from the stated accent, as the labelled fixtures are (`fixtures/README.md`), so the recording follows the list, and a corrected accent is synthesised again.
- **LibriVox** is not used: its readings are literary sentences of several seconds by one reader, too long for a starter line, and the cut study (`docs/cut-study.md`) shows them already in the tests.

Each recording is mixed to mono and written as 16-bit PCM at 24 kHz: VOICEVOX's own rate, and half the 48 kHz of the Lingua Libre files.
A CC BY-SA recording, resampled, stays under CC BY-SA; the set holds none today, and the credit says so of any that joins it.

## The accent types

Each word's accent type is checked against two sources, written into `starter/lines.json` by `npm run starter:pack -- --accents`:

- **UniDic** 2023.02 (現代書き言葉UniDic for MeCab), used under its BSD licence: its compiled lexicon, `sys.dic`, fetched once into the git-ignored `.cache/unidic/` from NINJAL at a pinned size and SHA-256, and its `aType` read for each entry written as the word is, read as its kana, in its base form, and not a proper name.
  UniDic 2.1.2, the smaller older release, carries no `aType`.
- **Wiktionary**, the English one, under CC BY-SA 4.0: each word's `{{ja-pron}}` in its Japanese section, every accent it lists for the word's reading but one given for a place (`acc2_loc=Osaka`).

A word whose two sources do not both give its stated type alone is flagged in the list, the flag saying what each gives; the review page shows it, and `CREDITS.md` and `/credits` credit both sources.
No dictionary ships in the app: only the stated type of each word is in the pack.
A ます form is stated by its rule, falling on its ま whatever the verb's own accent, and is not looked up.

The flagged lines on 2026-11-13:

| Line             | Flag                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------- |
| 桜が             | 桜 (さくら): UniDic gives 0, Wiktionary gives 0 and 1; the list states 0.             |
| 昨日が           | 昨日 (きのう): UniDic gives 2 and 0, Wiktionary gives 2 and 0; the list states 2.     |
| 休みが           | 休み (やすみ): UniDic gives 3 and 2, Wiktionary gives 3; the list states 3.           |
| 雨が好き         | 好き (すき): UniDic gives 2 and 1, Wiktionary gives 2; the list states 2.             |
| 飴が好き         | 好き (すき): UniDic gives 2 and 1, Wiktionary gives 2; the list states 2.             |
| 電車に乗ります   | 電車 (でんしゃ): UniDic gives 0 and 1, Wiktionary gives 0 and 1; the list states 0.   |
| お祭りがあります | お祭り (おまつり): UniDic has no entry for it, Wiktionary gives 0; the list states 0. |

雲 and 蜘蛛 are both atamadaka in Tokyo in both sources, so they are no minimal pair there, as the report supposed, and no flag says so, since each source agrees with the list; their lines carry a note instead, and stay as a pair the review can keep, reject or note, since Kansai tells them apart.
休み's and 好き's second UniDic type is the verb's (休む, 好く), read as the same kana; the flag says so plainly enough for the review to judge.

## The pack

`npm run starter:pack` (`scripts/starter-pack.ts`) writes, from `starter/lines.json`, the same bytes every run:

- `starter/pack/levels.json`, the levels and lines the app imports (`StarterPack`), each line with its text, kana, morae, accent type and particle, its words, its flag, its file's length and SHA-256, its credit and its review;
- `starter/pack/audio/<line>.wav`, each line's file;
- `CREDITS.md`, written whole, crediting each recording as its licence asks.

A line's file is made only when what it is made from changes, its `made` key: a Commons file downloaded at its pinned URL into `.cache/starter/` and checked by size and SHA-256, or a VOICEVOX line synthesised, which needs VOICEVOX CORE (`npm run fixtures:voices-setup`, whose terms prompt is Daniel's to answer).
`--check` writes nothing and fails while the pack or `CREDITS.md` is not what the list makes; `tests/scripts/starter-pack.test.ts` runs it in CI, with no network and no VOICEVOX, and remakes every file byte for byte where both are at hand.

## In the app

- `src/app/line/starter.ts` decodes the pack when the app loads and gives each line's file its address; `src/app/line/lines.ts` makes each level a bundled clip, so its lines are copied, starred and brought back like the first bundled line's.
- Home lists the six levels under "The starter set"; each level says what it practises and, until the review, that its lines are not yet checked by a native speaker; each practice screen's footer credits its recording and says the same.
- `/credits` names each recording's author, its source page and its licence, read from the pack.
- Each file reaches the app through Vite's asset handling, as `/assets/<line>-<hash>.wav`, which both servers keep for good (`public, max-age=31536000, immutable`, `build/headers.ts`); only its address is in the entry chunk, and the browser fetches the file when its line opens.
  `tests/build/production-build.test.ts` checks every audio file the build carries is a credited one under such a path, and in no JavaScript chunk.

The bundled audio is 49 files, 2,906,220 B in all (2.9 MB, about 59 KB a line), measured on `starter/pack/audio/` on 2026-11-13; a line downloads only its own file when it opens.

## Adding, replacing or dropping a line

1. Edit `starter/lines.json`.
   A new line needs a unique `id`, never changed once it ships, since takes are kept by it; its `level`; its `text` and `kana`, which its `words` must make, each word with its `accentType` and its `particle`; a `recording`; and `"review": { "verdict": "unreviewed" }`.
   A Commons recording is named by its `file` title alone; a VOICEVOX one by its `voice`.
2. For a Commons recording, `npm run starter:pack -- --commons` reads its author, licence and URL from Commons and pins its size and SHA-256; a licence outside the list is refused before anything is written.
3. `npm run starter:pack -- --accents` writes what UniDic and Wiktionary give for each word, and the flags.
4. `npm run starter:pack` writes the pack and `CREDITS.md`; commit all of it.

To replace a recording, change the line's `recording` and run steps 2 to 4; to drop a line, delete it from the list and run step 4, which deletes its file.
Commons slows a client that asks too fast: the script waits as long as it is told to.

## The review

`/review` is the native speaker's page (ticket 25), reached only by its address, in the local production build at `http://localhost:4300/review`; nothing in the app links to it.
It plays each line, shows its text, kana, morae, stated accent and any flag, and takes a verdict: accept, reject, or another accent, chosen from the word's possible types, each with a note.
The reviewer's name is asked only to be credited by it, which they must agree to in writing first.
Each verdict is kept in the browser's storage on that device as it is given, so the review can stop and go on; "Save the verdicts as a file" saves them as one file, `intone-starter-review-<date>.json`, in the shape `ReviewExport` decodes:

```json
{
  "reviewedOn": "2026-12-01",
  "verdicts": [
    { "lineId": "neko-ga", "verdict": "accept" },
    {
      "lineId": "ame-candy-ga-suki",
      "verdict": "correct",
      "accentType": 0,
      "note": "..."
    },
    { "lineId": "kumo-spider-ga", "verdict": "reject" }
  ]
}
```

To apply it: `npm run starter:pack -- --apply <file>`.
It writes each verdict into its line's `review`, a changed accent as the first word's type with the one before it kept as `statedBefore`, then writes the pack: a rejected line leaves the pack and its file is deleted, a VOICEVOX line with a changed accent is synthesised again, and each line's mark changes from "Not yet checked by a native speaker" to "Checked by a native speaker on <date>".
An export that names a line the list has not is refused whole.
Then commit the list, the pack and `CREDITS.md`, and delete the export file, which holds nothing that is not now in the list.
