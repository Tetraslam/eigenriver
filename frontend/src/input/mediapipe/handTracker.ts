import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export interface HandData {
  landmarks: number[][]  // 21 landmarks, [x,y,z] each
  handedness: 'Left' | 'Right'
  score: number
}

export class HandTracker {
  private landmarker?: HandLandmarker
  private video?: HTMLVideoElement
  private running = false
  private lastTime = -1

  async init() {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    )
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    })
  }

  async start(onFrame: (hands: HandData[]) => void) {
    if (!this.landmarker) await this.init()
    
    this.video = document.createElement('video')
    this.video.autoplay = true
    this.video.playsInline = true
    
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'user', width: 640, height: 480 } 
    })
    this.video.srcObject = stream
    
    await new Promise(resolve => {
      this.video!.onloadedmetadata = resolve
    })
    
    this.running = true
    const detect = () => {
      if (!this.running || !this.video || !this.landmarker) return
      
      const now = performance.now()
      if (now - this.lastTime > 33) {  // ~30fps
        this.lastTime = now
        const results = this.landmarker.detectForVideo(this.video, now)
        
        if (results.landmarks && results.landmarks.length > 0) {
          const hands: HandData[] = []
          for (let i = 0; i < results.landmarks.length; i++) {
            const landmarks = results.landmarks[i].map(lm => [lm.x, lm.y, lm.z])
            hands.push({
              landmarks,
              handedness: results.handednesses[i][0].categoryName as 'Left' | 'Right',
              score: results.handednesses[i][0].score
            })
          }
          onFrame(hands)
        }
      }
      requestAnimationFrame(detect)
    }
    detect()
  }

  stop() {
    this.running = false
    if (this.video?.srcObject) {
      const stream = this.video.srcObject as MediaStream
      stream.getTracks().forEach(t => t.stop())
    }
  }
}
