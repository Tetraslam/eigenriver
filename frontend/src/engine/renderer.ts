import * as THREE from 'three'
import type { GameState } from './gameState'

export class Renderer {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private shipMeshes: Map<string, THREE.Mesh> = new Map()
  private enemyMeshes: Map<string, THREE.Mesh> = new Map()
  private projectileMeshes: Map<string, THREE.Mesh> = new Map()
  private pathLines: Map<string, THREE.Line> = new Map()
  private handIndicators: Map<string, THREE.Mesh> = new Map()
  private selectionRing?: THREE.Mesh
  private squadLabels: Map<string, THREE.Sprite> = new Map()
  private dragLine?: THREE.Line
  private clock = new THREE.Clock()
  private gridText?: THREE.Sprite
  private landmarkMeshes: THREE.Mesh[] = []

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    this.renderer.setSize(window.innerWidth, window.innerHeight)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#0a0a0a')
    this.scene.fog = new THREE.Fog('#0a0a0a', 100, 200)

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000)
    this.camera.position.set(0, 50, 80)
    this.camera.lookAt(0, 0, 0)

    const light = new THREE.DirectionalLight('#ffffff', 1.2)
    light.position.set(20, 30, 10)
    light.castShadow = true
    this.scene.add(light, new THREE.AmbientLight('#404040', 0.5))

    const grid = new THREE.GridHelper(200, 80, 0x444444, 0x222222)
    this.scene.add(grid)
    // Axis labels overlay via sprites will be updated in updateFromState

    window.addEventListener('resize', this.onResize)
    
    // Start animation loop
    this.animate()
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private animate = () => {
    requestAnimationFrame(this.animate)
    // render() is called from App.tsx after game state update
  }

  updateFromState(state: GameState) {
    // Update ships
    const allShipIds = new Set<string>()
    for (const squad of state.squads.values()) {
      // Skip and cleanup dead squads (no ships)
      if (squad.ships.length === 0) {
        const centerMarkerId = `center-${squad.name}`
        const labelId = `label-${squad.name}`
        const center = this.shipMeshes.get(centerMarkerId)
        if (center) { this.scene.remove(center); this.shipMeshes.delete(centerMarkerId) }
        const label = this.squadLabels.get(labelId)
        if (label) { this.scene.remove(label); this.squadLabels.delete(labelId) }
        const line = this.pathLines.get(squad.name)
        if (line) { this.scene.remove(line); this.pathLines.delete(squad.name) }
        continue
      }
      // Add squad center marker
      const centerMarkerId = `center-${squad.name}`
      let centerMarker = this.shipMeshes.get(centerMarkerId)
      if (!centerMarker && squad.ships.length > 0) {
        const geom = new THREE.SphereGeometry(2, 16, 16)
        const color = squad.name === 'alpha' ? '#ff0000' : 
                     squad.name === 'bravo' ? '#00ff00' : '#0000ff'
        const mat = new THREE.MeshBasicMaterial({ 
          color,
          opacity: 0.3,
          transparent: true
        })
        centerMarker = new THREE.Mesh(geom, mat)
        this.scene.add(centerMarker)
        this.shipMeshes.set(centerMarkerId, centerMarker)
      }
      if (centerMarker) {
        centerMarker.position.copy(squad.center)
        centerMarker.position.y = 0.5
      }
      
      // Add squad label
      const labelId = `label-${squad.name}`
      let label = this.squadLabels.get(labelId)
      if (!label && squad.ships.length > 0) {
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 128
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = 'white'
        ctx.font = 'bold 48px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(squad.name.toUpperCase(), 128, 40)
        ctx.font = '24px Arial'
        ctx.fillText(`${squad.ships.length} ships`, 128, 80)
        
        const texture = new THREE.CanvasTexture(canvas)
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
        label = new THREE.Sprite(material)
        label.scale.set(10, 5, 1)
        this.scene.add(label)
        this.squadLabels.set(labelId, label)
      }
      if (label) {
        label.position.copy(squad.center)
        label.position.y = 8
        // Update ship count
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 128
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = 'white'
        ctx.font = 'bold 48px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(squad.name.toUpperCase(), 128, 40)
        ctx.font = '24px Arial'
        ctx.fillText(`${squad.ships.length} ships`, 128, 80)
        const texture = new THREE.CanvasTexture(canvas)
        ;(label.material as THREE.SpriteMaterial).map = texture
        ;(label.material as THREE.SpriteMaterial).needsUpdate = true
      }
      
      // Draw squad path if exists
      if (squad.path && squad.path.length > 1) {
        let line = this.pathLines.get(squad.name)
        if (!line) {
          const geom = new THREE.BufferGeometry()
          const mat = new THREE.LineBasicMaterial({ 
            color: squad.name === 'alpha' ? '#ff6666' : 
                   squad.name === 'bravo' ? '#66ff66' : '#6666ff',
            opacity: 0.5,
            transparent: true
          })
          line = new THREE.Line(geom, mat)
          this.scene.add(line)
          this.pathLines.set(squad.name, line)
        }
        const points = squad.path.map(p => new THREE.Vector3(p.x, p.y + 0.1, p.z))
        line.geometry.setFromPoints(points)
      } else {
        // Remove path if none
        const line = this.pathLines.get(squad.name)
        if (line) {
          this.scene.remove(line)
          this.pathLines.delete(squad.name)
        }
      }
      
      for (const ship of squad.ships) {
        allShipIds.add(ship.id)
        
        let mesh = this.shipMeshes.get(ship.id)
        if (!mesh) {
          // Create ship mesh
          const geom = new THREE.ConeGeometry(0.8, 2.4, 8)
          const color = squad.name === 'alpha' ? '#ff8888' : 
                       squad.name === 'bravo' ? '#88ff88' : '#8888ff'
          const mat = new THREE.MeshStandardMaterial({ 
            color,
            metalness: 0.3,
            roughness: 0.7,
            emissive: color,
            emissiveIntensity: 0.1
          })
          mesh = new THREE.Mesh(geom, mat)
          this.scene.add(mesh)
          this.shipMeshes.set(ship.id, mesh)
        }
        
        // Update position and rotation
        mesh.position.copy(ship.position)
        mesh.lookAt(ship.position.clone().add(ship.velocity))
        mesh.rotateX(-Math.PI / 2)
        
        // Scale based on HP
        const hpRatio = ship.hp / ship.maxHp
        mesh.scale.setScalar(0.8 + hpRatio * 0.2)
      }
    }
    
    // Landmarks
    for (const m of this.landmarkMeshes) { this.scene.remove(m) }
    this.landmarkMeshes = []
    if (state.landmarks && state.landmarks.length) {
      for (const lm of state.landmarks) {
        const geom = new THREE.TetrahedronGeometry(1.2)
        const mat = new THREE.MeshStandardMaterial({ color: '#ffaa00', emissive: '#442200', emissiveIntensity: 0.4 })
        const mesh = new THREE.Mesh(geom, mat)
        mesh.position.copy(lm.position)
        this.scene.add(mesh)
        this.landmarkMeshes.push(mesh)
        // Label
        const canvas = document.createElement('canvas')
        canvas.width = 256; canvas.height = 128
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = 'white'; ctx.font = 'bold 36px Arial'
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(lm.name.toUpperCase(), 128, 64)
        const tex = new THREE.CanvasTexture(canvas)
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
        spr.scale.set(8,4,1)
        spr.position.copy(lm.position); spr.position.y = 6
        this.scene.add(spr)
      }
    }

    // Remove destroyed ships
    for (const [id, mesh] of this.shipMeshes.entries()) {
      if (!allShipIds.has(id)) {
        this.scene.remove(mesh)
        this.shipMeshes.delete(id)
      }
    }
    
    // Update enemies
    const allEnemyIds = new Set<string>()
    // Only log if count changed significantly
    if (Math.abs(state.enemies.size - this.enemyMeshes.size) > 5) {
      console.log(`[Renderer] Enemy count changed: ${this.enemyMeshes.size} -> ${state.enemies.size}`)
    }
    for (const enemy of state.enemies.values()) {
      allEnemyIds.add(enemy.id)
      
      let mesh = this.enemyMeshes.get(enemy.id)
      if (!mesh) {
        // Create enemy mesh
        const geom = enemy.type === 'capital' ? 
          new THREE.BoxGeometry(4, 2, 6) :
          enemy.type === 'bomber' ?
          new THREE.OctahedronGeometry(1.5) :
          new THREE.TetrahedronGeometry(1.2)
        const mat = new THREE.MeshStandardMaterial({ 
          color: '#ff4444',
          metalness: 0.5,
          roughness: 0.3,
          emissive: '#440000',
          emissiveIntensity: 0.3
        })
        mesh = new THREE.Mesh(geom, mat)
        this.scene.add(mesh)
        this.enemyMeshes.set(enemy.id, mesh)
      }
      
      mesh.position.copy(enemy.position)
      mesh.lookAt(enemy.position.clone().add(enemy.velocity))
      mesh.rotateY(this.clock.getElapsedTime() * 2)
    }
    
    // Remove destroyed enemies
    for (const [id, mesh] of this.enemyMeshes.entries()) {
      if (!allEnemyIds.has(id)) {
        this.scene.remove(mesh)
        this.enemyMeshes.delete(id)
      }
    }
    
    // Update projectiles
    const allProjIds = new Set<string>()
    for (const proj of state.projectiles) {
      allProjIds.add(proj.id)
      
      let mesh = this.projectileMeshes.get(proj.id)
      if (!mesh) {
        const geom = new THREE.SphereGeometry(0.15)
        const color = proj.owner.startsWith('enemy') ? '#ff8800' : '#00ffff'
        const mat = new THREE.MeshBasicMaterial({ 
          color,
          emissive: color,
          emissiveIntensity: 1
        })
        mesh = new THREE.Mesh(geom, mat)
        this.scene.add(mesh)
        this.projectileMeshes.set(proj.id, mesh)
      }
      
      mesh.position.copy(proj.pos)
    }
    
    // Remove expired projectiles
    for (const [id, mesh] of this.projectileMeshes.entries()) {
      if (!allProjIds.has(id)) {
        this.scene.remove(mesh)
        this.projectileMeshes.delete(id)
      }
    }
  }

    updateHandIndicators(gestures: { type: string, hand: string, position: [number, number, number], strength?: number }[], dragPath?: [number, number, number][]) {
    // Clear old indicators
    for (const [id, mesh] of this.handIndicators.entries()) {
      this.scene.remove(mesh)
    }
    this.handIndicators.clear()

    // Add new indicators
    for (const g of gestures) {
      const worldPos = this.screenToWorld(g.position[0], g.position[1])

      // Create indicator based on gesture type
      let geom: THREE.BufferGeometry
      let color: string
      let scale = 1

      if (g.type === 'pinch') {
        geom = new THREE.TorusGeometry(2, 0.5, 8, 16)
        // MediaPipe labels are mirrored - "Left" is user's right hand
        color = g.hand === 'Left' ? '#ffff00' : '#00ffff'
        scale = g.strength || 1
      } else if (g.type === 'drag') {
        geom = new THREE.ConeGeometry(1, 2, 8)
        color = '#00ff00'
      } else if (g.type === 'open') {
        geom = new THREE.PlaneGeometry(4, 4)
        color = '#ffffff'
      } else {
        geom = new THREE.SphereGeometry(1)
        color = '#888888'
      }

      const mat = new THREE.MeshBasicMaterial({
        color,
        opacity: 0.7,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false
      })
      const mesh = new THREE.Mesh(geom, mat)
      mesh.position.copy(worldPos)
      mesh.position.y = 2
      mesh.scale.setScalar(scale)
      mesh.renderOrder = 999

      this.scene.add(mesh)
      this.handIndicators.set(`${g.hand}-${g.type}`, mesh)
    }
    
    // Draw drag path if active
    if (this.dragLine) {
      this.scene.remove(this.dragLine)
      this.dragLine.geometry.dispose()
      ;(this.dragLine.material as THREE.Material).dispose()
      this.dragLine = undefined
    }
    
    if (dragPath && dragPath.length > 1) {
      const points = dragPath.map(p => {
        const wp = this.screenToWorld(p[0], p[1])
        wp.y = 1
        return wp
      })
      
      const geom = new THREE.BufferGeometry().setFromPoints(points)
      const mat = new THREE.LineBasicMaterial({ 
        color: '#00ff00', 
        linewidth: 3,
        opacity: 0.8,
        transparent: true
      })
      this.dragLine = new THREE.Line(geom, mat)
      this.dragLine.renderOrder = 998
      this.scene.add(this.dragLine)
    }
  }
  
  showSelectionRing(squadName: string | null, state: GameState) {
    if (this.selectionRing) {
      this.scene.remove(this.selectionRing)
      this.selectionRing = undefined
    }
    
    if (squadName) {
      const squad = state.squads.get(squadName)
      if (squad) {
        const geom = new THREE.TorusGeometry(10, 0.5, 8, 32)
        const mat = new THREE.MeshBasicMaterial({ 
          color: '#ffff00',
          opacity: 0.5,
          transparent: true
        })
        this.selectionRing = new THREE.Mesh(geom, mat)
        this.selectionRing.position.copy(squad.center)
        this.selectionRing.position.y = 0.1
        this.selectionRing.rotation.x = -Math.PI / 2
        this.scene.add(this.selectionRing)
      }
    }
  }
  
  private screenToWorld(x: number, y: number): THREE.Vector3 {
    // MediaPipe gives mirrored coordinates
    const worldX = (0.5 - x) * 100  // Flip for mirror
    const worldZ = (y - 0.5) * 100
    return new THREE.Vector3(worldX, 0, worldZ)
  }

  // Future: draw grid coordinates (A..H, 1..8) as overlay sprites

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}