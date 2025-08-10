import { useEffect, useRef, useState } from 'react'
import './App.css'
import { AsrWsClient } from './input/asr/wsClient'
import { startMicVad } from './input/vad/webrtc'
import { fetchIntent } from './voice/router'
import { Renderer } from './engine/renderer'
import { GameState } from './engine/gameState'
import { HandTracker } from './input/mediapipe/handTracker'
import { GestureRecognizer } from './input/gestures/recognizer'
import { StartScreen } from './components/StartScreen'
import * as THREE from 'three'

function App() {
  const [status, setStatus] = useState('ready')
  const [finalText, setFinalText] = useState('')
  const [lastIntent, setLastIntent] = useState<string>('')
  const [gesture, setGesture] = useState('')
  const [enemyCount, setEnemyCount] = useState(0)
  const [squadCounts, setSquadCounts] = useState({ alpha: 20, bravo: 20, charlie: 20 })
  const [micActive, setMicActive] = useState(false)
  const [handsActive, setHandsActive] = useState(false)
  const [waveNumber, setWaveNumber] = useState(0)
  const [spawnedThisWave, setSpawnedThisWave] = useState(0)
  const waveIndexRef = useRef(0)
  const [gameStarted, setGameStarted] = useState(false)
  const [selectedSquadState, setSelectedSquadState] = useState<string | null>(null)
  const [voiceMode, setVoiceMode] = useState<'auto' | 'push' | 'off'>('auto')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTimeLeft, setRecordingTimeLeft] = useState(0)
  const [breakTimeLeft, setBreakTimeLeft] = useState(0)
  const [isListeningForCommand, setIsListeningForCommand] = useState(false)
  const [wakeWordActive, setWakeWordActive] = useState(false)

  
  const asr = useRef<AsrWsClient>()
  const stopVad = useRef<() => void>()
  const connected = useRef<boolean>(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const gameStateRef = useRef<GameState | null>(null)
  const handTracker = useRef<HandTracker | null>(null)
  const gestureRec = useRef<GestureRecognizer | null>(null)
  const selectedSquad = useRef<'alpha' | 'bravo' | 'charlie' | null>(null)
  const lastGestures = useRef<any[]>([])
  const dragPath = useRef<[number, number, number][]>([])
  const isPinching = useRef(false)
  const pinchHand = useRef<'Left'|'Right'|null>(null)
  const autoSpawnTimer = useRef<number | null>(null)
  const spacePressed = useRef(false)
  const lastSpacePress = useRef(0)
  const recordingCycleTimer = useRef<number | null>(null)
  const recordingCountdown = useRef<number | null>(null)
  const breakCountdown = useRef<number | null>(null)
  const audioBuffer = useRef<Float32Array[]>([])
  // Voice FSM guards
  const voiceModeRef = useRef<'auto'|'push'|'off'>('auto')
  const listeningRef = useRef(false)

  useEffect(() => { voiceModeRef.current = voiceMode }, [voiceMode])

  // Helper function to start wake word listening
  // Process voice command
  const processVoiceCommand = (text: string) => {
    if (!gameStateRef.current || !text.trim()) return
    
    setStatus('Processing command...')
    fetchIntent(text, gameStateRef.current.getWorldContext()).then(intent => {
      if (intent) {
        console.log('[Voice] Intent:', intent)
        
        // Handle deployment specially
        if (Array.isArray(intent)) {
          for (const cmd of intent) {
            if (cmd.action === 'deploy' && cmd.deployCount) {
              const deployed = gameStateRef.current!.deploySquad(cmd.deployCount)
              console.log(`[Voice] Deployed squads: ${deployed.join(', ')}`)
            } else {
              applyIntentToGame(cmd)
            }
          }
        } else if ('action' in intent) {
          if (intent.action === 'deploy' && intent.deployCount) {
            const deployed = gameStateRef.current!.deploySquad(intent.deployCount)
            console.log(`[Voice] Deployed squads: ${deployed.join(', ')}`)
          } else {
            applyIntentToGame(intent)
          }
        }
      }
      setStatus('idle')
    }).catch(err => {
      console.error('Intent error:', err)
      setStatus('intent error')
    })
  }
  
  // Apply intent to game (non-deployment commands)
  const applyIntentToGame = (intent: any) => {
    if (!gameStateRef.current) return
    
    for (const target of intent.targets || []) {
      if (target === 'all') {
        for (const squad of gameStateRef.current.squads.values()) {
          applyIntentToSquad(squad, intent, gameStateRef.current)
        }
      } else {
        const squad = gameStateRef.current.squads.get(target)
        if (squad) {
          applyIntentToSquad(squad, intent, gameStateRef.current)
        }
      }
    }
  }
  
  // Start automatic recording cycle (10s record, 5s break)
  const startAutoRecordingCycle = async () => {
    if (voiceModeRef.current !== 'auto') return
    
    // Set up ASR handler first
    if (!asr.current) {
      asr.current = new AsrWsClient()
      await asr.current.connect()
    }
    
    asr.current.onFinal((text: string) => {
      console.log('[Auto] Command:', text)
      processVoiceCommand(text)
    })
    
    // Start recording phase
    const startRecording = async () => {
      if (voiceModeRef.current !== 'auto') return
      
      // Make sure we're not already recording
      if (stopVad.current) {
        console.log('[startRecording] Already recording, stopping first')
        stopVad.current()
        stopVad.current = undefined
      }
      
      setIsRecording(true)
      setRecordingTimeLeft(10)
      setStatus('Recording commands...')
      audioBuffer.current = []
      
      // Countdown timer
      let timeLeft = 10
      recordingCountdown.current = setInterval(() => {
        timeLeft--
        setRecordingTimeLeft(timeLeft)
        if (timeLeft <= 0) {
          if (recordingCountdown.current) {
            clearInterval(recordingCountdown.current)
            recordingCountdown.current = null
          }
        }
      }, 1000)
      
      // Start capturing audio
      try {
        // Tell backend to start ASR stream
        asr.current.start(16000, 'en')
        
        stopVad.current = await startMicVad({
          onSpeechStart: () => {},
          onSpeechEnd: () => {},
          onFrame: (frame) => {
            if (asr.current?.isConnected()) {
              asr.current.sendFrame(frame)
            }
          }
        })
        
        // After 10 seconds, stop and take a break
        setTimeout(async () => {
          if (voiceModeRef.current !== 'auto') return
          
          stopVad.current?.()
          stopVad.current = undefined  // Clear the reference
          asr.current?.stop()  // Tell backend to stop ASR
          setIsRecording(false)
          
          // Start break phase
          setBreakTimeLeft(5)
          setStatus('Break...')
          
          let breakTime = 5
          breakCountdown.current = setInterval(() => {
            breakTime--
            setBreakTimeLeft(breakTime)
            if (breakTime <= 0) {
              if (breakCountdown.current) {
                clearInterval(breakCountdown.current)
                breakCountdown.current = null
              }
              // Start next recording cycle
              startRecording()
            }
          }, 1000)
        }, 10000)
        
      } catch (err) {
        console.error('[Auto] Recording error:', err)
        setIsRecording(false)
        setStatus('Mic error')
      }
    }
    
    // Start first recording
    setMicActive(true)
    startRecording()
  }
  
  const startWakeWordListening = async () => {
    // Wake word mode no longer used - replaced with auto recording
    return
  }
  
  useEffect(() => {
    if (connected.current) return
    connected.current = true
    
    // Initialize game state
    gameStateRef.current = new GameState()
    
    // Initialize ASR (but don't connect yet - will connect when needed)
    /*asr.current = new AsrWsClient()
    asr.current.connect((e: AsrEvent) => {
      if (e.type === 'ready') setStatus('ready')
      if (e.type === 'final') {
        const text = e.text.trim().toLowerCase()
        const currentKind = listenerKindRef.current

        // Wake listener path
        if (currentKind === 'wake' && voiceModeRef.current === 'wake' && !isListeningForCommand) {
          if (text.includes('commander')) {
            setIsListeningForCommand(true)
            setWakeWordActive(true)
            setStatus('listening for command...')
            setFinalText('Commander?')
            
            // Start listening for actual command
            setTimeout(() => {
              asr.current?.start(16000, 'en')
              stopVad.current = startMicVad({
                onSpeechStart: () => setStatus('speaking'),
                onSpeechEnd: () => { 
                  setStatus('processing')
                  asr.current?.stop()
                },
                onFrame: (f) => asr.current?.pushPcm(f)
              }, { hangoverMs: 400 })
              listeningRef.current = true
              listenerKindRef.current = 'command'
            }, 100)
            
            // Timeout after 5 seconds
            if (wakeWordTimeout.current) clearTimeout(wakeWordTimeout.current)
            wakeWordTimeout.current = setTimeout(() => {
              setIsListeningForCommand(false)
              setWakeWordActive(false)
              stopVad.current?.()
              asr.current?.stop()
              setStatus('ready')
              listeningRef.current = false
              listenerKindRef.current = null
            }, 5000)
            
            return
          } else {
            // Not a wake word, keep listening (debounced, single listener)
            stopVad.current?.()
            asr.current?.stop()
            listeningRef.current = false
            listenerKindRef.current = null
            if (voiceModeRef.current === 'wake') setTimeout(() => startWakeWordListening(), 300)
            return
          }
        }

        // Process actual command (push or post-wake command)
        if (currentKind !== 'push' && currentKind !== 'command') {
          // Ignore stray finals from stale listeners
          return
        }

        setFinalText(e.text)
        setStatus('idle')
        setIsListeningForCommand(false)
        setWakeWordActive(false)
        if (wakeWordTimeout.current) clearTimeout(wakeWordTimeout.current)
        stopVad.current?.(); asr.current?.stop()
        listeningRef.current = false
        listenerKindRef.current = null
        
        if (e.text.trim() && gameStateRef.current) {
          setStatus('processing intent...')
          fetchIntent(e.text, gameStateRef.current).then((intent) => {
            setLastIntent(JSON.stringify(intent, null, 2))
            if (rendererRef.current && gameStateRef.current) {
              // Handle multi-command intents
              const commands = 'type' in intent && intent.type === 'multi' 
                ? intent.commands 
                : [intent]
              
              for (const cmd of commands) {
                const targets = cmd.targets || ['all']
                for (const target of targets) {
                  if (target === 'all') {
                    // Apply to all squads
                    for (const squad of gameStateRef.current.squads.values()) {
                      applyIntentToSquad(squad, cmd, gameStateRef.current)
                    }
                  } else {
                    const squad = gameStateRef.current.squads.get(target)
                    if (squad) {
                      applyIntentToSquad(squad, cmd, gameStateRef.current)
                    }
                  }
                }
              }
            }
            setStatus('idle')
          }).catch(err => {
            console.error('Intent error:', err)
            setStatus('intent error')
          })
        }
      }
    })*/
    
    // Initialize hand tracking
    handTracker.current = new HandTracker()
    gestureRec.current = new GestureRecognizer()
    
    return () => {
      if (autoSpawnTimer.current) clearInterval(autoSpawnTimer.current)
      if (recordingCycleTimer.current) clearInterval(recordingCycleTimer.current)
      if (recordingCountdown.current) clearInterval(recordingCountdown.current)
      if (breakCountdown.current) clearInterval(breakCountdown.current)
      stopVad.current?.()
    }
  }, [])
  
  // Apply intent to a specific squad
  const applyIntentToSquad = (squad: any, intent: any, state: GameState) => {
    squad.formation = intent.formation || squad.formation
    squad.speed = intent.speed || squad.speed
    
    // Handle smart directions
    if (intent.direction === 'towards_enemies' && state.enemies.size > 0) {
      const nearestEnemy = Array.from(state.enemies.values())
        .map(e => ({ e, dist: e.position.distanceTo(squad.center) }))
        .sort((a, b) => a.dist - b.dist)[0]
      if (nearestEnemy) {
        const dir = nearestEnemy.e.position.clone().sub(squad.center).normalize()
        squad.heading = Math.atan2(dir.x, dir.z)
      }
    } else if (intent.direction === 'away_from_enemies' && state.enemies.size > 0) {
      const avgEnemyPos = new THREE.Vector3()
      for (const enemy of state.enemies.values()) {
        avgEnemyPos.add(enemy.position)
      }
      avgEnemyPos.divideScalar(state.enemies.size)
      const awayDir = squad.center.clone().sub(avgEnemyPos).normalize()
      squad.heading = Math.atan2(awayDir.x, awayDir.z)
    } else if (intent.direction === 'left') {
      squad.heading -= Math.PI / 4
    } else if (intent.direction === 'right') {
      squad.heading += Math.PI / 4
    } else if (intent.direction === 'north') {
      squad.heading = Math.PI / 2
    } else if (intent.direction === 'south') {
      squad.heading = -Math.PI / 2
    } else if (intent.direction === 'east') {
      squad.heading = 0
    } else if (intent.direction === 'west') {
      squad.heading = Math.PI
    }
    
    // Handle actions
    if (intent.action === 'advance' || intent.action === 'attack') {
      if (state.enemies.size > 0) {
        const enemy = Array.from(state.enemies.values())[0]
        squad.path = [enemy.position.clone()]
        squad.currentWaypoint = 0
      }
    } else if (intent.action === 'retreat') {
      const avgEnemyPos = new THREE.Vector3()
      for (const enemy of state.enemies.values()) {
        avgEnemyPos.add(enemy.position)
      }
      if (state.enemies.size > 0) {
        avgEnemyPos.divideScalar(state.enemies.size)
        const awayDir = squad.center.clone().sub(avgEnemyPos).normalize()
        squad.path = [squad.center.clone().add(awayDir.multiplyScalar(40))]
        squad.currentWaypoint = 0
      }
    } else if (intent.action === 'flank') {
      // Move to the side of enemies
      if (state.enemies.size > 0) {
        const enemy = Array.from(state.enemies.values())[0]
        const toEnemy = enemy.position.clone().sub(squad.center).normalize()
        const flankDir = new THREE.Vector3(-toEnemy.z, 0, toEnemy.x) // Perpendicular
        if (intent.direction === 'right') flankDir.negate()
        squad.path = [enemy.position.clone().add(flankDir.multiplyScalar(20))]
        squad.currentWaypoint = 0
      }
    } else if (intent.action === 'patrol' && intent.path && intent.path.length > 1) {
      // Waypoint cycling
      squad.path = intent.path.map((p: any) => new THREE.Vector3(p[0], 0, p[2] ?? p[1]))
      squad.currentWaypoint = 0
      squad.pathCycle = true
      squad.encircle = undefined
    } else if (intent.action === 'rally' && state.enemies.size > 0) {
      // Encircle nearest enemy
      const enemy = Array.from(state.enemies.values())[0]
      squad.encircle = {
        center: enemy.position.clone(),
        radius: 12,
        angularSpeed: 1.2,
        angle: 0
      }
      squad.path = undefined
      squad.currentWaypoint = undefined
      squad.pathCycle = false
    }
  }
  
  // Game loop
  useEffect(() => {
    if (!rendererRef.current || !gameStateRef.current) return
    
    const animate = (() => {
      let last = performance.now()
      return () => {
        const now = performance.now()
        const dt = Math.min(0.05, (now - last) / 1000) // cap to 50ms
        last = now
      if (gameStateRef.current) {
        gameStateRef.current.update(dt)
        setEnemyCount(gameStateRef.current.enemies.size)
        setSquadCounts({
          alpha: gameStateRef.current.squads.get('alpha')?.ships.length || 0,
          bravo: gameStateRef.current.squads.get('bravo')?.ships.length || 0,
          charlie: gameStateRef.current.squads.get('charlie')?.ships.length || 0
        })
      }
      
      if (rendererRef.current && gameStateRef.current) {
        rendererRef.current.updateFromState(gameStateRef.current)
        
        // Update hand indicators with drag path (always update to render live path)
        rendererRef.current.updateHandIndicators(
          lastGestures.current.map(g => ({
            type: g.type,
            hand: g.hand,
            position: g.position,
            strength: g.strength
          })),
          isPinching.current ? dragPath.current : undefined
        )
        
        // Update selection ring
        rendererRef.current.showSelectionRing(selectedSquad.current, gameStateRef.current)
        setSelectedSquadState(selectedSquad.current)
        
        rendererRef.current.render()
      }
      }
    })()
    
    let rafId: number
    const loop = () => { animate(); rafId = requestAnimationFrame(loop) }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [])
  
  // Keyboard handlers
  useEffect(() => {
    if (!gameStarted) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        
        // Check for double-tap to switch modes
        const now = Date.now()
        if (now - lastSpacePress.current < 300) {
          // Double tap - switch modes
          if (voiceMode === 'auto') {
            setVoiceMode('push')
            setStatus('Push-to-talk mode')
            // Stop auto recording
            if (recordingCountdown.current) clearInterval(recordingCountdown.current)
            if (breakCountdown.current) clearInterval(breakCountdown.current)
            if (recordingCycleTimer.current) clearInterval(recordingCycleTimer.current)
            stopVad.current?.()
            setIsRecording(false)
            setRecordingTimeLeft(0)
            setBreakTimeLeft(0)
            setMicActive(false)
          } else if (voiceMode === 'push') {
            setVoiceMode('auto')
            setStatus('Auto recording mode')
            // Start auto recording
            startAutoRecordingCycle()
          } else {
            setVoiceMode('push')
            setStatus('Push-to-talk mode')
          }
          return
        }
        lastSpacePress.current = now
        
        // Push-to-talk
        if (voiceMode === 'push' && !spacePressed.current) {
          spacePressed.current = true
          setMicActive(true)
          setStatus('Push to talk...')
          
          // Set up ASR if needed
          if (!asr.current) {
            asr.current = new AsrWsClient()
            asr.current.connect().then(() => {
              asr.current!.onFinal((text: string) => {
                console.log('[Push] Command:', text)
                processVoiceCommand(text)
              })
            })
          }
          
          // Start capturing audio
          asr.current.start(16000, 'en')  // Tell backend to start ASR
          
          startMicVad({
            onSpeechStart: () => setStatus('Speaking...'),
            onSpeechEnd: () => {},
            onFrame: (frame) => {
              if (asr.current?.isConnected()) {
                asr.current.sendFrame(frame)
              }
            }
          }).then(stop => {
            stopVad.current = stop
          })
        }
      }
    }
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && voiceMode === 'push' && spacePressed.current) {
        e.preventDefault()
        spacePressed.current = false
        stopVad.current?.()
        stopVad.current = undefined
        asr.current?.stop()  // Tell backend to stop ASR
        setMicActive(false)
        setStatus('Processing...')
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [gameStarted, voiceMode])
  
  const waveCountFor = (wave: number) => {
    // Fast ramp to hundreds; quadratic growth with a cap for perf
    const count = Math.min(600, Math.floor(25 + 8 * wave + 0.6 * wave * wave))
    console.log(`[waveCountFor] Wave ${wave} -> ${count} enemies`)
    return count
  }

  const onStartGame = async () => {
    setGameStarted(true)
    
    // Start automatic recording cycles if in auto mode
    setStatus('ready')
    if (voiceMode === 'auto') {
      setTimeout(() => startAutoRecordingCycle(), 1000)
    }
    
    // Auto-start hands
    if (handTracker.current && gestureRec.current) {
      setHandsActive(true)
      
      await handTracker.current.start((hands) => {
        if (!gestureRec.current || !gameStateRef.current) return
        
        const gestures = gestureRec.current.recognize(hands)
        lastGestures.current = gestures
        
        // Debug info
        if (hands.length > 0) {
          const h = hands[0]
          const pinchDist = Math.hypot(
            h.landmarks[4][0] - h.landmarks[8][0],
            h.landmarks[4][1] - h.landmarks[8][1]
          )
          setGesture(`${h.handedness} pinch:${pinchDist.toFixed(3)}`)
        }
        
        // Use recognizer's drag states for both hands; draw path live while pinching
        const leftDrag = gestureRec.current.getDragState('Left')   // user's right hand
        const rightDrag = gestureRec.current.getDragState('Right') // user's left hand

        const activeDrag = leftDrag.active ? { hand:'Left' as const, state:leftDrag }
                          : rightDrag.active ? { hand:'Right' as const, state:rightDrag }
                          : null

        if (activeDrag) {
          // On first activation, lock to this hand and select nearest squad to origin
          if (!isPinching.current) {
            isPinching.current = true
            pinchHand.current = activeDrag.hand
            const [sx, sy] = activeDrag.state.path[0]
            const originWorld = screenToWorld(sx, sy)
            let nearest: 'alpha' | 'bravo' | 'charlie' | null = null
            let minDist = Infinity
            for (const [name, squad] of gameStateRef.current.squads.entries()) {
              if (squad.ships.length === 0) continue
              const d = originWorld.distanceTo(squad.center)
              if (d < minDist) { minDist = d; nearest = name as any }
            }
            selectedSquad.current = nearest
          }
          // Only follow the locked hand
          if (pinchHand.current === activeDrag.hand) {
            dragPath.current = activeDrag.state.path.map(([x,y]) => [x,y,0])
          }
        } else if (isPinching.current) {
          // Pinch released -> commit saved path
          isPinching.current = false
          const savedPath = dragPath.current.slice()
          if (selectedSquad.current && savedPath.length > 3) {
            const squad = gameStateRef.current.squads.get(selectedSquad.current)
            if (squad) {
              const worldPath = savedPath.map(([x,y]) => screenToWorld(x,y))
              squad.path = simplifyPath(worldPath, 1.5)
              squad.currentWaypoint = 0
              squad.speed = 10
            }
          }
          pinchHand.current = null
          dragPath.current = []
        }
      })
    }
    
    // Spawn first wave immediately (more units)
    if (gameStateRef.current) {
      waveIndexRef.current = 1
      const count = waveCountFor(waveIndexRef.current)
      gameStateRef.current.spawnEnemyWave(count)
      setWaveNumber(waveIndexRef.current)
      setSpawnedThisWave(count)
    }
    
    // Start enemy wave spawning timer
    let waveTimer = 0
    autoSpawnTimer.current = setInterval(() => {
      if (gameStateRef.current) {
        console.log(`[Wave Timer] Enemies: ${gameStateRef.current.enemies.size}, Timer: ${waveTimer}`)
        if (gameStateRef.current.enemies.size === 0) {
          waveTimer++
          if (waveTimer > 2) {  // 2 seconds after clearing
            waveIndexRef.current += 1
            const count = waveCountFor(waveIndexRef.current)
            console.log(`[Wave Spawn] Wave ${waveIndexRef.current}, spawning ${count} enemies`)
            gameStateRef.current.spawnEnemyWave(count)
            setWaveNumber(waveIndexRef.current)
            setSpawnedThisWave(count)
            waveTimer = 0
          }
        } else {
          waveTimer = 0  // Reset timer if enemies still exist
        }
      }
    }, 1000)
  }
  
  const onToggleMic = async () => {
    if (micActive) {
      // Stop mic
      stopVad.current?.()
      asr.current?.stop()
      setMicActive(false)
      setStatus('idle')
    } else {
      // Start mic
      setFinalText('')
      setLastIntent('')
      setStatus('listening')
      setMicActive(true)
      asr.current?.start(16000, 'en')
      stopVad.current = await startMicVad({
        onSpeechStart: () => setStatus('speaking'),
        onSpeechEnd: () => { 
          setStatus('processing')
          asr.current?.stop()
          setMicActive(false)
        },
        onFrame: (f) => asr.current?.pushPcm(f)
      }, { hangoverMs: 400 })
    }
  }
  
  const onRespawnSquads = () => {
    if (gameStateRef.current) {
      const squadNames: ('alpha' | 'bravo' | 'charlie')[] = ['alpha', 'bravo', 'charlie']
      for (const name of squadNames) {
        const squad = gameStateRef.current.squads.get(name)
        if (squad && squad.ships.length < 10) {
          for (let i = squad.ships.length; i < 20; i++) {
            squad.ships.push({
              id: `${name}-${Date.now()}-${i}`,
              squad: name,
              position: new THREE.Vector3(
                (i % 5) * 3 - 6,
                0.5,
                Math.floor(i / 5) * 3
              ).add(squad.center),
              velocity: new THREE.Vector3(0, 0, 0),
              hp: 100,
              maxHp: 100
            })
          }
        }
      }
    }
  }
  
  const screenToWorld = (x: number, y: number): THREE.Vector3 => {
    const worldX = (0.5 - x) * 100  // Flip X for mirror
    const worldZ = (y - 0.5) * 100
    return new THREE.Vector3(worldX, 0, worldZ)
  }

  // Ramer–Douglas–Peucker simplification for 3D path (project Y ignored)
  const simplifyPath = (points: THREE.Vector3[], epsilon: number): THREE.Vector3[] => {
    if (points.length < 3) return points
    const sq = (v: THREE.Vector3) => v.x*v.x + v.z*v.z
    const perpDistSq = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
      const ab = b.clone().sub(a)
      const ap = p.clone().sub(a)
      const t = Math.max(0, Math.min(1, (ab.x*ap.x + ab.z*ap.z) / Math.max(1e-6, sq(ab))))
      const proj = new THREE.Vector3(a.x + t*ab.x, 0, a.z + t*ab.z)
      return sq(p.clone().setY(0).sub(proj))
    }
    const rdp = (pts: THREE.Vector3[], eps2: number): THREE.Vector3[] => {
      if (pts.length <= 2) return pts.slice()
      const a = pts[0], b = pts[pts.length-1]
      let idx = -1, maxD = -1
      for (let i=1;i<pts.length-1;i++) {
        const d = perpDistSq(pts[i], a, b)
        if (d > maxD) { maxD = d; idx = i }
      }
      if (maxD > eps2) {
        const left = rdp(pts.slice(0, idx+1), eps2)
        const right = rdp(pts.slice(idx), eps2)
        return left.slice(0, -1).concat(right)
      } else {
        return [a, b]
      }
    }
    return rdp(points, epsilon*epsilon)
  }

  return (
    <>
      <canvas ref={(el)=>{
        if (el && !rendererRef.current) {
          canvasRef.current = el
          rendererRef.current = new Renderer(el)
        }
      }} style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none', background:'#000' }}/>

      {!gameStarted ? (
        <StartScreen onStart={onStartGame} />
      ) : (
        <div style={{ position:'fixed', top:16, left:16, zIndex:10, color:'#fff', fontFamily:'system-ui', fontSize:14 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ 
              padding: '8px 12px', 
              background: wakeWordActive ? '#ffaa00' : micActive ? '#ff3333' : 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 4,
              marginBottom: 8
            }}>
              Voice: {voiceMode === 'auto' ? 
                (isRecording ? `🔴 RECORDING (${recordingTimeLeft}s)` : 
                 breakTimeLeft > 0 ? `⏸️ BREAK (${breakTimeLeft}s)` : '🎤 Auto') : 
                voiceMode === 'push' ? '🎮 Hold SPACE' : '🔇 OFF'}
              {micActive && ` | ${status}`}
            </div>
            <div style={{ 
              padding: '8px 12px', 
              background: handsActive ? '#33ff33' : 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 4
            }}>
              Hands: {handsActive ? '✋ TRACKING' : '⚫ Ready'} | {gesture}
            </div>
          </div>
          
          <div style={{ 
            padding: 12, 
            background: 'rgba(0,0,0,0.7)', 
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 4,
            maxWidth: 300
          }}>
            <div style={{ marginBottom: 8 }}>
              <strong>Wave {waveNumber}</strong> | Enemies: {enemyCount} | Spawned: {spawnedThisWave}
            </div>
            <div style={{ marginBottom: 8 }}>
              Kills: {gameStateRef.current?.kills || 0} | Squad Points: {gameStateRef.current?.squadPoints || 0}/20 | 
              {gameStateRef.current?.deployableSquads ? ` 🚀 ${gameStateRef.current.deployableSquads} squads ready!` : ''}
            </div>
            <div style={{ marginBottom: 8 }}>
              <div>Alpha: {squadCounts.alpha}/20</div>
              <div>Bravo: {squadCounts.bravo}/20</div>
              <div>Charlie: {squadCounts.charlie}/20</div>
            </div>
            {selectedSquadState && (
              <div style={{ marginBottom: 8, color: '#ffff00' }}>
                Selected: {selectedSquadState.toUpperCase()}
              </div>
            )}
            {finalText && (
              <div style={{ marginBottom: 8 }}>
                <strong>Command:</strong> {finalText}
      </div>
            )}
            <button 
              onClick={onRespawnSquads}
              style={{ 
                padding: '6px 12px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.3)',
                color: 'white',
                cursor: 'pointer',
                borderRadius: 4
              }}
            >
              Respawn Squads
        </button>
          </div>
      </div>
      )}
    </>
  )
}

export default App