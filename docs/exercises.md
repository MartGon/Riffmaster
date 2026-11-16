# Built-in exercises

The **Exercises** button in the library opens a list of practice tabs that the app writes
itself. Built on 16 November 2026. Each one opens like a song, so loop, the tempo
control, the speed trainer, practice scoring, the fretboard and suggested fingers all
work on it.

They have been checked by tests and in a headless browser. **Nobody has played them on a
guitar yet**, so the choice of positions and fingerings still needs a guitarist's eye.

## What is there

| Group | Exercise | Choices |
|---|---|---|
| Scales | Minor pentatonic, major pentatonic, blues, major, natural minor | Key (12), position (1 to 5), pattern |
| Finger exercises | Spider: one finger per fret | Starting fret (1 to 9), finger order (all 24) |
| | Spider: across two strings | Starting fret |
| | String skipping | Starting fret |
| | Hammer-ons and pull-offs | Starting fret; fingers (six pairs, or all four) |
| | Position shifts on one string | String |
| Arpeggios and chords | Triad arpeggios | Key; major or minor, root on the 6th or 5th string |
| | Chord changes | Nine four-chord sequences; a change every bar or every two beats |

With every choice counted, that is a little over 1,300 different tabs.

- **Scale patterns:** up and down; in fours (four notes up from each note in turn); and
  skipping a note (thirds, in the seven-note scales).
- **Scale positions:** position 1 starts on the root on the sixth string, or just under
  it in the major scale. The others follow up the neck. Pentatonic and blues positions
  are the five usual boxes. The major and natural minor positions are the five often
  named after the open chords C, A, G, E and D.
- **Where on the neck:** each position is placed as low as it fits, so some use open
  strings. E minor pentatonic position 1 is the open-string one, for example.
- **Tempo:** scales are written in eighth notes at 80 bpm, finger exercises at 60 and
  arpeggios and chords at 70. Change the speed with the tempo control, as for a song.
- **Fingers:** the finger exercises carry their fingers in the file (shown underlined
  when **Fingering** is on). Scales, arpeggios and chords get suggested fingers.
- **Chords:** chord changes show the chord names and diagrams, and are strummed
  downwards. Practice mode does not score chords, so these are for playing along.

## In the library

An exercise is added to the library the first time it is opened, with "Exercise" as its
artist, and keeps its own practice history. Opening the same exercise with the same
choices again opens that entry instead of adding a copy. It can be edited like any tab;
the editor's **Restore original** brings back the written version.

## Limits

- Six-string guitar in standard tuning only: no bass, no other tunings.
- All exercises are in 4/4 with plain note lengths: no triplets and no sixteenth notes.
- No pick-stroke markings (down and up) for alternate picking.
- Scales are written without a key signature, so with notation on, sharps and flats
  appear on the notes themselves.
- The dialog remembers the last exercise only until the page is reloaded.

## For developers

- `src/exercises/theory.ts`: where scales, arpeggios and chords sit on the neck. A scale
  position is the scale note the sixth string starts on plus the number of notes on each
  string; the frets follow from that.
- `src/exercises/catalogue.ts`: the exercises, their choices and titles.
- `src/exercises/build.ts`: turns a list of steps into bars and a Guitar Pro file.
- `src/exercises/exercises.test.ts` checks every scale, key and position (right notes, in
  order, no note left out, at most five frets wide), every arpeggio and chord, and that
  every combination of choices fills its bars.
- `e2e/exercises.mjs` drives the dialog and plays a practice take on an exercise.

Adding an exercise means adding an entry to `EXERCISES` in the catalogue.

## Also fixed along the way

Practice mode left out a note that sat exactly at the playback position: the first note
of a tab that starts on beat one, or of the bar that was jumped to. The player reports
its position one tick later than the one it was given. Takes over selected bars were not
affected.
