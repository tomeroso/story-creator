# Story Creator

A local-first, faceless-content video generator: paste a story, generate real narration entirely in your browser (no cloud TTS, no API keys), pick a background video, and render a captioned vertical MP4 — all client-side.

This is the **Story Creator MVP** slice of a larger planned tool (Story Creator + Clip Creator). It implements the full working pipeline end to end; everything else (Reddit URL import, local transcription, Clip Creator, presets, effects) is designed to layer on top without rework — see "Architecture & extension points" below.

## What actually works right now

- Paste or type a story, clean it (formatting-only, meaning-preserving) and split it into narration segments
- Manually edit, reorder, merge, split, add, delete segments at any time — the workflow is never locked behind AI
- Generate **real, exportable narration audio** locally using [Kokoro TTS](https://github.com/hexgrad/kokoro) (`kokoro-js`), running fully offline in a Web Worker after a one-time model download (~80MB, cached)
- Upload your own background video (MP4/WebM/MOV)
- **Fast local rendering via WebCodecs** (Chrome/Edge, recent Firefox/Safari): the browser's native video encoder — hardware-accelerated when your GPU has an H.264 encoder — cover-crops the background to 9:16, draws word-by-word highlighted captions, mixes the narration, and writes a real, playable MP4 (H.264 + AAC, or Opus where the browser can't encode AAC). The background file is read lazily, so even multi-hour, multi-gigabyte gameplay files work. The Render section tells you up front whether a hardware encoder was detected, and shows a live "time left" estimate while rendering.
- **Fallback engine**: browsers without WebCodecs fall back to FFmpeg.wasm (much slower, per-segment captions).
- **Draft/Final quality toggle**: Draft renders 720×1280 for quick checks; Final renders 1080×1920.
- **Cancel** stops a render immediately.
- Download the finished MP4
- Projects persist locally in IndexedDB (Projects tab)
- **Media library** (Media tab): upload gameplay/background videos once, reuse them across projects, delete them — stored locally in IndexedDB
- **Random clip selection with reroll**: picking a background video (upload, or "Use as background" from Media) automatically selects a random clip matching your current narration length instead of always starting at frame 0. A "🎲 Reroll clip" button picks a different random spot from the same video without re-uploading anything.
- Voice-model loading, narration generation, and rendering all run in a pipeline lifted above the screens, so switching to Media/Projects/Settings and back never resets or interrupts them

No login, no database, no required backend, no subscription, no paid API calls anywhere in this workflow.

## Getting started

**Easiest way**: double-click the launcher for your system - `start-windows.bat` (Windows) or `start-mac-linux.command` (Mac/Linux, right-click → Open the first time if macOS warns about an unidentified developer). It installs dependencies on first run and opens the app in your browser automatically. Leave that window open while using the app; closing it stops the app.

**Manual way** (same result, if you prefer a terminal):

```bash
npm install
npm run dev
```

Open the printed local URL. On first "Load voice model" click, the Kokoro model downloads once and is cached by the browser for offline reuse afterward.

## Building

```bash
npm run build
npm run preview   # sanity-check the production build locally
```

## Deploying to Netlify

This repo includes a `netlify.toml` (build command `npm run build`, publish dir `dist`, SPA redirect to `index.html`). Steps:

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Netlify: **Add new site → Import an existing project**, pick the repo. Build settings are read from `netlify.toml` automatically.
3. Deploy. The app is 100% static — Netlify only serves files, it does not render video.

No environment variables or Netlify Functions are required for the Story Creator workflow described above.

### About the large static files

`public/ffmpeg/ffmpeg-core.wasm` (~32MB) and the Kokoro/ONNX runtime WASM (~20MB, bundled from `kokoro-js`) are self-hosted static assets so rendering and narration never depend on a third-party CDN's uptime. They're only downloaded by a visitor's browser once they actually use narration/rendering, and are cached afterward. If you ever run `npm install` again and these files go missing from `public/ffmpeg/`, run:

```bash
npm run sync-ffmpeg
```

(this also runs automatically via `postinstall`).

## Architecture & extension points

```
src/
  features/
    story/            ← Story Creator UI + text/segment logic (this MVP)
    clips/             ← reserved for the future Clip Creator
  services/
    tts/               ← TTSProvider interface; KokoroTTSProvider (real, exportable)
                          and WebSpeechPreviewProvider (instant preview only)
    video/             ← WebCodecs renderer (main), FFmpeg.wasm renderer (fallback), clip selection, encoder detection
    captions/          ← word-timing estimation + caption "card" grouping
    storage/           ← IndexedDB project persistence
    reddit/            ← reserved for the future Reddit URL importer
    transcription/     ← reserved for the future local-Whisper transcription
```

Everything expensive (TTS inference, caption timing, video muxing) is behind small interfaces (`TTSProvider`, the renderer's `RenderOptions`/`RenderProgress` shape) specifically so a paid/cloud provider can be swapped in later as an *optional* upgrade — the local path always keeps working.

### Known limitations of this MVP (by design, not accidental)

- **Caption sync is estimated, not word-accurate.** Kokoro doesn't emit word-level timestamps, so caption timing is distributed proportionally across each segment's real audio duration (weighted by word length). It reads as "reasonably synchronized" but isn't frame-perfect. A local forced-aligner or Whisper-based re-alignment is the natural upgrade — it can slot into `services/captions` without touching the renderer.
- **Reddit URL import is not implemented yet.** Paste-text is the only import path right now; it's the guaranteed fallback the full spec requires, and URL import is designed to sit in `services/reddit/` as an adapter when added.
- **No drag-and-drop segment reordering yet** — up/down buttons work today; drag-and-drop is a UI-only addition on top of the same `reorderSegments` function.
- **Render speed depends on having a hardware video encoder.** Profiling showed decoding, cropping and caption drawing together run at 150–220 fps even on a single slow CPU core — essentially all render time is H.264 encoding. With a hardware encoder (most PCs with Intel, AMD or NVIDIA graphics) that is fast; without one, encoding runs on the CPU. Measured worst case on a 1-vCPU, no-GPU test machine: ~7 fps at 720p and ~4 fps at 1080p on detailed footage. Check `chrome://gpu` → "Video Acceleration Information" → Encoding to see whether your machine has H.264 hardware encoding.
- **Captions in the fallback (FFmpeg.wasm) engine are per-segment**, not word-by-word — chaining one timed caption filter per few words made FFmpeg's filter-graph setup hang with many segments. The WebCodecs engine draws captions on a canvas and doesn't have this problem.
- **The fallback engine loads the whole background file into memory**, so very large sources can be slow or fail there; for sources over ~300MB or ~15 minutes it pre-trims the needed clip first. The WebCodecs engine doesn't have this limitation.
- **Settings tab is a placeholder** — no configuration is needed for the local workflow, so there's nothing to put there yet.

## Tech stack

React 19 + TypeScript + Vite + Tailwind CSS v4, `kokoro-js` (local TTS), `mediabunny` (MP4 read/write on top of the browser's WebCodecs API — the main render engine), `@ffmpeg/ffmpeg` + `@ffmpeg/core` (self-hosted fallback render engine), `idb` (IndexedDB wrapper).
