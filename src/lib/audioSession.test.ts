import { afterEach, describe, expect, it, vi } from 'vitest'

const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

/** A fresh copy of the module, so its silent <audio> element starts out unmade. */
async function load() {
  vi.resetModules()
  return import('./audioSession')
}

afterEach(() => vi.unstubAllGlobals())

describe('audio session on iPhone', () => {
  it('asks for media playback, so the silent switch does not mute the song', async () => {
    const session = { type: 'auto' }
    vi.stubGlobal('navigator', { userAgent: iPhone, platform: 'iPhone', maxTouchPoints: 5, audioSession: session })
    const { preferPlayback, allowRecording, recordingEnded } = await load()
    preferPlayback()
    expect(session.type).toBe('playback')
    // While the microphone is open, playback and recording go together.
    allowRecording()
    preferPlayback()
    expect(session.type).toBe('play-and-record')
    recordingEnded()
    expect(session.type).toBe('playback')
  })

  it('falls back to a silent looping <audio> element on older iOS', async () => {
    const played: { src: string; loop: boolean }[] = []
    class FakeAudio {
      loop = false
      paused = true
      readonly src: string
      constructor(src: string) {
        this.src = src
      }
      setAttribute() {}
      play() {
        this.paused = false
        played.push({ src: this.src, loop: this.loop })
        return Promise.resolve()
      }
      pause() {
        this.paused = true
      }
    }
    vi.stubGlobal('navigator', { userAgent: iPhone, platform: 'iPhone', maxTouchPoints: 5 })
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('document', { addEventListener: () => {}, hidden: false })
    const { preferPlayback } = await load()
    preferPlayback()
    preferPlayback()
    expect(played).toHaveLength(1)
    expect(played[0].loop).toBe(true)
    expect(played[0].src.startsWith('data:audio/wav;base64,UklGR')).toBe(true)
  })

  it('leaves other devices alone', async () => {
    const Audio = vi.fn()
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', maxTouchPoints: 0 })
    vi.stubGlobal('Audio', Audio)
    const { preferPlayback } = await load()
    preferPlayback()
    expect(Audio).not.toHaveBeenCalled()
  })
})
