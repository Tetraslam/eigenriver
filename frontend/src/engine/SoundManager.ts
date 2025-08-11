export class SoundManager {
  private audioContext: AudioContext
  private sounds: Map<string, AudioBuffer> = new Map()
  private playingInstances: Set<AudioBufferSourceNode> = new Set()
  private masterVolume = 0.3
  private lastPlayTimes: Map<string, number> = new Map()
  private enabled = true
  
  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  
  async init() {
    // Load sound files
    const soundFiles = [
      { name: 'laser1', path: '/laser1.wav' },
      { name: 'laser2', path: '/laser2.wav' },
      { name: 'laser3', path: '/laser3.wav' }
    ]
    
    for (const { name, path } of soundFiles) {
      try {
        const response = await fetch(path)
        const arrayBuffer = await response.arrayBuffer()
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
        this.sounds.set(name, audioBuffer)
        console.log(`[SoundManager] Loaded ${name}`)
      } catch (err) {
        console.error(`[SoundManager] Failed to load ${name}:`, err)
      }
    }
    
    // Generate some procedural sounds
    this.generateSquadSpawnSound()
    this.generateWaveStartSound()
    this.generateVictorySound()
  }
  
  private generateSquadSpawnSound() {
    // Create a "power up" sound
    const sampleRate = this.audioContext.sampleRate
    const duration = 0.5
    const buffer = this.audioContext.createBuffer(2, sampleRate * duration, sampleRate)
    
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate
        // Rising frequency sweep
        const freq = 200 + t * 800
        const envelope = Math.sin(Math.PI * t / duration) * (1 - t / duration)
        data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.3
      }
    }
    
    this.sounds.set('squadSpawn', buffer)
  }
  
  private generateWaveStartSound() {
    // Create an alarm/warning sound
    const sampleRate = this.audioContext.sampleRate
    const duration = 1
    const buffer = this.audioContext.createBuffer(2, sampleRate * duration, sampleRate)
    
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate
        // Alternating tones
        const freq = t < 0.5 ? 440 : 330
        const envelope = 0.5 * (1 - t / duration)
        data[i] = Math.sign(Math.sin(2 * Math.PI * freq * t)) * envelope * 0.2
      }
    }
    
    this.sounds.set('waveStart', buffer)
  }
  
  private generateVictorySound() {
    // Create a victory fanfare
    const sampleRate = this.audioContext.sampleRate
    const duration = 0.8
    const buffer = this.audioContext.createBuffer(2, sampleRate * duration, sampleRate)
    
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate
        // Major chord arpeggio
        const notes = [261.63, 329.63, 392.00, 523.25]  // C E G C
        const noteIndex = Math.floor(t * 8) % 4
        const freq = notes[noteIndex]
        const envelope = Math.exp(-t * 2) * 0.5
        data[i] = Math.sin(2 * Math.PI * freq * t) * envelope
      }
    }
    
    this.sounds.set('victory', buffer)
  }
  
  play(soundName: string, options: {
    volume?: number,
    pitch?: number,
    delay?: number,
    minInterval?: number
  } = {}) {
    if (!this.enabled) return
    
    const buffer = this.sounds.get(soundName)
    if (!buffer) {
      console.warn(`[SoundManager] Sound not found: ${soundName}`)
      return
    }
    
    // Check minimum interval between plays
    if (options.minInterval) {
      const lastPlay = this.lastPlayTimes.get(soundName) || 0
      const now = Date.now()
      if (now - lastPlay < options.minInterval) {
        return  // Too soon to play again
      }
      this.lastPlayTimes.set(soundName, now)
    }
    
    // Create source
    const source = this.audioContext.createBufferSource()
    source.buffer = buffer
    
    // Create gain node for volume control
    const gainNode = this.audioContext.createGain()
    gainNode.gain.value = (options.volume || 1) * this.masterVolume
    
    // Connect nodes
    source.connect(gainNode)
    gainNode.connect(this.audioContext.destination)
    
    // Set pitch
    if (options.pitch) {
      source.playbackRate.value = options.pitch
    }
    
    // Track playing instance
    this.playingInstances.add(source)
    source.onended = () => {
      this.playingInstances.delete(source)
    }
    
    // Play
    const startTime = this.audioContext.currentTime + (options.delay || 0)
    source.start(startTime)
  }
  
  playLaser(type: 'player' | 'enemy' = 'player') {
    // Randomly select laser sound and vary pitch
    const laserSounds = ['laser1', 'laser2', 'laser3']
    const sound = laserSounds[Math.floor(Math.random() * laserSounds.length)]
    
    this.play(sound, {
      volume: type === 'player' ? 0.1 : 0.05,
      pitch: 0.8 + Math.random() * 0.4,
      minInterval: type === 'player' ? 50 : 100  // Limit frequency
    })
  }
  
  playSquadSpawn() {
    this.play('squadSpawn', { volume: 0.5 })
  }
  
  playWaveStart() {
    this.play('waveStart', { volume: 0.4 })
  }
  
  playVictory() {
    this.play('victory', { volume: 0.6 })
  }
  
  // Voice announcements using speech synthesis
  announce(text: string, options: {
    rate?: number,
    pitch?: number,
    volume?: number
  } = {}) {
    if (!this.enabled || !window.speechSynthesis) return
    
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = options.rate || 1.2
    utterance.pitch = options.pitch || 0.9
    utterance.volume = (options.volume || 0.5) * this.masterVolume
    
    // Use a robotic voice if available
    const voices = window.speechSynthesis.getVoices()
    const robotVoice = voices.find(v => v.name.includes('Google UK English Male')) ||
                      voices.find(v => v.name.includes('Microsoft David')) ||
                      voices[0]
    if (robotVoice) {
      utterance.voice = robotVoice
    }
    
    window.speechSynthesis.speak(utterance)
  }
  
  setMasterVolume(volume: number) {
    this.masterVolume = Math.max(0, Math.min(1, volume))
  }
  
  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) {
      // Stop all playing sounds
      for (const source of this.playingInstances) {
        source.stop()
      }
      this.playingInstances.clear()
    }
  }
  
  // Clean up
  dispose() {
    for (const source of this.playingInstances) {
      source.stop()
    }
    this.playingInstances.clear()
    this.audioContext.close()
  }
}
