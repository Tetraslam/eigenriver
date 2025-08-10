export type VadOptions = {
  aggressiveness?: 0|1|2|3
  frameMs?: number
  hangoverMs?: number
}

export type VadCallbacks = {
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onFrame?: (pcm: Int16Array) => void
}

// Simple getUserMedia + ScriptProcessor to slice PCM frames. We assume VAD gating is done client-side
// using WebRTC VAD on server or a small heuristic; to keep time, we gate by RMS threshold.

export async function startMicVad(cb: VadCallbacks, opts: VadOptions = {}) {
  const targetRate = 16000
  const frameMs = opts.frameMs ?? 80
  const hangoverMs = opts.hangoverMs ?? 600
  const ctx = new AudioContext() // use device/default rate to avoid cross-rate connect errors
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
  const src = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)

  const inputRate = ctx.sampleRate
  const targetSamplesPerFrame = Math.floor(targetRate * frameMs / 1000)

  // Resampler state
  let bufIn = new Float32Array(0)
  let pos = 0 // fractional position within bufIn (in input samples)
  let outCarry = new Int16Array(0)

  let speaking = false
  let lastVoiceTs = 0

  function resampleLinear(input: Float32Array): Int16Array {
    // Append input to bufIn
    const merged = new Float32Array(bufIn.length + input.length)
    merged.set(bufIn, 0)
    merged.set(input, bufIn.length)
    bufIn = merged

    const ratio = inputRate / targetRate
    const outLen = Math.max(0, Math.floor((bufIn.length - 1 - pos) / ratio))
    const out = new Int16Array(outLen)
    let outIndex = 0
    while (outIndex < outLen) {
      const i = Math.floor(pos)
      const frac = pos - i
      const s0 = bufIn[i]
      const s1 = bufIn[i + 1]
      const sample = s0 + (s1 - s0) * frac
      const s = Math.max(-1, Math.min(1, sample))
      out[outIndex++] = (s * 32767) | 0
      pos += ratio
    }
    // Drop consumed input samples
    const consumed = Math.floor(pos)
    bufIn = bufIn.subarray(consumed)
    pos -= consumed
    return out
  }

  processor.onaudioprocess = (e) => {
    const ch = e.inputBuffer.getChannelData(0)
    // Voice gate on input-rate audio
    const rms = Math.sqrt(ch.reduce((s, x) => s + x * x, 0) / ch.length)
    const voiced = rms > 0.02
    if (voiced) lastVoiceTs = performance.now()
    if (!speaking && voiced) { speaking = true; cb.onSpeechStart?.() }
    if (speaking && performance.now() - lastVoiceTs > hangoverMs) { speaking = false; cb.onSpeechEnd?.() }

    // Resample chunk to 16k
    const res = resampleLinear(ch)
    // Frame at target rate and emit
    if (res.length) {
      let work = new Int16Array(outCarry.length + res.length)
      work.set(outCarry, 0)
      work.set(res, outCarry.length)
      let offset = 0
      while (offset + targetSamplesPerFrame <= work.length) {
        const frame = work.subarray(offset, offset + targetSamplesPerFrame)
        if (speaking) cb.onFrame?.(frame)
        offset += targetSamplesPerFrame
      }
      outCarry = work.subarray(offset)
    }
  }

  src.connect(processor)
  processor.connect(ctx.destination)

  return () => {
    processor.disconnect()
    src.disconnect()
    stream.getTracks().forEach(t => t.stop())
    ctx.close()
  }
}


