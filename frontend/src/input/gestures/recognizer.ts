import type { HandData } from '../mediapipe/handTracker'

export interface Gesture {
  type: 'pinch' | 'point' | 'open' | 'fist' | 'drag' | 'flick'
  hand: 'Left' | 'Right'
  position: [number, number, number]  // normalized screen coords
  strength: number
}

export interface DragState {
  active: boolean
  start: [number, number]
  current: [number, number]
  path: [number, number][]
}

export class GestureRecognizer {
  private leftDrag: DragState = { active: false, start: [0,0], current: [0,0], path: [] }
  private rightDrag: DragState = { active: false, start: [0,0], current: [0,0], path: [] }
  private lastPinch = { left: false, right: false }
  private pinchFrames = { left: 0, right: 0 }
  
  recognize(hands: HandData[]): Gesture[] {
    const gestures: Gesture[] = []
    
    for (const hand of hands) {
      const lm = hand.landmarks
      const isLeft = hand.handedness === 'Left'
      
      // Key landmarks
      const thumb = lm[4]
      const index = lm[8]
      const middle = lm[12]
      const ring = lm[16]
      const pinky = lm[20]
      const palm = lm[0]
      const indexBase = lm[5]
      
      // Pinch detection (thumb tip to index tip) with hysteresis + dwell frames
      const pinchDist = Math.sqrt(
        Math.pow(thumb[0] - index[0], 2) + 
        Math.pow(thumb[1] - index[1], 2)
      )
      // Stricter thresholds: require closer pinch to start, slightly looser to maintain
      const PINCH_START = 0.040
      const PINCH_END = 0.060
      
      // Palm openness (average finger extension)
      const fingerDists = [
        this.dist3d(index, indexBase),
        this.dist3d(middle, lm[9]),
        this.dist3d(ring, lm[13]),
        this.dist3d(pinky, lm[17])
      ]
      const avgExtension = fingerDists.reduce((a,b) => a+b) / 4
      const isOpen = avgExtension > 0.15
      const isFist = avgExtension < 0.08
      
      // Pointing (index extended, others curled)
      const isPoint = fingerDists[0] > 0.15 && fingerDists[1] < 0.1 && fingerDists[2] < 0.1
      
      // Drag tracking
      const drag = isLeft ? this.leftDrag : this.rightDrag
      const wasPinch = isLeft ? this.lastPinch.left : this.lastPinch.right
      let isPinch = wasPinch ? (pinchDist < PINCH_END) : (pinchDist < PINCH_START)

      // Require pinch to be held for a few frames before we consider it real
      const side = isLeft ? 'left' : 'right' as const
      if (isPinch) {
        this.pinchFrames[side] = Math.min(10, this.pinchFrames[side] + 1)
      } else {
        this.pinchFrames[side] = 0
      }
      const MIN_PINCH_FRAMES = 3
      if (!wasPinch && isPinch && this.pinchFrames[side] < MIN_PINCH_FRAMES) {
        isPinch = false
      }
      
      if (isPinch && !wasPinch) {
        // Start drag
        drag.active = true
        drag.start = [index[0], index[1]]
        drag.current = [index[0], index[1]]
        drag.path = [[index[0], index[1]]]
      } else if (isPinch && drag.active) {
        // Continue drag
        drag.current = [index[0], index[1]]
        const last = drag.path[drag.path.length - 1]
        // Threshold to reduce noisy points in normalized coordinates
        if (!last || Math.hypot(index[0]-last[0], index[1]-last[1]) > 0.005) {
          drag.path.push([index[0], index[1]])
        }
        gestures.push({
          type: 'drag',
          hand: hand.handedness,
          position: [index[0], index[1], index[2]],
          strength: 1.0
        })
      } else if (!isPinch && wasPinch && drag.active) {
        // End drag - check for flick
        const vel = this.getVelocity(drag.path)
        if (vel > 0.5) {
          gestures.push({
            type: 'flick',
            hand: hand.handedness,
            position: [index[0], index[1], index[2]],
            strength: Math.min(vel / 2, 1.0)
          })
        }
        drag.active = false
        drag.path = []
      }
      
      // Update pinch state
      if (isLeft) this.lastPinch.left = isPinch
      else this.lastPinch.right = isPinch
      
      // Emit current gesture
      if (isPinch && !drag.active) {
        gestures.push({
          type: 'pinch',
          hand: hand.handedness,
          position: [index[0], index[1], index[2]],
          strength: 1.0 - pinchDist / 0.05
        })
      } else if (isPoint) {
        gestures.push({
          type: 'point',
          hand: hand.handedness,
          position: [index[0], index[1], index[2]],
          strength: fingerDists[0] / 0.2
        })
      } else if (isOpen) {
        gestures.push({
          type: 'open',
          hand: hand.handedness,
          position: [palm[0], palm[1], palm[2]],
          strength: avgExtension / 0.2
        })
      } else if (isFist) {
        gestures.push({
          type: 'fist',
          hand: hand.handedness,
          position: [palm[0], palm[1], palm[2]],
          strength: 1.0 - avgExtension / 0.08
        })
      }
    }
    
    return gestures
  }
  
  getDragState(hand: 'Left' | 'Right'): DragState {
    return hand === 'Left' ? this.leftDrag : this.rightDrag
  }
  
  private dist3d(a: number[], b: number[]): number {
    return Math.sqrt(
      Math.pow(a[0] - b[0], 2) + 
      Math.pow(a[1] - b[1], 2) + 
      Math.pow(a[2] - b[2], 2)
    )
  }
  
  private getVelocity(path: [number, number][]): number {
    if (path.length < 3) return 0
    const recent = path.slice(-5)
    let totalDist = 0
    for (let i = 1; i < recent.length; i++) {
      const dx = recent[i][0] - recent[i-1][0]
      const dy = recent[i][1] - recent[i-1][1]
      totalDist += Math.sqrt(dx*dx + dy*dy)
    }
    return totalDist / recent.length * 30  // rough velocity
  }
}
