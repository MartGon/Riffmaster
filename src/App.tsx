import * as alphaTab from '@coderline/alphatab'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { DrillDialog } from './components/DrillDialog'
import { EditorPanel } from './components/EditorPanel'
import { ExerciseDialog } from './components/ExerciseDialog'
import { ChoiceDialog } from './components/FormDialog'
import { Fretboard } from './components/Fretboard'
import { Icon } from './components/Icon'
import { LibraryView } from './components/LibraryView'
import { NewTabDialog } from './components/NewTabDialog'
import { PedalDialog } from './components/PedalDialog'
import { PlanBar } from './components/PlanBar'
import { PlanCard } from './components/PlanCard'
import { PracticePanel } from './components/PracticePanel'
import { SectionList } from './components/SectionList'
import { SyncButton } from './components/SyncButton'
import { ThemeToggle } from './components/ThemeToggle'
import { TrackList } from './components/TrackList'
import { Transport } from './components/Transport'
import { TunerPanel } from './components/TunerPanel'
import { TuningPicker } from './components/TuningPicker'
import { isAppleTouch, preferPlayback } from './lib/audioSession'
import { clampSpeed } from './lib/format'
import { isControlKey, loadPedalKeys, nextSection, pedalKeyAction, type PedalKeys, savePedalKeys } from './lib/pedal'
import { loadPrefs, MAX_VOLUME, savePrefs } from './lib/prefs'
import { useWakeLock } from './lib/wakeLock'
import { useEditor } from './editor/useEditor'
import { buildExercise, EXERCISES, initialValues } from './exercises/catalogue'
import { buildDrill, type DrillChoices, drillOptions, type DrillOptions } from './exercises/drill'
import { useFingering } from './fingering/useFingering'
import {
  addSong,
  addTake,
  clearTakes,
  hasOriginal,
  listTakes,
  openSong,
  restoreOriginal,
  saveEditedSong,
  saveSongPitch,
  saveSongSettings,
} from './library/db'
import type { Song, SongSettings, TakeRecord } from './library/types'
import { useLibrary } from './library/useLibrary'
import type { PlanStep } from './plan/plan'
import { usePlan } from './plan/usePlan'
import { SIDEWAYS, usePlayer } from './player/usePlayer'
import { type NewTake, usePractice } from './practice/usePractice'
import { startSync } from './sync/sync'
import { useTuner } from './tuner/useTuner'

const ACCEPTED = '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.mxl,.xml,.capx'

/**
 * iPhones and iPads grey out files whose type they do not know, which
 * includes every Guitar Pro format, so there the picker shows all files.
 * Files are checked when they are added either way.
 */
const PICKER_ACCEPT = isAppleTouch() ? undefined : ACCEPTED

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true
  if (target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && target.type !== 'range'
}

/** Whether keys typed here are text, which a pedal key must not take away. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true
  return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'file'].includes(target.type)
}

// Narrow screens, and phones held sideways, which are wide but short.
const narrowScreen = '(max-width: 800px), (max-height: 500px)'

/** Whether a media query currently matches, following changes. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', notify)
      return () => media.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
  )
}

export default function App() {
  const { state, actions, api, scoreRef, viewportRef, picking } = usePlayer()
  const library = useLibrary()
  /** The song open in the player, or null while the library is showing. */
  const [songId, setSongId] = useState<string | null>(null)
  const plan = usePlan(library.songs)
  const refreshPlan = plan.refresh
  /** The step of today's plan being practised, if any. */
  const [planStepId, setPlanStepId] = useState<string | null>(null)
  /**
   * The song's own tempo and track while a plan step has set others: a step
   * must not change what the song opens with next time. Each is let go for
   * good the first time the player picks another value by hand.
   */
  const [planKeeps, setPlanKeeps] = useState<{
    speed: number
    stepSpeed: number
    holdSpeed: boolean
    trackIndex: number | null
    /** The track the step opened on, known once the song is ready. */
    stepTrack: number | null
    holdTrack: boolean
  } | null>(null)
  const startingStep = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const marksRef = useRef<HTMLDivElement>(null)
  /** Practice history of the open song, oldest take first. */
  const [takes, setTakes] = useState<TakeRecord[]>([])
  const songIdRef = useRef(songId)
  useEffect(() => {
    songIdRef.current = songId
  })
  const onTake = useCallback((take: NewTake) => {
    const id = songIdRef.current
    if (!id) return
    void addTake({ ...take, songId: id, at: Date.now() }).then(
      (record) => {
        if (songIdRef.current === id) setTakes((list) => [...list, record])
        void refreshPlan()
      },
      // Without storage the take is simply not remembered.
      () => {},
    )
  }, [refreshPlan])
  // Sync is optional and runs in the background; changes from other devices refresh the list.
  const refreshLibrary = library.refresh
  useEffect(() => startSync(() => void refreshLibrary()), [refreshLibrary])
  const practice = usePractice(api, state, marksRef, {
    setSpeed: actions.setSpeed,
    onTake,
    releaseLeadIn: actions.releaseLeadIn,
    reveal: actions.revealPosition,
    holdRange: actions.holdRange,
  })
  const editLayerRef = useRef<HTMLDivElement>(null)
  /** Whether the open song was edited and saved, so its first version can be restored. */
  const [hasOriginalFile, setHasOriginalFile] = useState(false)
  const onSave = useCallback(async (data: ArrayBuffer, info: { title: string; artist: string }) => {
    const id = songIdRef.current
    if (!id) return false
    try {
      const saved = await saveEditedSong(id, data, info)
      if (saved && songIdRef.current === id) setHasOriginalFile(true)
      return saved !== null
    } catch {
      return false
    }
  }, [])
  const editor = useEditor(api, state, actions, editLayerRef, scoreRef, { onSave })
  /** Opens the editor once the song being loaded is ready, for a tab that was just created. */
  const editAfterLoad = useRef(false)
  /** What to do once the question about unsaved edits has been answered. */
  const [leaving, setLeaving] = useState<{ then: () => void } | null>(null)
  const [newTabOpen, setNewTabOpen] = useState(false)
  const [exercisesOpen, setExercisesOpen] = useState(false)
  const [pedalOpen, setPedalOpen] = useState(false)
  const [pedalKeys, setPedalKeys] = useState<PedalKeys>(loadPedalKeys)
  /** The passage a drill is being made from. */
  const [drillSource, setDrillSource] = useState<{ first: number; last: number; options: DrillOptions } | null>(null)
  const editorDirty = editor.state.dirty
  /** Runs `then` straight away, or after asking what to do with unsaved edits. */
  const guardEdits = useCallback(
    (then: () => void) => {
      if (editorDirty) setLeaving({ then })
      else then()
    },
    [editorDirty],
  )
  const activeTrack = state.tracks.find((track) => track.index === state.activeTrack)
  // The tuning the guitar needs to play along: the track's, shifted with the song.
  const writtenTuning = activeTrack?.tuning
  const guitarTuning = useMemo(
    () => (writtenTuning ?? []).map((midi) => midi + state.pitch),
    [writtenTuning, state.pitch],
  )
  const tuner = useTuner(guitarTuning)
  const [fretboardOpen, setFretboardOpen] = useState(() => loadPrefs().showFretboard)
  const [fingeringOn, setFingeringOn] = useState(() => loadPrefs().showFingering)
  const fingersRef = useRef<HTMLDivElement>(null)
  const fingerings = useFingering(api, fingersRef, fingeringOn && songId !== null)
  const trackTakes = useMemo(
    () => takes.filter((take) => take.trackIndex === state.activeTrack),
    [takes, state.activeTrack],
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  /** Notices closed by hand. They come back after a reload if their cause remains. */
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const close = (notice: string) => setClosed((set) => new Set(set).add(notice))
  const closeButton = (notice: string) => (
    <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => close(notice)}>
      <Icon name="close" />
    </button>
  )
  const [tracksOpen, setTracksOpen] = useState(false)
  const narrow = useMediaQuery(narrowScreen)
  const sideways = useMediaQuery(SIDEWAYS)
  const inPlayer = songId !== null
  // The screen stays on while a song is open.
  useWakeLock(inPlayer)
  const ready = inPlayer && state.status === 'ready' && !state.loadFailed
  if (planKeeps && ready) {
    const stepTrack = planKeeps.stepTrack ?? state.activeTrack
    const holdSpeed = planKeeps.holdSpeed && state.speed === planKeeps.stepSpeed
    const holdTrack = planKeeps.holdTrack && state.activeTrack === stepTrack
    if (stepTrack !== planKeeps.stepTrack || holdSpeed !== planKeeps.holdSpeed || holdTrack !== planKeeps.holdTrack) {
      setPlanKeeps({ ...planKeeps, stepTrack, holdSpeed, holdTrack })
    }
  }

  // Per-song choices are saved shortly after they change. The pending save
  // is written at once when leaving the song or the page, so a quick exit
  // does not lose it.
  const pendingSave = useRef<{ id: string; json: string; timer: number } | null>(null)
  const flushSave = useCallback(() => {
    const pending = pendingSave.current
    if (!pending) return
    pendingSave.current = null
    window.clearTimeout(pending.timer)
    void saveSongSettings(pending.id, JSON.parse(pending.json) as SongSettings)
  }, [])

  const openNow = useCallback(
    async (song: Song, edit = false, step?: PlanStep): Promise<boolean> => {
      // A choice made a moment ago belongs to the song being left.
      flushSave()
      const stored = await openSong(song.id)
      if (!stored) {
        setNotice(`"${song.title}" is no longer in the library.`)
        void library.refresh()
        return false
      }
      setNotice(null)
      setPlanStepId(step?.id ?? null)
      setPlanKeeps(
        step
          ? {
              speed: stored.song.settings.speed,
              stepSpeed: clampSpeed(step.speed ?? stored.song.settings.speed),
              holdSpeed: true,
              trackIndex: stored.song.settings.trackIndex,
              stepTrack: null,
              holdTrack: true,
            }
          : null,
      )
      editor.actions.close()
      editor.actions.reset()
      editAfterLoad.current = edit
      setSongId(stored.song.id)
      setTakes([])
      setHasOriginalFile(false)
      void listTakes(stored.song.id).then(setTakes, () => {})
      void hasOriginal(stored.song.id).then(
        (kept) => songIdRef.current === stored.song.id && setHasOriginalFile(kept),
        () => {},
      )
      const settings = {
        ...stored.song.settings,
        ...(step && step.trackIndex !== null && { trackIndex: step.trackIndex }),
        ...(step && step.speed !== null && { speed: step.speed }),
      }
      actions.load(stored.data, settings, step?.bars && { ...step.bars, firstPlayed: step.kind === 'new' })
      return true
    },
    [actions, editor.actions, flushSave, library],
  )
  const open = useCallback(
    (song: Song, edit = false) => guardEdits(() => void openNow(song, edit)),
    [guardEdits, openNow],
  )
  useEffect(() => {
    if (!editAfterLoad.current || !ready) return
    editAfterLoad.current = false
    editor.actions.open()
  }, [editor.actions, ready])

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setBusy(true)
      const result = await library.addFiles(files)
      setBusy(false)
      const problems = [
        result.failed.length > 0
          ? `Could not open ${result.failed.join(', ')}. The file may be damaged or in a format that is not supported.`
          : '',
        result.storageError ? `A file could not be saved in this browser's storage (${result.storageError}).` : '',
      ].filter(Boolean)
      setNotice(problems.length > 0 ? problems.join(' ') : null)
      // A single new file opens straight away; several just land in the list.
      if (files.length === 1 && result.added.length === 1) open(result.added[0])
    },
    [library, open],
  )

  const leaveSong = useCallback(() => {
    flushSave()
    if (practice.state.open) practice.actions.closePanel()
    if (tuner.state.open) tuner.actions.close()
    editor.actions.close()
    editor.actions.reset()
    actions.stop()
    setSongId(null)
    setPlanStepId(null)
    setPlanKeeps(null)
    setTakes([])
    setTracksOpen(false)
    void library.refresh()
  }, [actions, editor.actions, flushSave, library, practice.actions, practice.state.open, tuner.actions, tuner.state.open])
  const backToLibrary = useCallback(() => guardEdits(leaveSong), [guardEdits, leaveSong])

  // A song that could not be opened leaves the player holding the one before
  // it, which must not be practised or saved under the new song's name.
  const leaveFailedSong = useRef(leaveSong)
  useEffect(() => {
    leaveFailedSong.current = leaveSong
  })
  useEffect(() => {
    if (!state.loadFailed || !songIdRef.current) return
    leaveFailedSong.current()
    setNotice('This file could not be opened. It may be damaged or in a format that is not supported.')
  }, [state.loadFailed])

  // Sizes are noted from what is saved, not from edits that may yet be discarded.
  const savedBars = ready && !editor.state.dirty ? api?.score?.masterBars.length : undefined
  const noteSongSize = plan.noteSongSize
  const trackCount = state.tracks.length
  useEffect(() => {
    if (songId && savedBars) noteSongSize(songId, savedBars, trackCount)
  }, [noteSongSize, savedBars, songId, trackCount])

  const restoreOriginalFile = useCallback(async () => {
    const id = songIdRef.current
    if (!id) return
    try {
      const data = await restoreOriginal(id, (file) => {
        const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(file))
        return { title: score.title.trim() || 'Untitled', artist: score.artist.trim() }
      })
      if (!data || songIdRef.current !== id) return
      setHasOriginalFile(false)
      editor.actions.reset()
      actions.load(data, {
        speed: state.speed,
        trackIndex: state.activeTrack,
        mutedTracks: [],
        soloTracks: [],
        volumes: {},
        pitch: state.pitch,
      })
    } catch {
      setNotice('The original file could not be restored.')
    }
  }, [actions, editor.actions, state.activeTrack, state.pitch, state.speed])

  const settingsJson = ready
    ? JSON.stringify({
        // What the player changes by hand is kept; what a plan step set is not.
        speed: planKeeps?.holdSpeed ? planKeeps.speed : state.speed,
        trackIndex: planKeeps?.holdTrack ? planKeeps.trackIndex : state.activeTrack,
        mutedTracks: state.tracks.filter((t) => t.muted).map((t) => t.index),
        soloTracks: state.tracks.filter((t) => t.solo).map((t) => t.index),
        volumes: Object.fromEntries(
          state.tracks.filter((t) => t.volume !== 1).map((t) => [t.index, t.volume]),
        ),
        // Left out at 0, so songs saved before it existed are not rewritten.
        ...(state.pitch !== 0 && { pitch: state.pitch }),
      } satisfies SongSettings)
    : null
  useEffect(() => {
    if (!songId || !settingsJson) return
    if (pendingSave.current) window.clearTimeout(pendingSave.current.timer)
    pendingSave.current = {
      id: songId,
      json: settingsJson,
      timer: window.setTimeout(flushSave, 400),
    }
  }, [songId, settingsJson, flushSave])
  useEffect(() => {
    window.addEventListener('pagehide', flushSave)
    return () => window.removeEventListener('pagehide', flushSave)
  }, [flushSave])

  // The speed trainer keeps hold of playback between its rounds as well.
  const practiceBusy =
    practice.state.phase === 'recording' ||
    practice.state.phase === 'following' ||
    practice.state.phase === 'starting' ||
    practice.state.trainer.running

  // A practice take or the speed trainer under way (measuring the delay needs the panel).
  const practising = practiceBusy && (practice.state.kind === 'practice' || practice.state.trainer.running)
  // A phone held sideways gives the tab the whole screen while the song
  // plays, or a practice take runs: the bars at the top and bottom and the
  // practice panel step aside until it is paused or the take ends.
  const immersive =
    ready &&
    sideways &&
    !editor.state.active &&
    !tuner.state.open &&
    !tracksOpen &&
    // Wait mode keeps its panel: it has Skip note, and says what was heard.
    ((state.isPlaying && !practice.state.open) || (practice.state.open && practising && practice.state.phase !== 'following'))

  // The editor, practice and the tuner each use the bottom of the screen, so one is open at a time.
  const togglePractice = () => {
    if (practice.state.open) {
      practice.actions.closePanel()
      return
    }
    if (tuner.state.open) tuner.actions.close()
    editor.actions.close()
    practice.actions.openPanel()
  }
  const toggleEditor = () => {
    if (editor.state.active) {
      editor.actions.close()
      return
    }
    if (practice.state.open) practice.actions.closePanel()
    if (tuner.state.open) tuner.actions.close()
    editor.actions.open()
  }
  const toggleTuner = () => {
    if (tuner.state.open) {
      tuner.actions.close()
      return
    }
    editor.actions.close()
    if (practice.state.open) practice.actions.closePanel()
    // The song would drown out the string being tuned.
    if (state.isPlaying) actions.playPause()
    tuner.actions.open()
  }
  const toggleFretboard = () => {
    setFretboardOpen((open) => {
      savePrefs({ showFretboard: !open })
      return !open
    })
  }

  const toggleFingering = () => {
    setFingeringOn((on) => {
      savePrefs({ showFingering: !on })
      return !on
    })
  }

  const editing = editor.state.active
  // Space toggles playback from anywhere outside a text field. A button
  // reached with the keyboard keeps Space for itself, as usual; one that
  // only has focus because it was clicked does not, and there the key-up is
  // swallowed so the button is not "clicked" again by the same press.
  // During a practice take the take owns playback, so Space does nothing.
  useEffect(() => {
    if (!ready) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTextEntry(event.target)) return
      const target = event.target
      // In the editor a key is pressed all the time, which makes a clicked
      // button count as keyboard-focused; there Space always plays, and
      // buttons are pressed from the keyboard with Enter.
      if (
        !editing &&
        target instanceof HTMLElement &&
        target.matches('button:focus-visible, a:focus-visible')
      ) {
        return
      }
      if (target instanceof HTMLElement && target.closest('dialog')) return
      event.preventDefault()
      if (practiceBusy) return
      if (event.type === 'keydown' && !event.repeat) actions.playPause()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [actions, editing, practiceBusy, ready])

  // A foot pedal is a keyboard with a few keys. It works wherever the hands
  // would be busy, and stays out of the way of typing, sliders and dialogs.
  const pedal = useRef<(action: 'play' | 'restart' | 'next') => void>(() => {})
  useEffect(() => {
    pedal.current = (action) => {
      const { phase, trainer, wait } = practice.state
      if (action === 'play') {
        if (wait) practice.actions.skipWaitNote()
        else if (phase === 'starting') return
        else if (practice.state.open) {
          if (practice.state.kind === 'measure' && phase === 'recording') return
          if (phase === 'recording' || trainer.running) practice.actions.stop()
          // A song already playing is stopped, not restarted as a take.
          else if (state.isPlaying) actions.playPause()
          else if (practice.state.micReady) practice.actions.start()
          // Without a microphone there is no take, but the song still plays.
          else if (state.canPlay) actions.playPause()
        } else if (state.canPlay) actions.playPause()
        return
      }
      // A take or wait mode owns the position until it ends.
      if (practiceBusy) return
      if (action === 'restart') {
        actions.restart()
        return
      }
      // During a run-up the position is before the selection, which is what to move on from.
      const section = nextSection(state.sections, actions.selection()?.last ?? state.currentBar)
      if (!section) return
      if (state.hasLoopRange) actions.selectBars(section.startBar, section.endBar, false)
      else actions.jumpToBar(section.startBar)
    }
  })
  const pedalsOn = ready && !editing && !tuner.state.open
  useEffect(() => {
    if (!pedalsOn) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (isTyping(target) || document.querySelector('dialog[open]')) return
      // A focused slider or list keeps the keys it is used with, and only those:
      // Page Down would otherwise change the tempo as well as start the song.
      if (target instanceof HTMLElement && target.matches('input[type="range"], select') && isControlKey(event.code)) return
      const action = pedalKeyAction(event, pedalKeys)
      if (!action) return
      // Held, the key must not scroll the tab either.
      event.preventDefault()
      if (!event.repeat) pedal.current(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pedalKeys, pedalsOn])

  // On an iPhone the song would follow the silent switch unless the page
  // asks to be treated as media playback, which needs a tap or key press.
  useEffect(() => {
    window.addEventListener('pointerdown', preferPlayback, true)
    window.addEventListener('keydown', preferPlayback, true)
    return () => {
      window.removeEventListener('pointerdown', preferPlayback, true)
      window.removeEventListener('keydown', preferPlayback, true)
    }
  }, [])

  // Dropping files anywhere on the window adds them.
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth++
      setDragging(true)
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      void addFiles(Array.from(event.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [addFiles])

  /** Opens a step of today's plan: its song, track, bars on a loop and tempo, with practice ready. */
  const runPlanStep = async (step: PlanStep) => {
    // A second press while the first is still adding the exercise would add it twice.
    if (startingStep.current) return
    startingStep.current = true
    try {
      let song = step.exercise
        ? library.songs?.find((item) => item.fileName === step.exercise?.fileName)
        : library.songs?.find((item) => item.id === step.songId)
      if (!song && step.exercise) {
        const exercise = EXERCISES.find((item) => item.id === step.exercise?.id)
        if (exercise) {
          const built = buildExercise(exercise, initialValues(exercise))
          const file = built.data.buffer.slice(
            built.data.byteOffset,
            built.data.byteOffset + built.data.byteLength,
          ) as ArrayBuffer
          song = await addSong({ title: built.title, artist: 'Exercise', fileName: built.fileName, data: file })
          await library.refresh()
        }
      }
      if (!song) {
        setNotice(`"${step.title}" is no longer in the library.`)
        return
      }
      if (tuner.state.open) tuner.actions.close()
      // Another track must be drawn before its bars can be selected, so it is opened afresh, as
      // is a first go at a song, whose first notes are only found on loading, and discarded edits.
      const inPlace =
        song.id === songIdRef.current &&
        step.kind !== 'new' &&
        !editorDirty &&
        (step.trackIndex === null || step.trackIndex === state.activeTrack)
      if (inPlace) {
        setPlanStepId(step.id)
        setPlanKeeps((kept) => ({
          speed: kept?.holdSpeed ? kept.speed : state.speed,
          stepSpeed: clampSpeed(step.speed ?? state.speed),
          holdSpeed: true,
          trackIndex: kept?.holdTrack ? kept.trackIndex : state.activeTrack,
          stepTrack: kept?.holdTrack ? kept.stepTrack : state.activeTrack,
          holdTrack: true,
        }))
        editor.actions.close()
        actions.stop()
        if (step.speed !== null) actions.setSpeed(step.speed)
        if (step.bars) {
          const count = api?.score?.masterBars.length ?? 0
          if (count > 0) {
            const first = Math.min(step.bars.first, count - 1)
            actions.selectBars(first, Math.min(Math.max(first, step.bars.last), count - 1), true)
          }
        } else {
          actions.clearLoopRange()
          actions.setLooping(false)
        }
        if (practice.state.phase === 'results' || practice.state.waitSummary) practice.actions.dismissResult()
      } else {
        // Results and the microphone belong to the song being left.
        if (practice.state.open) practice.actions.closePanel()
        if (!(await openNow(song, false, step))) return
      }
      practice.actions.openPanel()
      // The panel takes height from the tab, which can push the bars out of view.
      if (inPlace) window.requestAnimationFrame(() => actions.revealPosition())
    } catch {
      setNotice('The exercise could not be saved in this browser.')
    } finally {
      startingStep.current = false
    }
  }
  const startPlanStep = (step: PlanStep) => guardEdits(() => void runPlanStep(step))

  const planStepIndex = plan.steps.findIndex((step) => step.id === planStepId)
  const planStep = planStepIndex >= 0 ? plan.steps[planStepIndex] : null
  /** The next step still to do after the current one, going round to any left earlier in the plan. */
  const nextPlanStep = planStep
    ? [...plan.steps.slice(planStepIndex + 1), ...plan.steps.slice(0, planStepIndex)].find(
        (step) => !plan.done.has(step.id) && !plan.skipped.has(step.id),
      )
    : undefined
  const movePlanOn = () => {
    if (!planStep) return
    // Asked first: choosing Cancel leaves the step as it was.
    guardEdits(() => {
      if (!plan.done.has(planStep.id)) plan.skip(planStep.id)
      if (nextPlanStep) void runPlanStep(nextPlanStep)
      else leaveSong()
    })
  }

  /** Asks what to put in a drill of the selected bars, or of the current bar when none are selected. */
  const startDrill = () => {
    const score = api?.score
    if (!score) return
    const selected = actions.selection()
    const first = selected?.first ?? state.currentBar
    const last = selected?.last ?? state.currentBar
    // The bars on screen are only those of the saved song once the edits are saved or undone.
    const options: DrillOptions = editorDirty
      ? { problem: 'Save or undo your edits first, so the drill is made from the notes you keep.', rhythms: false, strings: false, leftOutPickup: false }
      : drillOptions(score, state.activeTrack, first, last)
    setDrillSource({ first, last, options })
  }
  const createDrill = async (choices: DrillChoices): Promise<string | void> => {
    const score = api?.score
    const id = songIdRef.current
    if (!score || !id || !drillSource) return 'The song is no longer open.'
    const { first, last } = drillSource
    const built = buildDrill(score, { songId: id, trackIndex: state.activeTrack, first, last }, choices)
    let song = library.songs?.find((item) => item.fileName === built.fileName)
    if (!song) {
      const data = built.data.buffer.slice(built.data.byteOffset, built.data.byteOffset + built.data.byteLength) as ArrayBuffer
      song = await addSong({ title: built.title, artist: 'Exercise', fileName: built.fileName, data })
    }
    // Drilled in the tuning the guitar is in now.
    await saveSongPitch(song.id, state.pitch)
    await library.refresh()
    if (practice.state.open) practice.actions.closePanel()
    await openNow(song)
  }

  const openPicker = () => fileInput.current?.click()
  const message = notice ?? (inPlayer ? state.error : null)

  return (
    <div className={['app', tracksOpen ? 'tracks-open' : '', immersive ? 'immersive' : ''].filter(Boolean).join(' ')}>
      <header className="topbar">
        {inPlayer ? (
          <>
            <button type="button" className="button" onClick={backToLibrary}>
              <Icon name="back" />
              <span className="button-label">Library</span>
            </button>
            {ready && (
              <button
                type="button"
                className="icon-button tracks-toggle"
                aria-label="Tracks"
                aria-expanded={tracksOpen}
                onClick={() => setTracksOpen((isOpen) => !isOpen)}
              >
                <Icon name="tracks" />
              </button>
            )}
          </>
        ) : (
          <span className="brand">
            <Icon name="notation" size={20} />
            RiffMaster
          </span>
        )}
        <div className="song">
          {ready && (
            <>
              <span className="song-title">{state.title}</span>
              {state.artist && <span className="song-artist">{state.artist}</span>}
            </>
          )}
        </div>
        <SyncButton />
        <ThemeToggle />
        <input
          ref={fileInput}
          type="file"
          accept={PICKER_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            void addFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
      </header>

      {message && (
        <div className="error" role="alert">
          <span>{message}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => {
              setNotice(null)
              actions.dismissError()
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {!window.isSecureContext && !closed.has('insecure') && (
        <div className="error" role="status">
          <span>
            This page was opened without HTTPS, so the browser blocks the microphone: practice
            and the tuner will not work. On a phone, use the https:// address (see "On a phone" in the README).
          </span>
          {closeButton('insecure')}
        </div>
      )}
      {library.blocked && !closed.has('blocked') && (
        <div className="error" role="alert">
          <span>
            The app was updated, and another tab still has the old version open. Close the other
            tabs of this app and the library will appear.
          </span>
          {closeButton('blocked')}
        </div>
      )}
      {library.storageError && !closed.has('storage') && (
        <div className="error" role="alert">
          <span>
            This browser is not letting the app save songs, so the library is unavailable. Private
            browsing windows often block this.
          </span>
          {closeButton('storage')}
        </div>
      )}

      {/* The player stays mounted behind the library so its sounds stay loaded.
          It is hidden without collapsing, because the score cannot be laid
          out in an element that has no width. */}
      <div
        className={['body', inPlayer ? '' : 'parked', practiceBusy ? 'locked' : '', editor.state.active ? 'editing' : '', state.isPlaying ? 'playing' : '']
          .filter(Boolean)
          .join(' ')}
        inert={!inPlayer}
      >
        {/* Slid out of view on a narrow screen, the list must not take keyboard focus either. */}
        <aside className="sidebar" aria-label="Tracks and sections" inert={narrow && !tracksOpen}>
          <h2>Tracks</h2>
          {ready && (
            <label className="master-volume">
              <span>Volume</span>
              <input
                type="range"
                min={0}
                max={MAX_VOLUME}
                step={0.05}
                value={state.masterVolume}
                aria-valuetext={`${Math.round(state.masterVolume * 100)}%`}
                onChange={(event) => actions.setMasterVolume(Number(event.target.value))}
              />
              <span className="volume-value">{Math.round(state.masterVolume * 100)}%</span>
            </label>
          )}
          {ready && (
            <TuningPicker
              tuning={activeTrack?.tuning ?? []}
              pitch={state.pitch}
              onChange={actions.setPitch}
              disabled={practiceBusy}
            />
          )}
          {ready && (
            <TrackList
              tracks={state.tracks}
              activeTrack={state.activeTrack}
              actions={actions}
              locked={practiceBusy}
              onPick={() => setTracksOpen(false)}
            />
          )}
          {ready && state.sections.length > 0 && (
            <>
              <h2 className="sidebar-next">Sections</h2>
              <SectionList
                sections={state.sections}
                currentBar={state.currentBar}
                locked={practiceBusy}
                onJump={(section) => {
                  actions.jumpToBar(section.startBar)
                  setTracksOpen(false)
                }}
                onLoop={(section) => {
                  actions.selectBars(section.startBar, section.endBar, true)
                  setTracksOpen(false)
                }}
              />
            </>
          )}
        </aside>
        <main className="viewport" ref={viewportRef}>
          {!ready && (
            <div className="empty">
              <p>Opening…</p>
            </div>
          )}
          <div className="score-wrap">
            <div className="score" ref={scoreRef} />
            <div className="fingers" ref={fingersRef} aria-hidden="true" />
            <div className="marks" ref={marksRef} aria-hidden="true" />
            <div className="edit-layer" ref={editLayerRef} aria-hidden="true" hidden />
          </div>
        </main>
      </div>

      {!inPlayer && (
        <LibraryView
          songs={library.songs}
          practice={library.practice}
          busy={busy}
          onOpen={(song) => open(song)}
          onAdd={openPicker}
          onNew={() => setNewTabOpen(true)}
          onExercises={() => setExercisesOpen(true)}
          onDelete={(song) => {
            if (window.confirm(`Remove "${song.title}" from the library?`)) {
              void library.remove(song.id)
            }
          }}
          plan={
            <PlanCard
              steps={plan.steps}
              done={plan.done}
              skipped={plan.skipped}
              minutes={plan.minutes}
              disabled={busy}
              onMinutes={plan.setMinutes}
              onStart={startPlanStep}
            />
          }
        />
      )}

      {ready && !state.canPlay && (
        <div className="sound-progress" role="status">
          Loading sounds… {Math.round(state.soundProgress * 100)}%
        </div>
      )}

      {ready && fretboardOpen && (
        <Fretboard
          api={api}
          track={activeTrack}
          isPlaying={state.isPlaying}
          tick={state.currentTick}
          fingerings={fingerings}
          pitch={state.pitch}
        />
      )}

      {ready && tuner.state.open && (
        <TunerPanel state={tuner.state} tuning={guitarTuning} />
      )}

      {ready && planStep && (
        <PlanBar
          key={planStep.id}
          step={planStep}
          number={planStepIndex + 1}
          total={plan.steps.length}
          done={plan.done.has(planStep.id)}
          hasNext={nextPlanStep !== undefined}
          locked={practiceBusy}
          onNext={movePlanOn}
          onEnd={() => setPlanStepId(null)}
        />
      )}

      {ready && planStepId !== null && !planStep && (
        <div className="plan-bar" role="status">
          <span className="plan-bar-text">This step is no longer in today&apos;s plan: the tab or the day changed.</span>
          <button type="button" className="icon-button" aria-label="Leave the plan" onClick={() => setPlanStepId(null)}>
            <Icon name="close" />
          </button>
        </div>
      )}

      {ready && picking && (
        <div className="picking-hint" role="status">
          {picking.first === null
            ? 'Tap the first bar to select.'
            : `Bar ${picking.first + 1}. Now tap the last bar, or the same one again for just this bar. Turn on Loop to repeat it.`}
        </div>
      )}

      {ready && editor.state.active && (
        <EditorPanel
          state={editor.state}
          actions={editor.actions}
          score={api?.score ?? null}
          hasOriginal={hasOriginalFile}
          onRestoreOriginal={() => void restoreOriginalFile()}
          onClose={editor.actions.close}
        />
      )}

      {ready && practice.state.open && (
        <PracticePanel
          state={practice.state}
          actions={practice.actions}
          speed={state.speed}
          takes={trackTakes}
          onDrill={startDrill}
          onLoopBar={(bar) => actions.selectBars(bar, bar, true)}
          onClearHistory={() => {
            const id = songId
            const trackIndex = state.activeTrack
            if (!id || !window.confirm('Clear the practice history of this track?')) return
            void clearTakes(id, trackIndex).then(
              () => setTakes((list) => list.filter((take) => take.trackIndex !== trackIndex)),
              () => setNotice('The practice history could not be cleared.'),
            )
          }}
        />
      )}

      {inPlayer && (
        <Transport
          state={state}
          actions={actions}
          practiceOpen={practice.state.open}
          practiceBusy={practiceBusy}
          onTogglePractice={togglePractice}
          fretboardOpen={fretboardOpen}
          onToggleFretboard={toggleFretboard}
          fingeringOn={fingeringOn}
          onToggleFingering={toggleFingering}
          tunerOpen={tuner.state.open}
          onToggleTuner={toggleTuner}
          editorOpen={editor.state.active}
          onToggleEditor={toggleEditor}
          onPedal={() => setPedalOpen(true)}
          picking={picking}
        />
      )}

      {newTabOpen && (
        <NewTabDialog
          onClose={() => setNewTabOpen(false)}
          onCreate={async (data, title, artist) => {
            try {
              const song = await addSong({ title, artist, fileName: `${title}.gp`, data })
              await library.refresh()
              setNewTabOpen(false)
              open(song, true)
            } catch {
              return 'The tab could not be saved in this browser.'
            }
          }}
        />
      )}

      {exercisesOpen && (
        <ExerciseDialog
          onClose={() => setExercisesOpen(false)}
          onOpen={async ({ title, fileName, data }) => {
            // An exercise opened before is found again by its file name, so
            // its practice history and any edits made to it are kept.
            const known = library.songs?.find((song) => song.fileName === fileName)
            if (known) {
              open(known)
              return
            }
            try {
              const file = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
              const song = await addSong({ title, artist: 'Exercise', fileName, data: file })
              await library.refresh()
              open(song)
            } catch {
              return 'The exercise could not be saved in this browser.'
            }
          }}
        />
      )}

      {pedalOpen && (
        <PedalDialog
          keys={pedalKeys}
          onChange={(keys) => {
            setPedalKeys(keys)
            savePedalKeys(keys)
          }}
          onClose={() => setPedalOpen(false)}
        />
      )}

      {drillSource && (
        <DrillDialog
          label={
            drillSource.first === drillSource.last
              ? `Bar ${drillSource.first + 1}`
              : `Bars ${drillSource.first + 1}–${drillSource.last + 1}`
          }
          options={drillSource.options}
          onCreate={createDrill}
          onClose={() => setDrillSource(null)}
        />
      )}

      {leaving && (
        <ChoiceDialog
          title="Save your changes?"
          onClose={() => setLeaving(null)}
          choices={[
            { label: 'Cancel', onChoose: () => setLeaving(null) },
            {
              label: 'Discard',
              onChoose: () => {
                const { then } = leaving
                setLeaving(null)
                then()
              },
            },
            {
              label: 'Save',
              primary: true,
              onChoose: () => {
                const { then } = leaving
                setLeaving(null)
                void editor.actions.save().then((saved) => {
                  if (saved) then()
                })
              },
            },
          ]}
        >
          “{state.title}” has edits that are not saved yet.
        </ChoiceDialog>
      )}

      {immersive && !practice.state.open && (
        <button type="button" className="float-pause" aria-label="Pause" title="Pause and show the controls" onClick={actions.playPause}>
          <Icon name="pause" size={20} />
        </button>
      )}
      {immersive && practice.state.open && (
        <div className="float-practice">
          <button
            type="button"
            className="float-pause"
            aria-label={practice.state.trainer.running ? 'Stop trainer' : 'Stop practice'}
            title={practice.state.trainer.running ? 'Stop the trainer and show the controls' : 'Stop the take and show the controls'}
            onClick={practice.actions.stop}
          >
            <Icon name="stop" size={18} />
          </button>
          {practice.state.live && (
            <span className="float-live" role="status">
              {practice.state.live.hit} / {practice.state.live.total} notes
            </span>
          )}
        </div>
      )}

      {dragging && <div className="drop-overlay">Drop to add to your library</div>}
    </div>
  )
}
