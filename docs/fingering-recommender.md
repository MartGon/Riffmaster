# Fingering recommender: research and assessment

Written 15 November 2026. The idea: for each bar, show which fretting-hand finger should
play each note, for example when hovering over the bar.

**Built on 16 November 2026.** The first section says what exists; the rest is the
research it was built from, left as written.

## What was built

Turn on **Fingering** in the bottom row (the hand icon). The choice is remembered on the
device.

- **In the tab**, a small number sits beside each fretted note: 1 is the index finger,
  4 the little finger. Open strings get none. Where notes are too close for the number to
  fit beside the fret number, it goes just under or over it.
- **On the fretboard** (turn on Fretboard as well), the dots show the finger instead of
  the note name, 0 for an open string, also for the notes coming next. A shaded band
  shows the frets the hand is over.
- **Fingers written in the file win.** They are drawn in the text colour and underlined;
  suggestions are in the accent colour. A note the file gives to the thumb shows T.
- It follows the track on show, and edits made in the editor.

What the suggestions take into account:

- One finger per fret within a hand position, with a cost for stretching (more near the
  nut and on a bass) and for moving the hand (less when a rest or open string gives time).
- Chords: fingers rise with the frets, one finger may lie across several strings, and a
  chord shape moved along the neck keeps its fingers.
- Notes that ring on ("let ring", ties, a held bass note under a tune) keep their finger,
  so an arpeggio comes out as the chord it spells.
- Slides keep the finger; a hammer-on or pull-off never uses one finger for both notes;
  bends prefer the ring finger.
- Dead notes, tapped notes and drums get nothing. A chord no hand can hold gets no
  suggestion instead of a guess.

Limits:

- **It is a suggestion.** Nobody has checked it against how a teacher would finger real
  songs; the tests check hard rules (playable, no crossed fingers, common chord shapes,
  scales in position) and one song by eye.
- An arpeggio is only treated as a held chord when the tab says the notes ring on. The
  test song's main riff has no such marking; it still comes out as the chord shapes,
  because that is also the least movement.
- No settings yet for hand size or avoiding the little finger.
- No thumb-over-the-neck suggestions, and no partial barres as jazz voicings use them.
- Only the first staff of a track is fingered.
- The per-bar diagram on hover or tap (the original idea) was not built; the numbers in
  the tab cover it.

Code: `src/fingering/recommend.ts` (the search), `fromScore.ts` (reading a track),
`useFingering.ts` (drawing). Checks: `src/fingering/*.test.ts` and `e2e/fingering.mjs`.

## Summary

- **It is feasible and worth building**, in a first version limited to single-note lines
  and simple chord shapes.
- The hard half of the published problem is already solved here: a tab fixes the string
  and fret of every note, so only the finger has to be chosen.
- The established method is a shortest-path search over hand positions with a hand-written
  cost for stretches and shifts. It is small, fast, runs in the browser and needs no
  training data.
- The result is a suggestion, not a truth. Good players disagree on fingerings, and the
  method does not understand bends, vibrato or musical phrasing. It should be labelled as
  a suggestion and be easy to ignore.
- Estimated effort for the first version: three to five days including tests. Chords with
  barres and technique-aware rules are a second stage of similar size.

## What the problem is

Published work treats two problems together:

1. **Where to play a pitch.** Most pitches exist on several strings. Choosing among them
   is the larger search and most of the literature.
2. **Which finger plays it.**

A Guitar Pro tab already answers the first. What remains is assigning one of four fingers
(or none, for an open string) to each fretted note so that the hand moves little and never
has to do something impossible.

Some files carry fingerings written by the transcriber. The library used here reads them
(`Note.leftHandFinger`, values thumb and fingers 1–4, or "unknown"). The test file has
none on any of its 6,934 notes, which is probably typical, so a recommender would add
something files rarely contain.

## How it is done in the literature

These summaries are from abstracts and search summaries, not from reading each paper in
full.

- **Shortest path with a hand-written cost (the standard).** Each note gets a set of
  candidate hand states; moving from one state to the next has a cost for shifting the
  hand, stretching and awkward finger orders; dynamic programming finds the cheapest
  sequence. MIT's algorithms course uses guitar fingering as a worked example of exactly
  this. A KTH thesis applies it with a rule-based cost and is limited to single-note lines.
- **Learning the cost weights.** Radisavljevic and Driessen (ICMC 2004) keep the same
  search and tune the weights so the result matches fingerings chosen by an expert.
- **Hidden Markov models.** Hori, Kameoka and Sagayama (2013) treat hand forms as hidden
  states and notes as outputs, and decode with the Viterbi algorithm. They note that
  hand-set parameters reflecting a beginner's preferences give beginner-friendly results.
- **Minimise the hardest move, not the total.** Hori and Sagayama (ISMIR 2016) change the
  search to minimise the single most difficult transition in a phrase. This matches how
  a passage feels: one impossible jump matters more than many slightly awkward ones.
  Tested on single-note phrases.
- **Genetic algorithms** (Tuohy's thesis) and, recently, **neural models** (MIDI-to-Tab,
  2024) address mainly problem 1, string choice. The neural approach needs a large
  training set and a model download, which does not suit an offline browser app.

## Proposed approach

### Model

For a fretted note, a candidate is a pair *(finger, hand position)*, where the hand
position is the fret under the index finger. Finger *f* (1–4) at position *p* covers
fret *p + f − 1*, with one fret of stretch allowed at either end. Open strings need no
finger and do not constrain the hand.

So each note has at most a handful of candidates, and a bar of sixteen notes has a few
dozen states. The search is instantaneous.

### Cost

Per step, the sum of:

- **Position shift**: grows with the distance the hand moves; cheaper when an open string
  or a rest gives time to move.
- **Stretch**: zero for one finger per fret, rising steeply beyond a four-fret span, and
  scaled down higher up the neck where frets are closer.
- **Same finger on consecutive different notes**: penalised, unless it is a slide written
  in the tab, where it is preferred.
- **Finger order against fret order** on one string (for example finger 3 below finger 1):
  effectively forbidden.
- **Weak fingers**: a small penalty for the little finger, larger for fast notes.
- **Time**: every cost is scaled by how little time there is, using the note durations and
  tempo the app already knows.

The total uses the sum of costs plus a heavy weight on the worst single step, which gets
most of the benefit of the minimax idea without a second algorithm.

### Chords

A chord is one state: an assignment of fingers to all its fretted notes at once.

- Enumerate assignments where fingers rise with frets, and allow one finger to cover
  several strings at one fret (a barre) when those strings are adjacent or the strings
  between them are fretted higher.
- Shapes with more fretted notes than fingers and no possible barre are flagged as "no
  suggestion" instead of guessing.
- Common open chords come out right from the rules alone in most published systems; a
  small table of standard shapes can override the rules where they do not.

### Where techniques matter

The tab says where these occur, so rules can use them: slides (keep the finger),
hammer-ons and pull-offs (prefer adjacent strong fingers), bends (prefer the ring finger
with others behind it), let-ring arpeggios (treat the ringing notes as a held chord shape,
which is how the main riff of the test song is actually played).

The last one is the most important for quality: an arpeggio fingered note by note looks
wrong to any guitarist. Detecting "these notes ring together" from the let-ring marking or
from overlapping durations should be in the first version.

## How it would appear in the app

Hover does not exist on a phone, so hover cannot be the only way in.

- **Recommended: show fingers on the fretboard view.** The fretboard already draws a dot
  per note with the note name inside. A setting would put the finger number in the dot
  instead. This works on every device and while playing.
- **A fingering line in the tab.** The library can draw finger numbers beside notes when a
  note has a fingering. Writing the suggestions into the loaded song (in memory only) and
  switching that display on would show them for the whole piece. Whether it reads well in
  tab-only view needs a try; this is unverified.
- **Per bar on hover or tap.** Selecting a bar shows its fingering on the fretboard as a
  static diagram: all notes of the bar, numbered, with the hand position marked. This is
  closest to the original idea and is a natural extension of the fretboard, not a separate
  popup.

A fingering from the file, when present, always wins over a computed one, and the two are
labelled differently.

## Risks and limits

- **No ground truth to test against.** There is no collection of correct fingerings in
  the project. Tests can check hard rules (no impossible stretches, no crossed fingers,
  known open-chord shapes, a scale in one position uses one finger per fret), but "is this
  what a teacher would write" needs your judgement on real songs.
- **Personal preference.** Hand size, three-finger versus four-finger habits and style all
  change the answer. A later setting for hand span or "avoid the little finger" would
  cover most of it.
- **Thumb-over-the-neck fretting** and partial barres in jazz voicings are out of scope.
- **Bass** uses the same method with a wider default stretch penalty low on the neck.
- **Alternate tunings and capo** need no special handling, since frets and strings are
  given.

## Suggested stages

1. **Single-note lines and ringing arpeggios**, shown on the fretboard view. Hard-rule
   tests plus a review by you on three or four songs you know.
2. **Chords**: barres, a table of common shapes, "no suggestion" for the rest.
3. **Techniques and preferences**: bends, legato, hand-span setting.
4. **In-tab display and per-bar diagram**, once the suggestions are trusted.

## Sources

- [MIT 6.006, lecture 22: dynamic programming, guitar fingering](https://mitocw.ups.edu.ec/courses/electrical-engineering-and-computer-science/6-006-introduction-to-algorithms-fall-2011/lecture-videos/lecture-22-dp-iv-guitar-fingering-tetris-super-mario-bros)
- [Radisavljevic and Driessen, "Path Difference Learning for Guitar Fingering Problem", ICMC 2004](https://www.mistic.ece.uvic.ca/publications/2004_icmc_pdl.pdf)
- [Hori, Kameoka and Sagayama, input-output HMM for guitar fingering and arrangement, Journal of Information Processing 2013](https://www.jstage.jst.go.jp/article/ipsjjip/21/2/21_264/_article/-char/en)
- [Hori and Sagayama, minimax Viterbi algorithm for guitar fingering, ISMIR 2016](https://archives.ismir.net/ismir2016/paper/000285.pdf)
- [KTH thesis: rule-based dynamic programming for monophonic guitar fingering](https://www.diva-portal.org/smash/get/diva2:668903/FULLTEXT01.pdf)
- [Tuohy, thesis on creating tablature and arranging for guitar with genetic algorithms](https://www.ai.uga.edu/sites/default/files/inline-files/tuohy_daniel.pdf)
- [MIDI-to-Tab: guitar tablature inference via masked language modeling, 2024](https://arxiv.org/html/2408.05024v1)
- [SMC 2024 paper reviewing fingering methods](https://smcnetwork.org/smc2024/papers/SMC2024_paper_id55.pdf)
- [alphaTab `fingeringMode` setting](https://alphatab.net/docs/reference/settings/notation/fingeringmode)
