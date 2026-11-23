import { useCallback, useEffect, useMemo, useState } from 'react'
import { listAllTakes } from '../library/db'
import type { Song, TakeRecord } from '../library/types'
import { buildPlan, completedSteps, DEFAULT_PLAN_MINUTES, PLAN_MINUTES, practiceDay, type SongSizes } from './plan'
import { WARMUPS } from './warmups'

const KEY = 'riffmaster.plan'

interface Stored {
  minutes: number
  /** Steps passed over, which only holds for the day they were passed over on. */
  skippedDay: number | null
  skipped: string[]
  /** Size of each song when last opened on this device. */
  sizes: SongSizes
}

function loadStored(): Stored {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Stored>
    return {
      minutes: PLAN_MINUTES.includes(stored.minutes ?? 0) ? stored.minutes! : DEFAULT_PLAN_MINUTES,
      skippedDay: typeof stored.skippedDay === 'number' ? stored.skippedDay : null,
      skipped: Array.isArray(stored.skipped) ? stored.skipped.filter((id) => typeof id === 'string') : [],
      sizes: stored.sizes && typeof stored.sizes === 'object' ? stored.sizes : {},
    }
  } catch {
    return { minutes: DEFAULT_PLAN_MINUTES, skippedDay: null, skipped: [], sizes: {} }
  }
}

function saveStored(stored: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stored))
  } catch {
    // Storage can be unavailable (private browsing); the choice then lasts for this visit only.
  }
}

/** Today's practice plan, worked out from the library and its practice history. */
export function usePlan(songs: Song[] | null) {
  const [takes, setTakes] = useState<TakeRecord[]>([])
  const [stored, setStored] = useState(loadStored)
  const [now, setNow] = useState(() => Date.now())
  const day = practiceDay(now)

  useEffect(() => saveStored(stored), [stored])

  const refresh = useCallback(async () => {
    try {
      const all = await listAllTakes()
      setTakes(all)
      setNow(Date.now())
    } catch {
      // Without storage there is no history to plan from.
    }
  }, [])

  // The library changes when a song is added or removed, and when sync brings takes from another device.
  useEffect(() => {
    if (!songs) return
    let current = true
    listAllTakes().then(
      (all) => {
        if (!current) return
        setTakes(all)
        setNow(Date.now())
      },
      // Without storage there is no history to plan from.
      () => {},
    )
    return () => {
      current = false
    }
  }, [songs])

  // The plan is for today, also when the app was left open overnight.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    // A tab left open past the end of the practice day moves on to the next.
    const timer = window.setInterval(() => {
      setNow((last) => (practiceDay(Date.now()) === practiceDay(last) ? last : Date.now()))
    }, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])

  const steps = useMemo(
    () => buildPlan(songs ?? [], takes, now, stored.minutes, WARMUPS, stored.sizes),
    [songs, takes, now, stored.minutes, stored.sizes],
  )
  const done = useMemo(() => completedSteps(steps, takes, songs ?? [], now), [steps, takes, songs, now])
  const skipped = useMemo(
    () => new Set(stored.skippedDay === day ? stored.skipped : []),
    [stored.skippedDay, stored.skipped, day],
  )

  const setMinutes = useCallback((minutes: number) => {
    setStored((current) => ({ ...current, minutes }))
  }, [])

  /** Notes a song's saved size: bars or tracks edited away take their history out of the plan. */
  const noteSongSize = useCallback((id: string, bars: number, tracks: number) => {
    setStored((current) => {
      const known = current.sizes[id]
      if (known?.bars === bars && known.tracks === tracks) return current
      return { ...current, sizes: { ...current.sizes, [id]: { bars, tracks } } }
    })
  }, [])

  const skip = useCallback(
    (id: string) => {
      setStored((current) => {
        const kept = current.skippedDay === day ? current.skipped : []
        return { ...current, skippedDay: day, skipped: [...new Set([...kept, id])] }
      })
    },
    [day],
  )

  return { steps, done, skipped, minutes: stored.minutes, setMinutes, skip, noteSongSize, refresh }
}
