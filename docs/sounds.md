# Instrument sounds

Playback uses alphaTab's built-in synthesizer, which plays samples from a sound bank
(a SoundFont file). Which bank is used is decided when the dev server starts or the app
is built ([vite.config.ts](../vite.config.ts)).

| Bank | Size | When it is used |
|---|---|---|
| GeneralUser GS 2.0.3 | 32 MB | When `public/sounds/GeneralUser-GS.sf2` exists |
| Sonivox (comes with alphaTab) | 1 MB | Otherwise |

## Getting the larger bank

```
npm run sounds:setup
```

This downloads the file into `public/sounds/`, which is not kept in git, so it has to be
run once on every checkout. Restart the dev server or build again afterwards. To go back
to the small bank, remove `public/sounds/` and restart.

## What was measured (16 November 2026)

On the test song, in a headless browser on the development computer:

- The player was ready 1.3 seconds after the song was opened.
- The page used about 100 MB of memory while playing.
- The full mix is about 4 dB quieter than with Sonivox and clips far less (4 samples
  against 515 in 30 seconds of the chorus).
- The built app stores the bank for offline use (34 MB in total).

Not checked: how it sounds, and load time and memory on an iPhone. Nobody has listened
to it yet.

## When the download fails

A 32 MB download can fail. It did on a first visit to the built app, where the page and
the offline store fetched the bank at the same time. Two things guard against that:

- The offline store (the service worker) now starts only once the sounds have loaded
  (`src/lib/offline.ts`), so the two downloads no longer overlap.
- If the bank still fails to load, the player tries once more, then falls back to the
  small Sonivox bank. Only if that fails too does it say that the sounds could not be
  loaded.

## Licence

GeneralUser GS is by S. Christian Collins and may be used and redistributed freely; the
licence is downloaded next to the file. The author asks that sites host their own copy
and not link to his download.
