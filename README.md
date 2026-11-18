# RiffMaster

A guitar and bass practice app that runs in the browser. Open a Guitar Pro tab, play it
back at any speed, loop the hard bars, and practise along: the app listens through the
microphone and scores which notes you played and how well you kept time.

It works on a desktop and on a phone, can be installed as an app, and keeps working
offline once a song has been opened.

## Features

- **Playback:** tab and standard notation, tempo control, looping a selection of bars,
  section markers, a mixer with master and per-track volume, and muting tracks.
- **Practice scoring:** play along and get a score per note, chord and bar, with live
  marks for on time, early, late and missed. A chord counts when each of its notes is
  heard at an octave the tab writes it in, so a different chord is caught. Takes are kept as a history per song, with the
  bars that go wrong most.
- **Speed trainer:** repeats a selection, raising the tempo each time you pass it.
- **Tuner** for the strings of the track on screen, including basses and alternate tunings.
- **Fretboard view** that follows playback.
- **Suggested fingering** for the fretting hand, shown in the tab and on the fretboard.
- **Tab editor:** edit tracks or write a new tab from scratch, with undo, and download the
  result as a `.gp` file.
- **Built-in exercises:** scales in five positions and any key, spider and other finger
  exercises, arpeggios and chord changes.
- **Library:** songs are stored in the browser (IndexedDB), with their settings and
  practice history, and work offline.
- **Sync (optional):** sign in to keep the library the same on several devices, through
  your own Supabase project. Without it nothing is sent to a server.

Accepted files: Guitar Pro 3 to 8 (`.gp3`, `.gp4`, `.gp5`, `.gpx`, `.gp`), MusicXML
(`.xml`, `.musicxml`, compressed `.mxl`) and Capella (`.capx`). Tracks without strings,
such as voice, piano or drums, are shown in standard notation only.

## Getting started

Needs Node.js 20.19 or 22.12 or later.

```sh
npm install
npm run dev
```

Then open http://localhost:5173 and use **Open** to load a tab file, or **Exercises** to
start without one.

### Better instrument sounds (optional)

By default playback uses the small sound bank that comes with alphaTab. For fuller
sounds, download GeneralUser GS (32 MB) once, then restart the dev server:

```sh
npm run sounds:setup
```

To go back to the small bank, delete `public/sounds/` and restart.

### On a phone

Browsers only allow the microphone on HTTPS pages, so practice and the tuner need the
dev server to run over HTTPS with a local certificate the phone trusts:

```sh
npm run phone:setup   # once: creates the certificates and walks the phone through trusting them
npm run dev:phone     # every time: serves the app over HTTPS on port 5180
```

`npm run phone:setup` prints an address to open on the phone, with the steps to install
and trust the certificate. Then open `https://<computer's address>:5180`.

### Sync between devices (optional)

Sync uses a Supabase project of your own. Each device keeps its full library and works
offline; changes are exchanged whenever it is signed in and online.

1. In the Supabase dashboard, run [`supabase/schema.sql`](supabase/schema.sql) in the
   SQL Editor. It makes the tables, the access rules and a private `tabs` bucket.
2. Under **Authentication → Users**, add a user with **Auto Confirm User** ticked, then
   turn off **Allow new users to sign up**.
3. Put the project URL and its publishable key in `.env.local`, and restart the dev server:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   Never the secret or service_role key: these values end up in the app.
4. Sign in with the cloud button in the top bar, on each device.

Builds without these values have no sync button.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Type check and production build into `out/` (plain static files) |
| `npm run preview` | Serves the built app |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | Lint (oxlint) |
| `npm run sounds:setup` | Downloads the larger sound bank |
| `npm run phone:setup` | Creates certificates for HTTPS on the local network |
| `npm run dev:phone`, `npm run preview:phone` | The two servers above, over HTTPS for a phone |

Browser checks that drive the app in a real browser are in [e2e/](e2e/README.md). They
are run by hand.

## Built with

- [alphaTab](https://www.alphatab.net/) (MPL-2.0) for rendering, playback and reading
  Guitar Pro files
- [React](https://react.dev/) and [Next.js](https://nextjs.org/), built as static files;
  [Workbox](https://developer.chrome.com/docs/workbox) for offline use
- [pitchy](https://github.com/ianprime0509/pitchy) for pitch detection
- [idb](https://github.com/jakearchibald/idb) for the library storage
- [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins,
  the optional sound bank (downloaded, not included)

No tab files are included in this repository.
