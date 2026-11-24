# Browser checks

Scripts that drive the app in a real browser. They are run by hand, not by `npm test`.

They need:

- a tab file at `samples/californication.gp` (not in the repository);
- Brave at `/usr/bin/brave-browser` (any Chromium works; change `executablePath`);
- the dev server on port 5199 (`npx next dev --webpack -p 5199`), and for `library.mjs`
  the built app on port 5198 (`npm run build && node scripts/serve.mjs --port 5198`).

| Script | Checks |
|---|---|
| `player.mjs` | Opening a file, playback, tempo, tracks, loop selection, toggles, at desktop and phone size |
| `library.mjs` | Saved songs, remembered settings, offline use, removing songs |
| `practice-sideways.mjs` | A practice take with the phone sideways: the bars and the practice panel step aside, a floating Stop and the live count replace them, and Stop brings everything back; held upright the panel stays. Fake microphone; needs the sample tab |
| `wakelock.mjs` | The screen stays on while a song is open: a wake lock is held in the player, asked for again after the page was in the background, and let go in the library. Uses a file fetched by `formats.mjs` |
| `practice-restart.mjs` | Practice takes started and stopped again, some during the count-in: every count-in is one bar of 4 clicks (also after a take stopped mid-bar), the cursor stays, a take started while the song plays counts in one bar with the cursor still, starting a take after a stop mid-bar reports no position outside its bar, Play after a count-in cut short starts the song at once, and Play with a count-in from mid-bar goes back to the bar's start (without one, it carries on). Fake microphone; needs the sample tab |
| `countin-cursor.mjs` | The cursor stays on the first beat through a practice take's count-in and moves once the song starts. Fake microphone; needs the sample tab |
| `sound-level.mjs` | What reaches the speakers while an exercise and a song play, alone and one after the other, including an exercise after a song with a track soloed and one muted. Needs the sample tab |
| `worklet-scope.mjs` | The cause of silent Play on iPhones: alphaTab's worklet files must run to the end, which needs `_N_E` declared in the worklet first. Built app on port 5198 |
| `worklet-retry.mjs` | The iPhone playback fix: the first starts of alphaTab's audio worklet are made to fail as they do in Safari's engine, and playback must still start; after 3 failures the audio is set up again and plays. Built app on port 5198; uses a file fetched by `formats.mjs` |
| `audio-stuck.mjs` | The audio output gets stuck, as on an iPhone after the screen locks (simulated by a module load that never finishes): the player notices nothing is heard, sets the audio up again, and plays on from the same place. Needs the sample tab |
| `sync.mjs` | The sync button and sign-in form: nothing sent before signing in, a wrong password reported. Needs `.env.local` with a Supabase project. The exchange itself is covered by `src/sync/engine.test.ts` |
| `expected.mjs` | Writes `expected.json`: the notes the tab expects per track. Run before `practice.mjs` |
| `practice.mjs` | Practice mode: a synthesized performance is fed in as the microphone and the app's score is compared with the mistakes that were put in. `chords` practises a strummed section with a skipped, a wrong and a late chord. `node practice.mjs clean\|mistakes\|bass\|chords\|all` |
| `features.mjs` | Sections, fretboard, tuner, live practice marks, practice history and the speed trainer. `node features.mjs ui\|tuner\|trainer\|all` |
| `practice-loop.mjs` | Practice with Loop on (a pass per time round) and practice from the playback position. Run `expected.mjs` first. `node practice-loop.mjs loop\|cursor\|edge\|all` |
| `select.mjs` | Choosing bars by tapping on a phone-sized touch screen |
| `sideways.mjs` | A phone held sideways: one long line of tab, larger, controls hidden while playing |
| `wake.mjs` | Playback after the audio was suspended, as iOS does; stalled playback |
| `fingering.mjs` | Suggested fingers: numbers in the tab and on the fretboard, other tracks, the editor, phone sizes |
| `exercises.mjs` | Built-in exercises: the dialog, scales, finger exercises, chords, the library, phone size, and a practice take on an exercise with its take report (also at phone size). Needs no tab file. `node exercises.mjs ui\|practice\|all` |
| `tuning.mjs` | The Tuning list: choices named after the tuning they need, the output heard shifted (pitch read from what reaches the speakers), practice expecting and scoring the shifted notes, the tuner following, the choice kept with the song. Dev server on 5173 (or APP_URL); needs no tab file. `node tuning.mjs ui\|practice\|all` |
| `plan.mjs` | Today's practice plan: built from the history, each step opened on its bars at its tempo, ticked off by today's takes, skipping, the warm-up, phone size. Dev server on 5173 (or APP_URL); needs the sample tab |
| `drill.mjs` | Riff to exercise: a drill made from a plan step's bars, its parts and notes, played and scored, kept in the tuning, found again rather than added twice. Dev server on 5173 (or APP_URL); needs the sample tab |
| `leadin.mjs` | Lead-in: selected bars start one bar early in plain Play and in a take, on every pass of a loop, without scoring that bar; the selection comes back afterwards. Dev server on 5173; run `expected.mjs` first; needs the sample tab |
| `timing.mjs` | Timing habits: a performance late on every string change is reported, about the right size, in the result and the history. Dev server on 5173; needs the sample tab |
| `wait.mjs` | Wait mode: the tab holds at each note until it is heard, names a wrong note, skips one the microphone misses, sums up, and adds nothing to the history. Dev server on 5173; needs the sample tab |
| `pedal.mjs` | Foot pedal: page-turner keys play and stop, go back, reach the next section, start and stop a take, skip in wait mode; keys can be changed; typing, sliders and dialogs keep their keys. Dev server on 5173; needs the sample tab |
| `findnote.mjs` | Find the note: prompts follow the played notes, a wrong note is named and costs points, time runs out, a score and best are kept. Dev server on 5173 |
| `capo.mjs` | Capo and single strings: the tab is re-fretted for the player's guitar, notes below the capo move strings, practice listens for the same notes, the tuner and fretboard follow, editing waits, and the choice is kept. Dev server on 5173 |
| `progress.mjs` | Progress per song: how much of a song is learned in the library and the history, the practice streak and this week's minutes, from takes written into storage. Dev server on 5173 |
| `lists.mjs` | Lists of songs: put songs on a list, reorder them, play them through with Next and Previous, rename and delete the list; kept after a reload. Dev server on 5173 |
| `mixer.mjs` | Master and track volumes, remembered per device and per song; the app's name |
| `editor.mjs` | The tab editor: typing, undo, clicks, copy and paste, bars, saving and restoring, the unsaved-changes question, new tabs, phone size. `node editor.mjs song\|new\|phone\|all` |
| `theme.mjs` | The theme switch: system, light and dark, remembered after a reload and in other tabs, the score re-coloured |
| `formats.mjs` | Every accepted format (Guitar Pro 3–8, MusicXML, compressed MusicXML, Capella) opened, drawn and played, tracks without strings shown in notation. Downloads alphaTab's test files into `formats/` on first run; needs no tab file of yours |

Screenshots, audio and `expected.json` are written next to the scripts and are ignored by git.
