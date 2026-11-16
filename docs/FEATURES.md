# Recommended features

Extras recommended on 14 November 2026, beyond the agreed milestones, with their status
as of 15 November 2026. The numbering is the one used in the conversation. The tab
editor, a milestone rather than an extra, is described in [editor.md](editor.md).

| # | Feature | Status |
|---|---|---|
| 1 | Hosted deploy with HTTPS | Not done; needs a hosting account ([TODO.md](TODO.md), action 3) |
| 2 | Practice history per song | Built |
| 3 | Speed trainer | Built |
| 4 | Tuner | Built |
| 5 | Live feedback during a take | Built |
| 6 | Fretboard view | Built |
| 7 | Section markers | Built |
| 8 | More import formats | Accepted by the file picker, never tested |
| 9 | Backing-track mix presets | Not done |
| 10 | Fingering recommender | Built (16 Nov): [fingering-recommender.md](fingering-recommender.md) |
| 11 | Built-in exercises | Built (16 Nov), not reviewed by a second agent: [exercises.md](exercises.md) |

"Built" means implemented, unit-tested, checked in a headless browser and reviewed by a
second agent. It does not mean tried by a person with a guitar.

## Built

### 2. Practice history per song

- Every practice take with at least four scored notes, of which at least one was heard, is
  saved with its date, track, tempo, bars covered and results per bar.
- The practice panel has a **History** button for the shown track: a trend of accuracy
  over the last 20 takes, a table of the last five, and **Bars to work on**, the up to
  three bars that went wrong most in the last five takes. Clicking one loops that bar.
- The library list shows the number of takes and the best accuracy per song.
- **Clear history** removes the takes of the shown track. Removing a song removes its takes.

### 3. Speed trainer

- Tick **Speed trainer** in the practice panel, lower the tempo, select the bars to repeat
  (or loop a section), and press **Start practice**.
- Each round plays the selection once with a count-in. If the share of notes played
  reaches the target (80, 90, 95 or 100 %), the tempo rises by the chosen step (5 or 10 %).
  Otherwise the same tempo is repeated.
- It finishes when a round is passed at the written tempo, or when stopped.
- Without a selection, one round is the whole song.

### 4. Tuner

- **Tuner** in the transport bar. It shows the string being tuned, how many cents off it
  is, and which way to turn, in words as well as on a gauge.
- The strings shown are those of the track on screen, so a bass or an alternate tuning
  gets its own targets. A note more than about three semitones from every string is named
  as a plain note.
- Opening it pauses the song and closes the practice panel, since both use the microphone.

### 5. Live feedback during a take

- While a take runs, each note gets a small mark about half a second after it is due: a
  dot for on time, an arrow pointing left for early, right for late, a cross for missed.
- The shapes mean results no longer depend on colour alone, and the colours were darkened
  to meet contrast on the light theme.
- Marks start once the delay has been worked out, and may change in the first seconds of a
  take while that estimate settles.
- **Mark notes while playing** switches the live marks off; results still appear at the end.

### 6. Fretboard view

- **Fretboard** in the transport bar shows a neck for the track on screen: filled dots for
  the notes sounding now, labelled with the note name, and dashed rings for the next ones.
- It follows playback, and the position while paused. It shows the capo, adapts the number
  of frets to the track, and has four strings for a bass.

### 7. Section markers

- Sections marked in the file ("Intro", "Verse 1", …) are listed under the tracks.
- Clicking a name jumps there. The loop button beside it selects the section and turns
  looping on. The section being played is highlighted.

## Not built

### 1. Hosted deploy with HTTPS

Needed before any phone testing, because the iPhone only allows microphone use on HTTPS
pages. A static host is enough until sync exists.

### 8. More import formats

The file picker accepts Guitar Pro 3 to 8, MusicXML and Capella, because the underlying
library reads them. Only one `.gp` file has ever been opened. Worth a pass with a handful
of real files in each format before relying on it.

### 9. Backing-track mix presets

One tap for "mute my track" or "drums and bass only", instead of setting mute and solo by
hand on each track.

### 10. Fingering recommender

Suggests which fretting-hand finger plays each note, as numbers in the tab and on the
fretboard. Built on 16 November 2026; what it does, its limits and the research behind it
are in [fingering-recommender.md](fingering-recommender.md).

## Further ideas that came up while building

- **Left-handed fretboard**, mirrored.
- **Tuner reference pitch** other than A = 440 Hz, and its own input selector.
- **Trainer beyond the written tempo**, and a trainer goal other than 100 %.
- **Current-section name in the transport bar** on phones, where the sidebar is hidden.
- **Handling an unplugged input** during a session.
