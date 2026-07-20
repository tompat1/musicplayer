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
