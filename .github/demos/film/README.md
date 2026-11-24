# The demo film (`.github/assets/agentphoto-demo.mp4`)

Working copies of the scripts that built the film and its poster (`video-poster.jpg`). They ran in `/tmp/ap-film` (hard-coded paths; `REPO` = this repository), like Agent3D's film:

- `tts.py` + `lines.json`: the narration, Kokoro TTS (`kokoro-onnx`, voice `af_heart`, speed 0.95, model files `kokoro-v1.0.onnx` / `voices-v1.0.bin` from the kokoro-onnx releases) with an IPA dictionary for names and acronyms. Run with `uv run --python 3.12 --with kokoro-onnx --with soundfile python tts.py <model> <voices> lines.json wav`.
- `cards.html`, `poster.html`: title, export and end cards, subtitles, chips and the poster, rendered with headless Chrome by `rec.mjs` + `shots.mjs` / `poster.mjs`.
- `studio-ap.mjs`: the Studio footage (published `agentphoto studio` on a `youtube-thumbnail` project, `?lang=en`, a drawn cursor, CDP screencast).
- `clips.sh`: before / after wipes and slow push-ins on the showcase stills.
- `build.py`: the segment plan, then `assets`, `segments`, `final` (1920×1080, H.264 + AAC, faststart). The three agent sessions are the recordings in `../sessions/`.
