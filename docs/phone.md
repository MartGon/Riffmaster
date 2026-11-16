# Using the app from a phone on your network

The iPhone only allows the microphone on HTTPS pages, and a page opened as
`http://192.168.x.x:5173` from another device is not HTTPS. Without it, practice and the
tuner cannot hear anything. The app shows a notice when this happens.

The fix is a small private certificate authority on this computer. The phone is told to
trust it once, and the dev server then serves the app over HTTPS.

## One-time setup

1. On the computer, in the project folder:

   ```
   npm run phone:setup
   ```

   It creates the certificates in `certs/` (ignored by git) and prints an address such as
   `http://192.168.1.20:5174`.
2. On the iPhone, open that address in **Safari** (other browsers cannot install
   certificates) and follow the steps on the page:
   - Download the certificate and allow it.
   - **Settings** → **Profile Downloaded** → **Install**.
   - **Settings → General → About → Certificate Trust Settings** → switch on
     **RiffMaster local development CA** (the setup page shows the exact name).
3. Back on the computer, stop the setup script with Ctrl+C.

## Every time

```
npm run dev:phone
```

Then open `https://<computer's address>:5180` on the phone, for example `https://192.168.1.20:5180`. It uses port 5180 so it can run
alongside the usual `npm run dev` on 5173. The address is the computer's
network address; `npm run phone:setup` prints it. The computer's
`.local` name (`https://<hostname>.local:5180`) should also work.

To try installing the app to the home screen, which needs the built version:

```
npm run build && npm run preview:phone
```

## When the computer's address changes

The router may give the computer a different address. Run `npm run phone:setup` again: it
makes a new certificate for the new address and keeps the authority, so the phone does
not need to install anything again. Stop it with Ctrl+C and start `npm run dev:phone`.

## Safety

`certs/ca.key` is the authority's private key. Anyone with it could make certificates
your phone trusts for any website. It never leaves this computer and git ignores the
folder. To undo everything: on the iPhone remove the profile under
**Settings → General → VPN & Device Management**, and delete `certs/` here.

## Selecting bars to loop

Dragging over the tab scrolls on a phone, so bars are chosen by tapping instead:

1. Tap **Select bars** (the bracket button in the bottom row).
2. Tap the first bar, then the last bar. Tapping the same bar twice selects only that bar.
3. Turn on **Loop**. Playback and practice then repeat the selection.

The same button then becomes **Clear selection** (×). The loop buttons next to each section
in the track list (≡) and the bars listed in the practice history also select bars.

## Holding the phone sideways

The tab becomes one long line that scrolls sideways as the song plays, drawn larger.
While it plays (with no practice, tuner or editor panel open), the top and bottom bars
step aside; the round pause button brings them back.

## Silent switch

iPhones mute web pages' sound when the silent switch is on, unless the page says it plays
media. The app does this on the first tap (Safari 17 and later have a setting for it;
older versions get a silent looping sound that has the same effect). If the song is still
silent, tap anywhere on the page once more, then press Play.

## Android

Android can use the same certificate (**Settings → Security → Encryption & credentials →
Install a certificate → CA certificate**), but Chrome on Android also accepts a page
after tapping through the warning, which is enough for testing. This is untested.
