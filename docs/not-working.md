# Not working features

- On phone, it cannot load *.gp files. They show up in grey like any other *.pdf or similar. I haven't tried other formats yet
- File loading is now broken. Cannot load any of the test files
- Practice over selected bar should loop if loop is checked
- Practice should start from the current cursor position
- Master volume and volume mixer for instruments
- Should add maybe like a threshold or leeway option for practice. At the moment seems a bit too harsh on timing, but may be another issue
- Rename the project and brand name to RiffMaster

## Status (15 November 2026)

Answers from the assistant; the list above is as written.

1. **Greyed-out .gp files on the phone:** fixed. iOS greys out file types it does not
   know, so on iPhone and iPad the picker now shows all files; each file is still checked
   when it is added. Not yet tried on the phone itself.
2. **File loading broken:** fixed. It failed on any page opened without HTTPS (such as
   `http://192.168.x.x:5173` from another device), because browsers turn off the hashing
   the library used. The library now has its own, and storage errors are no longer
   reported as damaged files. For the phone, see [phone.md](phone.md).
3. **Practice should loop:** done. With Loop on, practice goes round the selection until
   Stop, and each pass is scored and kept in the history on its own. A pass cut short by
   Stop is left out, unless it is the only one. With the speed trainer on, the trainer's
   rounds take the place of the loop.
   The player pauses for about 20–40 ms at each turn of the loop (it is in the playback
   library); scoring follows the actual playback, so this does not count against you. Plain playback with Loop on also sometimes ran past the end of the
   selection on the first play after opening a song; that is caught now as well.
4. **Start from the cursor:** done. Without a selection, a take starts at the playback
   position (where you clicked, or the section you jumped to). At the end of the song it
   starts from the beginning.
5. **Master volume and mixer:** done. A volume slider at the top of the track list, and
   one under each track (0–150 %, double-click for 100 %). Track volumes are kept with
   the song, the master volume for this device.
6. **Timing leeway:** done. Practice has a **Timing** setting: Strict (±30 ms), Normal
   (±50 ms, as before), Relaxed (±80 ms), Loose (±120 ms). If it still feels harsh at
   Loose, the delay estimate is the more likely cause: the result shows the delay used.
7. **Rename to RiffMaster:** done for everything visible: page title, header, installed
   app name, package name, and the names under which the browser stores the library
   and settings.

## Finding out why notes are missed

After a practice take, the results have a **Save take** button. It downloads one WAV
file: the input as the app heard it, with a report inside (an extra chunk that audio
programs skip). The report lists every expected note with its grade and its place in the
recording, every note the app heard, the delay used, the input's name and settings, and
the detector's settings. `decodeTake` in `src/practice/takeFile.ts` reads it back.

The recording is held in memory until the next take starts and is not stored anywhere
unless the button is pressed. Up to ten minutes are kept.
