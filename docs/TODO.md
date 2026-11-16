# What is left

Status as of 16 November 2026. See [FEATURES.md](FEATURES.md) for the recommended
extras and their status, [editor.md](editor.md) for the tab editor,
[fingering-recommender.md](fingering-recommender.md) for the suggested fretting-hand
fingers, [exercises.md](exercises.md) for the built-in exercises and
[sounds.md](sounds.md) for the instrument sounds.

## What exists today

| Area | State |
|---|---|
| Player: open Guitar Pro files, play, tempo, loop, tracks, metronome, count-in | Built |
| Library saved in the browser, offline use, installable | Built |
| Practice mode for single notes, automatic and measured delay | Built |
| Sections, fretboard, tuner, live marks, practice history, speed trainer | Built (15 Nov) |
| Looped practice, practice from the cursor, timing leeway, volume mixer, phone over HTTPS | Built (15 Nov), see [not-working.md](not-working.md) |
| Tab editor: edit tabs, new blank tabs, undo, save as Guitar Pro, restore the original | Built (15 Nov) |
| Suggested fretting-hand fingers, in the tab and on the fretboard | Built (16 Nov), see [fingering-recommender.md](fingering-recommender.md) |
| Built-in exercises: scales, finger exercises, arpeggios, chord changes | Built (16 Nov), see [exercises.md](exercises.md) |
| Fuller instrument sounds (GeneralUser GS) | Wired in (16 Nov), see [sounds.md](sounds.md) |

All of it has been tested in a headless browser with a synthesized guitar as the
microphone. **None of it has been heard by a person or tried with a real instrument.**

## Actions for you

These cannot be done by the assistant.

1. **Test with a real guitar on the desktop.** Run `npm run dev` in the project folder and
   open the address it prints. The questions that matter most:
   - Does playback sound right, including metronome and count-in?
   - Does practice mode recognise your playing, especially arpeggios with ringing strings?
   - Does "Measure delay" give a sensible number with an earbud held to the microphone?
     This mode has never been run end to end.
   - Does the tuner agree with a tuner you trust?
   - Are the live marks readable while you play, or distracting? They can be switched off.
   - Are the suggested fingers (the **Fingering** button) what you would play? Songs you
     know well are the best test; say where they are wrong.
   - Are the built-in exercises (the **Exercises** button in the library) the shapes you
     would expect, and is anything missing from the list?
   - Do the new instrument sounds sound better, and do they load quickly enough?
   - Does the editor feel right for writing a riff? See [editor.md](editor.md) for the keys.
     Worth checking: whether a saved song opens in Guitar Pro or TuxGuitar.
2. **Decide on the sync backend and create the account.** Sync between desktop and phone
   needs a hosted database with sign-in. Supabase was suggested and is not yet confirmed.
   Once you agree: create a Supabase project, then share the project URL and the public
   ("anon") key. The service key must never go into the app.
3. **Decide where to host the app.** The iPhone only allows microphone use over HTTPS.
   On your own network this now works without hosting: see [phone.md](phone.md). Away
   from home it needs a deploy (a static host is enough until sync exists).
4. **Test on the iPhone** once it is reachable over HTTPS: microphone with wired and with
   Bluetooth headphones, and installing it to the home screen.
5. **Push to GitHub** when you want to; nothing has been pushed. `samples/` is ignored by
   git on purpose, because the test tab is copyrighted.
6. **Choose a public name** before any public release.
7. **Decide the order of the remaining milestones** (chord practice, sync, editor
   extensions).

## Milestones not started

1. **Sync between desktop and phone.** Blocked on actions 2 and 3. The library already
   stores what merging needs (change times, deletion markers, takes that are only added or
   removed whole). Audio input and delay settings stay per device.
2. **Chord practice.** Chords are currently skipped when scoring.
3. **TuxGuitar `.tg` import.** Last priority and optional.

Possible editor extensions, none started: editing the second voice, chords by name,
harmonics and other techniques, tempo changes and alternate endings, changing the
number of strings.

## Known defects and limits

Practice detection, found in testing with synthesized sound:

- A note 15–20 dB quieter than the one before it is often not heard.
- Same-note tremolo at about 180 bpm and above, and low bass notes, are detected less
  reliably.
- A line that repeats one pitch at a steady rate has an ambiguous delay on a first-ever
  take; it resolves once one ordinary take has been remembered.
- Delays above 800 ms are not supported, which could matter for some Bluetooth headphones.
- Unplugging the input device during a session is not handled.

New features:

- **Speed trainer:** the tempo it reaches is saved as the song's tempo, so the song reopens
  there. It stops at the written tempo and cannot go beyond it.
- **Speed trainer and history:** a round in which nothing at all is heard is not recorded.
- **Tuner:** a very quiet string reads as silence. The reference pitch is fixed at
  A = 440 Hz. It uses the input chosen in the practice panel and has no input selector of
  its own.
- **Fretboard:** right-handed view only. Bends, slides and other techniques are not shown.
- **Sections:** only files that contain section markers show the list.
- **Upgrade:** if a browser tab with the previous version is still open, the new version
  waits and shows a message asking to close it.
- **Editor:** first voice only; no drums; editing stops playback; practice history keeps
  old bar numbers after bars are inserted or deleted; slurs from MusicXML are dropped.
  The full list is in [editor.md](editor.md).

Not verified at all:

- Audible sound, a real guitar, a real microphone or audio interface.
- iOS Safari, Android, and Bluetooth audio routing.
- "Measure delay" end to end.
- A screen reader.
- Takes over a whole song (tests used sections of up to 26 seconds).
- Saved songs opened in Guitar Pro or TuxGuitar.
- Tab files other than the one test file. Other formats the player accepts (`.gp3`–`.gpx`,
  MusicXML, Capella) have not been opened once.

Housekeeping:

- `npm audit` reports 6 low or moderate issues, all in build-time dependencies of the
  offline plugin. Fixing them needs a downgrade of that plugin.
- The browser checks in `e2e/` are run by hand; there is no continuous integration.
