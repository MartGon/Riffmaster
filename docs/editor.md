# Tab editor

Built 15 November 2026. Edits the tablature of guitar and bass tracks, in the browser,
with undo, and saves the result as a Guitar Pro file in the library.

## Using it

- Open a song and press **Edit** in the bottom bar. A box marks the cursor: one string of
  one beat. Click or tap the tab to move it there.
- To start from nothing, use **New tab** in the library: title, instrument (6- or
  7-string guitar, 4- or 5-string bass), tempo, time signature and number of bars.
- **Save** (or Ctrl+S) writes the song back to the library. The file the song had before
  its first edit is kept: **More → Restore the original file** brings it back.
- **More** also has song details (title, artist, tempo), track details (name, tuning,
  capo), adding and deleting tracks, and downloading the song as a `.gp` file.
- Leaving the song with unsaved edits asks whether to save them. Closing the browser tab
  shows the browser's own warning.

### Keyboard

| Keys | Action |
|---|---|
| 0–9 | Fret on the cursor's string. Two digits typed within a second make 10–24 |
| ← → | Previous / next beat. Past the end of an unfinished bar a rest is added; past the last bar a new bar is added, as in Guitar Pro |
| ↑ ↓ | Higher / lower string |
| Ctrl ← → | Previous / next bar |
| Home, End | First / last beat of the bar |
| Delete, Backspace | Delete the note; with Shift, delete the whole beat |
| I or Insert | Insert a rest before the cursor |
| R | Turn the beat into a rest |
| + − | Longer / shorter note (applies to the beat and to new notes) |
| . / | Dotted / triplet |
| H S B V T P L X G A | Hammer-on or pull-off, slide, bend (½, full, off), vibrato, tie, palm mute, let ring, dead note, ghost note, accent |
| Ctrl Z, Ctrl Y | Undo, redo |
| Ctrl C, Ctrl V | Copy the selected bars (drag over the tab to select) or the cursor's bar; paste over the bars from the cursor on |
| Ctrl S | Save |
| Space | Play / pause |

Every action also has a button in the editor panel. On a touch screen a number pad with
arrow keys is shown; it can be switched on elsewhere with **Keypad**.

The bar buttons insert or delete bars in every track, set the time signature (from this
bar up to the next change), repeat signs and section names. **Fill** completes a bar that
is too short with rests. The status line says when a bar is too short or too long.

## How it works

Each change edits alphaTab's song model, converts it to alphaTab's serialized form, and
builds a fresh song from that, which the player then shows. Rebuilding lets alphaTab
recompute everything that depends on the notes (ties, slides, beams, timing, playback)
the same way as when a file is opened. Undo keeps only the parts that changed: the edited bar and the bars around it (a tie can
reach three bars ahead, and alphaTab adjusts slides, hammer-ons and ties next to a change
when it rebuilds), or the inserted and removed bars with four bars on each side in every
track. Long sessions therefore stay small (about 11 MB after 150 edits on the test song).

Only the changed part of the page is laid out again. On the 128-bar, 9-track test song an
edit appears in under 200 ms in a headless browser.

## Limits

- **Only the first voice** of a bar can be edited. Notes in other voices are kept and
  shown, but the cursor does not reach them.
- **Drums and tracks without tablature** cannot be edited.
- **Tunings** can be changed but not the number of strings.
- **Not in the editor yet:** chords by name, harmonics, tremolo picking, tempo changes
  within the song, alternate endings, lyrics, key signatures, grace notes as new input,
  release bends, and anything about standard notation layout.
- A hammer-on, slide or tie needs its other note to exist; the editor explains this
  instead of setting a technique alphaTab would drop.
- **Slurs** from MusicXML files are lost when such a song is edited.
- Saving writes a Guitar Pro 7 file, whatever the original format was. For the test file
  every note, duration, tie, slide and legato mark survives the conversion; layout details
  specific to Guitar Pro (page setup, some styles) may not.
- Editing stops playback; the position and a looped selection are kept.
- **Adding a track** needs two free MIDI channels. The test song already uses all 16, so
  a track can only be added there after deleting one.
- In a bar that is not full, → adds a rest, as in Guitar Pro. To leave a short bar (a
  pickup, say) as it is, use Ctrl+→.
- Undo keeps the last 200 steps.
- **Practice history** refers to bar numbers. After bars are inserted or deleted, older
  takes point at the old numbers.
- Not tried in Guitar Pro itself: whether Guitar Pro opens the saved files without
  complaint is unverified.
