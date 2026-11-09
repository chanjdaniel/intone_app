"""VOICEVOX CORE behind one JSON request per line, for scripts/voice-fixtures.ts.

Run with the virtual environment's Python, which scripts/voicevox/setup.sh
makes. The first argument is the directory VOICEVOX's downloader wrote
(onnxruntime/, dict/, models/vvms/). Each line on stdin is one request:

    {"query": "<kana>", "style": 2, "model": "0.vvm"}
        -> {"query": <the AudioQuery as a JSON object>}
    {"synthesise": <AudioQuery>, "style": 2, "model": "0.vvm", "out": "<path>"}
        -> {"wrote": "<path>"}

and each line on stdout its answer, in order. Every query edit is the
caller's: this file only turns kana into a query and a query into a WAV.
It runs on one CPU thread, so the same query gives the same bytes.
"""

import dataclasses
import json
import sys
from pathlib import Path

from voicevox_core import AccentPhrase, AudioQuery, Mora
from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile


def mora_of(fields):
    return Mora(**fields)


def query_of(fields):
    phrases = [
        AccentPhrase(
            moras=[mora_of(mora) for mora in phrase["moras"]],
            accent=phrase["accent"],
            pause_mora=None if phrase["pause_mora"] is None else mora_of(phrase["pause_mora"]),
            is_interrogative=phrase["is_interrogative"],
        )
        for phrase in fields["accent_phrases"]
    ]
    rest = {key: value for key, value in fields.items() if key not in ("accent_phrases", "kana")}
    return AudioQuery(accent_phrases=phrases, **rest)


def main():
    root = Path(sys.argv[1])
    library = next((root / "onnxruntime" / "lib").glob("libvoicevox_onnxruntime.so.*"))
    onnxruntime = Onnxruntime.load_once(filename=str(library))
    dictionary = next((root / "dict").glob("open_jtalk_dic_utf_8-*"))
    synthesizer = Synthesizer(
        onnxruntime, OpenJtalk(dictionary), acceleration_mode="CPU", cpu_num_threads=1
    )
    loaded = set()

    def load(model):
        if model not in loaded:
            with VoiceModelFile.open(root / "models" / "vvms" / model) as file:
                synthesizer.load_voice_model(file)
            loaded.add(model)

    for line in sys.stdin:
        request = json.loads(line)
        load(request["model"])
        if "query" in request:
            query = synthesizer.create_audio_query_from_kana(request["query"], request["style"])
            fields = dataclasses.asdict(query)
            fields.pop("kana", None)
            answer = {"query": fields}
        else:
            wav = synthesizer.synthesis(query_of(request["synthesise"]), request["style"])
            Path(request["out"]).write_bytes(wav)
            answer = {"wrote": request["out"]}
        sys.stdout.write(json.dumps(answer, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
