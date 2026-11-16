# Browser checks

Scripts that drive the app in a real browser. They are run by hand, not by `npm test`.

They need:

- a tab file at `samples/californication.gp` (not in the repository);
- Brave at `/usr/bin/brave-browser` (any Chromium works; change `executablePath`);
- the dev server on port 5199 (`npx vite --port 5199 --strictPort`), and for `library.mjs`
  the built app on port 5198 (`npm run build && npx vite preview --port 5198 --strictPort`).

| Script | Checks |
|---|---|
| `player.mjs` | Opening a file, playback, tempo, tracks, loop selection, toggles, at desktop and phone size |
| `library.mjs` | Saved songs, remembered settings, offline use, removing songs |
| `expected.mjs` | Writes `expected.json`: the notes the tab expects per track. Run before `practice.mjs` |
| `practice.mjs` | Practice mode: a synthesized performance is fed in as the microphone and the app's score is compared with the mistakes that were put in. `node practice.mjs clean\|mistakes\|bass\|all` |
| `features.mjs` | Sections, fretboard, tuner, live practice marks, practice history and the speed trainer. `node features.mjs ui\|tuner\|trainer\|all` |
| `practice-loop.mjs` | Practice with Loop on (a pass per time round) and practice from the playback position. Run `expected.mjs` first. `node practice-loop.mjs loop\|cursor\|edge\|all` |
| `select.mjs` | Choosing bars by tapping on a phone-sized touch screen |
| `sideways.mjs` | A phone held sideways: one long line of tab, larger, controls hidden while playing |
| `wake.mjs` | Playback after the audio was suspended, as iOS does; stalled playback |
| `fingering.mjs` | Suggested fingers: numbers in the tab and on the fretboard, other tracks, the editor, phone sizes |
| `exercises.mjs` | Built-in exercises: the dialog, scales, finger exercises, chords, the library, phone size, and a practice take on an exercise. Needs no tab file. `node exercises.mjs ui\|practice\|all` |
| `mixer.mjs` | Master and track volumes, remembered per device and per song; the app's name |
| `editor.mjs` | The tab editor: typing, undo, clicks, copy and paste, bars, saving and restoring, the unsaved-changes question, new tabs, phone size. `node editor.mjs song\|new\|phone\|all` |

Screenshots, audio and `expected.json` are written next to the scripts and are ignored by git.
