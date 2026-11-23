import { describe, expect, it } from 'vitest'
import { WaitFollower } from './waitMode'

const single = (midi: number, bar = 0) => ({ timeMs: 0, midi: [midi], bar })
const chord = (midi: number[], bar = 0) => ({ timeMs: 0, midi, bar })
const outcomes = (list: { outcome: string }[]) => list.map((item) => item.outcome)

function play(follower: WaitFollower<ReturnType<typeof single>>, timeSec: number, midi: number, present?: number[]) {
  follower.hear({ timeSec, midi: [midi], present })
  return follower.settle(timeSec + 0.05)
}

describe('wait mode', () => {
  it('holds until the right note, however long it takes', () => {
    const follower = new WaitFollower([single(60), single(62)], false)
    expect(follower.settle(30)).toEqual([])
    expect(follower.index).toBe(0)
    expect(outcomes(play(follower, 31, 60))).toEqual(['firstTry'])
    expect(follower.index).toBe(1)
  })

  it('stays on a note played wrong, and says what it heard', () => {
    const follower = new WaitFollower([single(60), single(62)], false)
    expect(play(follower, 1, 65)).toEqual([])
    expect(follower.index).toBe(0)
    expect(follower.wrong).toBe(65)
    expect(outcomes(play(follower, 2, 60))).toEqual(['retried'])
    expect(follower.wrong).toBeNull()
  })

  it('does not take one attack for two notes of the same pitch', () => {
    const follower = new WaitFollower([single(60), single(60)], false)
    follower.hear({ timeSec: 1, midi: [60] })
    follower.hear({ timeSec: 1.03, midi: [60] })
    expect(outcomes(follower.settle(1.1))).toEqual(['firstTry'])
    expect(follower.index).toBe(1)
    expect(outcomes(play(follower, 1.5, 60))).toEqual(['firstTry'])
  })

  it('does not blame the next note for the last one still ringing', () => {
    const follower = new WaitFollower([single(60), single(62), single(64)], false)
    play(follower, 1, 60)
    play(follower, 1.12, 67)
    expect(follower.hasTried).toBe(false)
    play(follower, 1.5, 67)
    expect(follower.hasTried).toBe(true)
  })

  it('waits for what sounded with a chord before judging it', () => {
    const follower = new WaitFollower([chord([48, 52, 55]), single(60)], false)
    const note: { timeSec: number; midi: number[]; present?: number[] } = { timeSec: 1, midi: [48] }
    follower.hear(note)
    expect(follower.settle(1.05)).toEqual([])
    note.present = [48, 52, 55]
    expect(outcomes(follower.settle(1.1))).toEqual(['firstTry'])
  })

  it('lets the attacks of a strum add up to a chord without counting a wrong try', () => {
    const follower = new WaitFollower([chord([48, 52, 55]), single(60)], false)
    follower.hear({ timeSec: 1, midi: [48], present: [48] })
    follower.settle(1.05)
    follower.hear({ timeSec: 1.08, midi: [52], present: [48, 52, 55] })
    expect(outcomes(follower.settle(1.15))).toEqual(['firstTry'])
  })

  it('counts a wrong chord as a try once the strum is over', () => {
    const follower = new WaitFollower([chord([48, 52, 55]), single(60)], false)
    follower.hear({ timeSec: 1, midi: [48], present: [48, 51, 55] })
    follower.settle(1.1)
    expect(follower.hasTried).toBe(false)
    follower.settle(1.4)
    expect(follower.hasTried).toBe(true)
    expect(follower.index).toBe(0)
  })

  it('does not let the rest of a strum pass for the next note', () => {
    const follower = new WaitFollower([chord([48, 52, 55]), single(55)], false)
    follower.hear({ timeSec: 1, midi: [48], present: [48, 52, 55] })
    follower.hear({ timeSec: 1.1, midi: [55], present: [48, 52, 55] })
    expect(outcomes(follower.settle(1.2))).toEqual(['firstTry'])
    expect(follower.index).toBe(1)
  })

  it('does not move on for a sound already ringing when it starts', () => {
    const follower = new WaitFollower([single(60), single(62)], false)
    follower.hear({ timeSec: 0.005, midi: [60] })
    expect(follower.settle(0.1)).toEqual([])
    expect(follower.hasTried).toBe(false)
  })

  it('does not take a pitch change with no pick for a picked note', () => {
    const follower = new WaitFollower([single(60), single(62)], false)
    play(follower, 1, 60)
    follower.hear({ timeSec: 1.4, midi: [62], legato: true })
    expect(follower.settle(1.5)).toEqual([])
    expect(follower.index).toBe(1)
    expect(follower.hasTried).toBe(false)
  })

  it('accepts a hammer-on where the tab has one', () => {
    const follower = new WaitFollower([single(60), { ...single(62), legato: true }], false)
    play(follower, 1, 60)
    follower.hear({ timeSec: 1.4, midi: [62], legato: true })
    expect(outcomes(follower.settle(1.5))).toEqual(['firstTry'])
  })

  it('does not count a written grace note as a wrong try', () => {
    const follower = new WaitFollower([{ ...single(62), grace: [60], legato: true }], false)
    play(follower, 1, 60)
    expect(follower.hasTried).toBe(false)
    follower.hear({ timeSec: 1.06, midi: [62], legato: true })
    expect(outcomes(follower.settle(1.2))).toEqual(['firstTry'])
  })

  it('needs a new attack for a repeated chord, not the last one ringing on', () => {
    const c = [48, 52, 55]
    const follower = new WaitFollower([chord(c), chord(c)], false)
    follower.hear({ timeSec: 1, midi: [48], present: c })
    expect(outcomes(follower.settle(1.1))).toEqual(['firstTry'])
    expect(follower.settle(5)).toEqual([])
    expect(follower.index).toBe(1)
    follower.hear({ timeSec: 6, midi: [48], present: c })
    expect(follower.settle(6.1).length).toBe(1)
  })

  it('takes a rolled strum as one chord, however long it rolls', () => {
    const c = [48, 52, 55]
    const follower = new WaitFollower([chord(c), chord(c)], false)
    for (const [i, midi] of c.entries()) follower.hear({ timeSec: 1 + i * 0.05, midi: [midi], present: c })
    follower.hear({ timeSec: 1.15, midi: [60], present: c })
    expect(outcomes(follower.settle(1.3))).toEqual(['firstTry'])
    expect(follower.index).toBe(1)
  })

  it('says when a chord was not complete, rather than naming one of its notes', () => {
    const follower = new WaitFollower([chord([48, 52, 55])], false)
    follower.hear({ timeSec: 1, midi: [48], present: [48, 52] })
    follower.settle(1.4)
    expect(follower.wrong).toBe('chord')
  })

  it('accepts an octave the detector could not tell apart', () => {
    const follower = new WaitFollower([single(60)], false)
    follower.hear({ timeSec: 1, midi: [72, 60] })
    expect(outcomes(follower.settle(1.05))).toEqual(['firstTry'])
  })

  it('skips a note the microphone will not catch, dropping what was heard for it', () => {
    const follower = new WaitFollower([single(60), single(62)], false)
    follower.hear({ timeSec: 1, midi: [62] })
    expect(follower.skip(1.01)?.outcome).toBe('skipped')
    expect(follower.settle(1.5)).toEqual([])
    expect(follower.index).toBe(1)
  })

  it('finishes at the end, or goes round with Loop on', () => {
    const once = new WaitFollower([single(60)], false)
    play(once, 1, 60)
    expect(once.finished).toBe(true)
    expect(once.current).toBeNull()
    const looped = new WaitFollower([single(60), single(62)], true)
    play(looped, 1, 60)
    play(looped, 2, 62)
    expect(looped.finished).toBe(false)
    expect(looped.index).toBe(0)
    expect(looped.summary().passes).toBe(1)
  })

  it('sums up how it went, with the bars that gave trouble', () => {
    const follower = new WaitFollower([single(60, 0), single(62, 1), single(64, 1), single(65, 2)], false)
    play(follower, 1, 60)
    play(follower, 2, 70)
    play(follower, 3, 62)
    follower.skip(4)
    play(follower, 5, 65)
    expect(follower.summary()).toEqual({ notes: 4, firstTry: 2, retried: 1, skipped: 1, passes: 1, troubleBars: [1] })
  })
})
