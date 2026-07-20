# Musicplayer

Full-screen production player and catalog for music productions, edits, extended mixes, and works in progress.

## Run locally

```sh
npm install
npm run dev
```

## Add music

Drop audio files into `public/assets/audio`, then regenerate the catalog:

```sh
npm run catalog
```

The app also regenerates `src/audioData.json` before `dev` and `build`.

## Cover art

Add cover images to `public/assets/covers` using the same base name as the track:

```txt
public/assets/audio/Stellar Pulse.mp3
public/assets/covers/Stellar Pulse.webp
```

## Google Flow

Google Flow Music supports publishing/sharing songs and downloading them. For direct in-app playback, `src/flowCatalog.json` needs a direct audio URL in `src`, not a Google Flow share page URL.

Use `flowUrl` for the human-facing Google Flow page, and `src` for the streamable audio file:

```json
[
  {
    "title": "Stellar Pulse",
    "src": "https://example.com/Stellar%20Pulse.mp3",
    "cover": "https://example.com/Stellar%20Pulse.webp",
    "flowUrl": "https://labs.google/fx/tools/flow/...",
    "bpm": 124,
    "key": "A minor"
  }
]
```

If Google Flow only gives you a share page, download the audio and cover art from Flow, or host the exported file somewhere that returns an actual audio file URL.

## Metadata

Generated track data can be refined in `src/catalogOverrides.json`.

```json
{
  "Stellar Pulse.mp3": {
    "mix": "Vocal Version",
    "duration": "4:12",
    "bpm": 124,
    "key": "A minor"
  }
}
```
