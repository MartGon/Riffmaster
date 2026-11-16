import { TIMING_LEEWAYS, type TimingLeeway } from './matching'
import { defaultTrainerSettings, TRAINER_STEPS, TRAINER_THRESHOLDS, type TrainerSettings } from './trainer'

/** How the delay between the tab and the microphone is worked out. */
export type CalibrationMode = 'auto' | 'measured'

/**
 * Practice settings for this device. They are never synced: every device
 * has its own inputs and its own delays.
 */
export interface PracticeSettings {
  inputId: string | null
  mode: CalibrationMode
  /** Delay in ms measured with the earbud test, per input device. */
  measured: Record<string, number>
  /** Delay in ms learned from the last take, per input device; a starting point for the next one. */
  learned: Record<string, number>
  trainer: TrainerSettings
  /** Whether results are marked on the notes while the song is still playing. */
  liveMarks: boolean
  /** How strictly timing is judged. */
  leeway: TimingLeeway
}

const KEY = 'riffmaster.practice'
const defaults: PracticeSettings = {
  inputId: null,
  mode: 'auto',
  measured: {},
  learned: {},
  trainer: { ...defaultTrainerSettings },
  liveMarks: true,
  leeway: 'normal',
}

function readTrainer(stored: Partial<TrainerSettings> | undefined): TrainerSettings {
  return {
    enabled: stored?.enabled === true,
    threshold: TRAINER_THRESHOLDS.includes(stored?.threshold ?? -1)
      ? stored!.threshold!
      : defaultTrainerSettings.threshold,
    step: TRAINER_STEPS.includes(stored?.step ?? -1) ? stored!.step! : defaultTrainerSettings.step,
  }
}

export function loadPracticeSettings(): PracticeSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PracticeSettings>
    return {
      inputId: typeof stored.inputId === 'string' ? stored.inputId : null,
      mode: stored.mode === 'measured' ? 'measured' : 'auto',
      measured: { ...stored.measured },
      learned: { ...stored.learned },
      trainer: readTrainer(stored.trainer),
      liveMarks: stored.liveMarks !== false,
      leeway: TIMING_LEEWAYS.some((item) => item.id === stored.leeway) ? stored.leeway! : 'normal',
    }
  } catch {
    return { ...defaults, trainer: { ...defaultTrainerSettings } }
  }
}

export function savePracticeSettings(settings: PracticeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Without storage the settings last for this visit only.
  }
}
