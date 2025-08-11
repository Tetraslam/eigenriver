import { useEffect, useRef, useState } from 'react'
import './App.css'
import { AsrWsClient } from './input/asr/wsClient'
import { startMicVad } from './input/vad/webrtc'
import { fetchIntent } from './voice/router'
import { InstancedRenderer } from './engine/InstancedRenderer'
import { GameState } from './engine/gameState'
import { HandTracker } from './input/mediapipe/handTracker'
import { GestureRecognizer } from './input/gestures/recognizer'
import { StartScreen } from './components/StartScreen'
import { WaveManager } from './engine/WaveManager'
import { SoundManager } from './engine/SoundManager'
import * as THREE from 'three'

function App() {
  const [status, setStatus] = useState('ready')
  const [finalText, setFinalText] = useState('')
  const [lastIntent, setLastIntent] = useState<string>('')
  const [gesture, setGesture] = useState('')
  const [enemyCount, setEnemyCount] = useState(0)
  const [squadInfo, setSquadInfo] = useState<any>({})
  const [micActive, setMicActive] = useState(false)
  const [handsActive, setHandsActive] = useState(false)
  const [waveNumber, setWaveNumber] = useState(0)
  const [waveComposition, setWaveComposition] = useState('')
  const waveManagerRef = useRef<WaveManager | null>(null)
  const soundManagerRef = useRef<SoundManager | null>(null)
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
  const rendererRef = useRef<InstancedRenderer | null>(null)
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
              const formation = cmd.deployFormation || 'random'
              const deployed = gameStateRef.current!.deploySquad(cmd.deployCount, formation)
              console.log(`[Voice] Deployed ${cmd.deployCount} squads in ${formation} formation: ${deployed.join(', ')}`)
              // Play sound and announce
              soundManagerRef.current?.playSquadSpawn()
              soundManagerRef.current?.announce(`${deployed.join(' and ')} deployed in ${formation}`, { rate: 1.4 })
            } else {
              applyIntentToGame(cmd)
            }
          }
        } else {
          // Single intent
          if (intent.action === 'deploy' && intent.deployCount) {
            const formation = intent.deployFormation || 'random'
            const deployed = gameStateRef.current!.deploySquad(intent.deployCount, formation)
            console.log(`[Voice] Deployed ${intent.deployCount} squads in ${formation} formation: ${deployed.join(', ')}`)
            // Play sound and announce
            soundManagerRef.current?.playSquadSpawn()
            soundManagerRef.current?.announce(`${deployed.join(' and ')} deployed in ${formation}`, { rate: 1.4 })
          } else {
            // Apply any other command (including movement without action)
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
    
    // Get target squads based on intent
    const targetSquads = getTargetSquads(intent.targets || [], gameStateRef.current)
    
    // Apply spacing if moving multiple squads
    if (targetSquads.length > 1 && (intent.relativeMove || intent.waypointTargets) && intent.maintainSpacing !== false) {
      applyIntentWithSpacing(targetSquads, intent, gameStateRef.current)
    } else {
      // Apply to each squad normally
      for (const squad of targetSquads) {
        applyIntentToSquad(squad, intent, gameStateRef.current)
      }
    }
  }
  
  // Get squads based on target descriptions
  const getTargetSquads = (targets: string[], state: GameState): any[] => {
    const squads: any[] = []
    
    for (const target of targets) {
      if (target === 'all') {
        // Add all squads
        for (const squad of state.squads.values()) {
          if (!squads.includes(squad)) squads.push(squad)
        }
      } else if (target.includes('_squads')) {
        // Position-based selection
        const position = target.replace('_squads', '')
        for (const squad of state.squads.values()) {
          if (isSquadInPosition(squad, position)) {
            if (!squads.includes(squad)) squads.push(squad)
          }
        }
      } else {
        // Specific squad name
        const squad = state.squads.get(target)
        if (squad && !squads.includes(squad)) squads.push(squad)
      }
    }
    
    return squads
  }
  
  // Check if squad is in a position quadrant
  const isSquadInPosition = (squad: any, position: string): boolean => {
    const x = squad.center.x
    const z = squad.center.z
    
    switch (position) {
      case 'top_right': return x > 0 && z < 0
      case 'top_left': return x < 0 && z < 0
      case 'bottom_right': return x > 0 && z > 0
      case 'bottom_left': return x < 0 && z > 0
      case 'top': return z < 0
      case 'bottom': return z > 0
      case 'left': return x < 0
      case 'right': return x > 0
      default: return false
    }
  }
  
  // Apply intent with proper spacing between squads
  const applyIntentWithSpacing = (squads: any[], intent: any, state: GameState) => {
    const spacing = 20  // Units between squads
    const centerPoint = new THREE.Vector3()
    
    // Calculate center of all squads
    for (const squad of squads) {
      centerPoint.add(squad.center)
    }
    centerPoint.divideScalar(squads.length)
    
    // Apply movement with offset for each squad
    squads.forEach((squad, index) => {
      const modifiedIntent = { ...intent }
      
      if (intent.relativeMove) {
        // Add offset to maintain formation
        const offset = getFormationOffset(index, squads.length, spacing)
        modifiedIntent.relativeMove = {
          ...intent.relativeMove,
          distance: intent.relativeMove.distance,
          offset
        }
      }
      
      applyIntentToSquad(squad, modifiedIntent, state)
    })
  }
  
  // Get formation offset for squad positioning
  const getFormationOffset = (index: number, total: number, spacing: number): THREE.Vector3 => {
    // Arrange in a grid formation
    const cols = Math.ceil(Math.sqrt(total))
    const row = Math.floor(index / cols)
    const col = index % cols
    
    const x = (col - cols/2) * spacing
    const z = (row - Math.floor(total/cols)/2) * spacing
    
    return new THREE.Vector3(x, 0, z)
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
      setRecordingTimeLeft(10)  // 10 seconds recording time
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
        }, 10000)  // 10 seconds recording time
        
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
    
    // Initialize game state and managers
    gameStateRef.current = new GameState()
    waveManagerRef.current = new WaveManager()
    soundManagerRef.current = new SoundManager()
    soundManagerRef.current.init()
    
    // Connect sound manager to game state
    gameStateRef.current.soundManager = soundManagerRef.current
    
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
    // Only update if values are provided
    if (intent.formation) squad.formation = intent.formation
    if (intent.speed !== undefined) squad.speed = intent.speed
    
    // Handle multiple waypoint navigation with cycling
    if (intent.waypointTargets && intent.waypointTargets.length > 0) {
      const waypoints: THREE.Vector3[] = []
      for (const targetName of intent.waypointTargets) {
        const landmark = state.landmarks.find((l: any) => l.name === targetName)
        if (landmark) {
          waypoints.push(landmark.position.clone())
        }
      }
      if (waypoints.length > 0) {
        squad.path = waypoints
        squad.currentWaypoint = 0
        squad.pathCycle = intent.cycleWaypoints || false
        console.log(`[Intent] Squad ${squad.name} navigating ${waypoints.length} waypoints${intent.cycleWaypoints ? ' (cycling)' : ''}`)
      }
    }
    
    // Handle relative movement with offset (two possible formats from backend)
    if (intent.relativeMove || intent.relativeMovement) {
      let moveVector = new THREE.Vector3()
      
      // Check which format we received
      const moveData = intent.relativeMove || intent.relativeMovement
      
      if ('direction' in moveData && typeof moveData.direction === 'string') {
        // Format 1: {direction: 'right', distance: 40}
        const { direction, distance, offset } = moveData
        
        // Map directions including up/down which mean north/south in game terms
        if (direction === 'right') {
          moveVector.x = distance || 40
        } else if (direction === 'left') {
          moveVector.x = -(distance || 40)
        } else if (direction === 'forward' || direction === 'up') {
          moveVector.z = -(distance || 40)
        } else if (direction === 'backward' || direction === 'down') {
          moveVector.z = distance || 40
        }
        
        // Add offset if provided (for formation movement)
        if (offset) {
          moveVector.add(offset)
        }
        
        console.log(`[Intent] Squad ${squad.name} moving ${direction} by ${distance || 40} units`)
      } else if ('x' in moveData || 'y' in moveData || 'z' in moveData) {
        // Format 2: {x: 100, z: 0}
        moveVector.x = moveData.x || 0
        moveVector.y = moveData.y || 0
        moveVector.z = moveData.z || 0
        console.log(`[Intent] Squad ${squad.name} moving by vector (${moveVector.x}, ${moveVector.y}, ${moveVector.z})`)
      }
      
      if (moveVector.length() > 0) {
        const targetPos = squad.center.clone().add(moveVector)
        squad.path = [targetPos]
        squad.currentWaypoint = 0
        squad.pathCycle = false
      }
    }
    
    // Handle "help" action - move to assist another squad
    if (intent.action === 'help' && intent.helpTarget) {
      const targetSquad = state.squads.get(intent.helpTarget)
      if (targetSquad) {
        // Move near the target squad
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * 20,
          0,
          (Math.random() - 0.5) * 20
        )
        squad.path = [targetSquad.center.clone().add(offset)]
        squad.currentWaypoint = 0
        squad.speed = 8  // Move quickly to help
        console.log(`[Intent] Squad ${squad.name} moving to help ${intent.helpTarget}`)
      }
    }
    
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
        // Update squad info
        const info: any = {}
        for (const [name, squad] of gameStateRef.current.squads.entries()) {
          if (squad.ships.length > 0) {
            info[name] = {
              count: squad.ships.length,
              type: squad.squadType,
              color: getSquadTypeColor(squad.squadType)
            }
          }
        }
        setSquadInfo(info)
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
    
    // Spawn first wave immediately
    if (gameStateRef.current && waveManagerRef.current) {
      const wave = waveManagerRef.current.getNextWave()
      waveManagerRef.current.spawnWavePattern(gameStateRef.current, wave.pattern, wave.count)
      setWaveNumber(1)
      setWaveComposition(wave.composition)
      
      // Announce wave
      soundManagerRef.current?.playWaveStart()
      soundManagerRef.current?.announce(`Wave 1: ${wave.composition}`, { rate: 1.3 })
    }
    
    // Start enemy wave spawning timer
    let waveTimer = 0
    autoSpawnTimer.current = setInterval(() => {
      if (gameStateRef.current && waveManagerRef.current) {
        // Check for sub-waves
        if (waveManagerRef.current.shouldSpawnSubWave(gameStateRef.current)) {
          const subCount = waveManagerRef.current.getSubWaveCount()
          // Use WaveManager to spawn with proper THREE.Vector3 positions
          waveManagerRef.current.spawnWavePattern(gameStateRef.current, 'swarm', subCount)
          soundManagerRef.current?.announce('Reinforcements incoming', { rate: 1.5, volume: 0.3 })
        }
        
        // Check for wave clear
        if (gameStateRef.current.enemies.size === 0) {
          waveTimer++
          if (waveTimer > 2) {  // 2 seconds after clearing
            const wave = waveManagerRef.current.getNextWave()
            waveManagerRef.current.spawnWavePattern(gameStateRef.current, wave.pattern, wave.count)
            setWaveNumber(wave.pattern === 'boss' ? 
              Math.floor(waveManagerRef.current['currentWave'] / 5) * 5 : 
              waveManagerRef.current['currentWave'])
            setWaveComposition(wave.composition)
            
            // Announce wave
            soundManagerRef.current?.playWaveStart()
            if (wave.pattern === 'boss') {
              soundManagerRef.current?.announce(`Boss wave ${waveManagerRef.current['currentWave']}!`, { rate: 1.1, pitch: 0.8 })
            } else {
              soundManagerRef.current?.announce(`Wave ${waveManagerRef.current['currentWave']}: ${wave.composition}`, { rate: 1.3 })
            }
            
            waveTimer = 0
          }
        } else {
          waveTimer = 0
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
  
  const getSquadTypeColor = (type: string): string => {
    switch (type) {
      case 'assault': return '#ff4444'
      case 'sniper': return '#aa44ff'
      case 'bomber': return '#ff8844'
      case 'defender': return '#4488ff'
      default: return '#888888'
    }
  }

  return (
    <>
      <canvas ref={(el)=>{
        if (el && !rendererRef.current) {
          canvasRef.current = el
          rendererRef.current = new InstancedRenderer(el)
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
                (isRecording ? `🔴 RECORDING (${recordingTimeLeft}s of 10s)` : 
                 breakTimeLeft > 0 ? `⏸️ BREAK (${breakTimeLeft}s of 5s)` : '🎤 Auto (10s record / 5s break)') : 
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
              <strong>Wave {waveNumber}</strong> | Enemies: {enemyCount}
              {waveComposition && <div style={{ fontSize: 12, opacity: 0.8 }}>{waveComposition}</div>}
            </div>
            <div style={{ marginBottom: 8 }}>
              Kills: {gameStateRef.current?.kills || 0} | Squad Points: {gameStateRef.current?.squadPoints || 0}/20 | 
              {gameStateRef.current?.deployableSquads ? ` 🚀 ${gameStateRef.current.deployableSquads} squads ready!` : ''}
            </div>
            <div style={{ marginBottom: 8 }}>
              {Object.entries(squadInfo).slice(0, 6).map(([name, info]: [string, any]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ 
                    width: 8, 
                    height: 8, 
                    background: info.color, 
                    borderRadius: '50%' 
                  }}/>
                  <span>{name}: {info.count}/20</span>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>({info.type})</span>
                </div>
              ))}
            </div>
            {selectedSquadState && (
              <div style={{ marginBottom: 8, color: '#ffff00' }}>
                Selected: {selectedSquadState.toUpperCase()}
              </div>
            )}
            <div style={{ 
              marginTop: 12, 
              padding: 8, 
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 4,
              fontSize: 11
            }}>
              <div><strong>Camera:</strong></div>
              <div>WASD - Move</div>
              <div>Q/E - Up/Down</div>
              <div>Space - Push to talk</div>
            </div>
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