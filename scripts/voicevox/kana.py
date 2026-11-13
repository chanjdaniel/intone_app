"""Japanese text read as katakana by OpenJTalk, for scripts/transcription-study.ts.

Run with the virtual environment's Python, which scripts/voicevox/setup.sh
makes. The first argument is OpenJTalk's dictionary directory, as VOICEVOX's
downloader wrote it (dict/open_jtalk_dic_utf_8-1.11). stdin is one JSON array
of texts; stdout is one JSON array of their readings, each the katakana of
its morae as OpenJTalk says them (は as ワ), so a word's written form does not
count, only how it is said. A text OpenJTalk reads nothing of reads as "".
"""

import json
import sys

from voicevox_core.blocking import OpenJtalk


def main():
    reader = OpenJtalk(sys.argv[1])
    texts = json.load(sys.stdin)
    readings = []
    for text in texts:
        phrases = reader.analyze(text) if text.strip() else []
        readings.append("".join(mora.text for phrase in phrases for mora in phrase.moras))
    json.dump(readings, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
