import { allowRecording, recordingEnded } from '../lib/audioSession'
export interface InputDevice {
  id: string
  label: string
}

// The capture code runs on the audio thread. It is kept as text so it can be
// loaded from memory, which also works offline.
const WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(512)
    this.fill = 0
    this.start = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    if (this.fill === 0) this.start = currentFrame
    this.buffer.set(channel, this.fill)
    this.fill += channel.length
    if (this.fill >= this.buffer.length) {
      this.port.postMessage({ frame: this.start, samples: this.buffer.slice(0, this.fill) })
      this.fill = 0
    }
    return true
  }
}
registerProcessor('riffmaster-capture', CaptureProcessor)
`

/** Audio inputs the browser knows about. Labels are only available once access has been granted. */
export async function listInputs(): Promise<InputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }))
}

export interface MicBlock {
  samples: Float32Array
  /** Position of the block's first sample, in samples since the input was opened. */
  frame: number
}

/**
 * An open microphone or audio-interface input, delivering raw mono samples.
 * The browser's voice processing is switched off because it distorts an
 * instrument: echo cancellation, noise suppression and automatic gain.
 */
export class MicInput {
  readonly sampleRate: number
  /** The device actually opened, which can differ from the one asked for. */
  readonly deviceId: string
  /** The device's name, and the settings the browser opened it with. */
  readonly label: string
  readonly trackSettings: MediaTrackSettings
  private readonly context: AudioContext
  private readonly stream: MediaStream
  private firstFrame: number | null = null
  /** Smallest observed gap between the page clock and the audio clock, in ms. */
  private clockOffsetMs = Infinity
  onBlock: ((block: MicBlock) => void) | null = null

  private constructor(context: AudioContext, stream: MediaStream, node: AudioWorkletNode) {
    this.context = context
    this.stream = stream
    this.sampleRate = context.sampleRate
    const track = stream.getAudioTracks()[0]
    this.trackSettings = track?.getSettings() ?? {}
    this.deviceId = this.trackSettings.deviceId ?? ''
    this.label = track?.label ?? ''
    node.port.onmessage = (event: MessageEvent<{ frame: number; samples: Float32Array }>) => {
      const { frame, samples } = event.data
      this.firstFrame ??= frame
      // A block can only arrive late, never early, so the smallest gap seen
      // is the best estimate of how the two clocks line up.
      const endMs = ((frame + samples.length) / this.sampleRate) * 1000
      this.clockOffsetMs = Math.min(this.clockOffsetMs, performance.now() - endMs)
      this.onBlock?.({ samples, frame: frame - this.firstFrame })
    }
  }

  static async open(deviceId: string | null): Promise<MicInput> {
    // Tells iOS that playback and recording happen together, so it does not
    // switch the whole device into a phone-call audio mode.
    allowRecording()

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    })
    try {
      const context = new AudioContext({ latencyHint: 'interactive' })
      const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      try {
        await context.audioWorklet.addModule(moduleUrl)
      } finally {
        URL.revokeObjectURL(moduleUrl)
      }
      const node = new AudioWorkletNode(context, 'riffmaster-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
      })
      context.createMediaStreamSource(stream).connect(node)
      if (context.state === 'suspended') await context.resume()
      return new MicInput(context, stream, node)
    } catch (error) {
      for (const track of stream.getTracks()) track.stop()
      throw error
    }
  }

  /**
   * Converts a position in the captured audio (seconds since the input was
   * opened) to the page's clock (`performance.now()`), in milliseconds.
   */
  toPageTimeMs(secondsSinceOpen: number): number {
    const first = (this.firstFrame ?? 0) / this.sampleRate
    return (first + secondsSinceOpen) * 1000 + (Number.isFinite(this.clockOffsetMs) ? this.clockOffsetMs : 0)
  }

  /** The reverse of toPageTimeMs: where a moment on the page's clock falls in the captured audio, in seconds. */
  fromPageTimeMs(pageMs: number): number {
    const first = (this.firstFrame ?? 0) / this.sampleRate
    return (pageMs - (Number.isFinite(this.clockOffsetMs) ? this.clockOffsetMs : 0)) / 1000 - first
  }

  close(): void {
    this.onBlock = null
    for (const track of this.stream.getTracks()) track.stop()
    void this.context.close()
    recordingEnded()
  }
}
