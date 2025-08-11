import * as THREE from 'three'
import type { GameState, SquadType } from './gameState'

export class InstancedRenderer {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  
  // Instanced meshes for performance
  private shipInstances: Map<SquadType, THREE.InstancedMesh> = new Map()
  private enemyInstances: Map<string, THREE.InstancedMesh> = new Map()
  private projectileInstance?: THREE.InstancedMesh
  
  // UI elements
  private squadLabels: Map<string, THREE.Sprite> = new Map()
  private pathLines: Map<string, THREE.Line> = new Map()
  private handIndicators: Map<string, THREE.Mesh> = new Map()
  private selectionRing?: THREE.Mesh
  private dragLine?: THREE.Line
  private landmarkMeshes: THREE.Mesh[] = []
  
  private clock = new THREE.Clock()
  private tempMatrix = new THREE.Matrix4()
  private tempColor = new THREE.Color()
  
  // Camera control state
  private keysPressed = new Set<string>()
  private cameraVelocity = new THREE.Vector3()

  constructor(canvas: HTMLCanvasElement) {
    // Configure renderer for performance
    this.renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: false,  // Disable for performance
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio))  // Cap pixel ratio
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = false  // Disable shadows for performance

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#0a0a0a')
    this.scene.fog = new THREE.Fog('#0a0a0a', 100, 200)

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000)
    this.camera.position.set(0, 50, 80)
    this.camera.lookAt(0, 0, 0)

    // Simple lighting for performance
    const light = new THREE.DirectionalLight('#ffffff', 1.2)
    light.position.set(20, 30, 10)
    this.scene.add(light, new THREE.AmbientLight('#404040', 0.5))

    // Grid
    const grid = new THREE.GridHelper(200, 80, 0x444444, 0x222222)
    this.scene.add(grid)

    // Initialize instanced meshes
    this.initInstancedMeshes()

    window.addEventListener('resize', this.onResize)
    
    // Add keyboard controls for camera
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    
    this.animate()
  }

  private initInstancedMeshes() {
    const squadTypes: SquadType[] = ['assault', 'sniper', 'bomber', 'defender']
    
    // Create instanced mesh for each squad type (max 500 ships per type)
    for (const type of squadTypes) {
      const geometry = this.getSquadGeometry(type)
      const material = new THREE.MeshStandardMaterial({
        color: this.getSquadColor(type),
        metalness: type === 'sniper' ? 0.6 : 0.3,
        roughness: type === 'defender' ? 0.3 : 0.7
      })
      
      const instancedMesh = new THREE.InstancedMesh(geometry, material, 500)
      instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      instancedMesh.frustumCulled = false  // Always render for simplicity
      this.scene.add(instancedMesh)
      this.shipInstances.set(type, instancedMesh)
    }
    
    // Enemy instances (3 types, 300 each)
    const enemyTypes = ['fighter', 'bomber', 'capital']
    for (const type of enemyTypes) {
      const geom = type === 'capital' ? 
        new THREE.BoxGeometry(4, 2, 6) :
        type === 'bomber' ?
        new THREE.OctahedronGeometry(1.5) :
        new THREE.TetrahedronGeometry(1.2)
      
      const mat = new THREE.MeshStandardMaterial({ 
        color: '#ff4444',
        metalness: 0.5,
        roughness: 0.3
      })
      
      const instancedMesh = new THREE.InstancedMesh(geom, mat, 300)
      instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      instancedMesh.frustumCulled = false
      this.scene.add(instancedMesh)
      this.enemyInstances.set(type, instancedMesh)
    }
    
    // Projectile instances (2000 max)
    const projGeom = new THREE.SphereGeometry(0.15, 4, 4)  // Low poly for performance
    const projMat = new THREE.MeshBasicMaterial({ color: '#00ffff' })
    this.projectileInstance = new THREE.InstancedMesh(projGeom, projMat, 2000)
    this.projectileInstance.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.projectileInstance.frustumCulled = false
    this.scene.add(this.projectileInstance)
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private animate = () => {
    requestAnimationFrame(this.animate)
    this.updateCamera()
  }
  
  private onKeyDown = (e: KeyboardEvent) => {
    // Don't interfere with space bar (push to talk)
    if (e.code === 'Space') return
    
    // Store the actual key code
    this.keysPressed.add(e.code)
  }
  
  private onKeyUp = (e: KeyboardEvent) => {
    this.keysPressed.delete(e.code)
  }
  
  private updateCamera() {
    const speed = 2
    const damping = 0.9
    
    // WASD movement (use proper KeyCode values)
    if (this.keysPressed.has('KeyW')) {
      this.cameraVelocity.z -= speed
    }
    if (this.keysPressed.has('KeyS')) {
      this.cameraVelocity.z += speed
    }
    if (this.keysPressed.has('KeyA')) {
      this.cameraVelocity.x -= speed
    }
    if (this.keysPressed.has('KeyD')) {
      this.cameraVelocity.x += speed
    }
    
    // Q/E for up/down
    if (this.keysPressed.has('KeyQ')) {
      this.cameraVelocity.y -= speed * 0.5
    }
    if (this.keysPressed.has('KeyE')) {
      this.cameraVelocity.y += speed * 0.5
    }
    
    // Apply velocity with damping
    this.camera.position.add(this.cameraVelocity)
    this.cameraVelocity.multiplyScalar(damping)
    
    // Keep camera looking at center area
    const lookTarget = new THREE.Vector3(0, 0, 0)
    this.camera.lookAt(lookTarget)
    
    // Clamp camera height
    this.camera.position.y = Math.max(10, Math.min(150, this.camera.position.y))
  }

  updateFromState(state: GameState) {
    // Update ships using instanced rendering
    const shipCounts = new Map<SquadType, number>()
    for (const type of ['assault', 'sniper', 'bomber', 'defender'] as SquadType[]) {
      shipCounts.set(type, 0)
    }
    
    for (const squad of state.squads.values()) {
      if (squad.ships.length === 0) continue
      
      const instancedMesh = this.shipInstances.get(squad.squadType)
      if (!instancedMesh) continue
      
      let instanceIndex = shipCounts.get(squad.squadType) || 0
      
      for (const ship of squad.ships) {
        if (instanceIndex >= 500) break  // Max instances
        
        // Set position and rotation
        this.tempMatrix.makeRotationFromEuler(
          new THREE.Euler(-Math.PI/2, Math.atan2(ship.velocity.x, ship.velocity.z), 0)
        )
        this.tempMatrix.setPosition(ship.position)
        
        // Scale based on HP
        const scale = 0.8 + (ship.hp / ship.maxHp) * 0.2
        this.tempMatrix.scale(new THREE.Vector3(scale, scale, scale))
        
        instancedMesh.setMatrixAt(instanceIndex, this.tempMatrix)
        instanceIndex++
      }
      
      shipCounts.set(squad.squadType, instanceIndex)
    }
    
    // Hide unused instances
    for (const [type, mesh] of this.shipInstances.entries()) {
      const count = shipCounts.get(type) || 0
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
    }
    
    // Update enemies using instanced rendering
    const enemyCounts = new Map<string, number>()
    for (const type of ['fighter', 'bomber', 'capital']) {
      enemyCounts.set(type, 0)
    }
    
    for (const enemy of state.enemies.values()) {
      const instancedMesh = this.enemyInstances.get(enemy.type)
      if (!instancedMesh) continue
      
      let instanceIndex = enemyCounts.get(enemy.type) || 0
      if (instanceIndex >= 300) continue  // Max instances per type
      
      this.tempMatrix.makeRotationY(this.clock.getElapsedTime() * 2)
      this.tempMatrix.setPosition(enemy.position)
      
      instancedMesh.setMatrixAt(instanceIndex, this.tempMatrix)
      enemyCounts.set(enemy.type, instanceIndex + 1)
    }
    
    for (const [type, mesh] of this.enemyInstances.entries()) {
      const count = enemyCounts.get(type) || 0
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
    }
    
    // Update projectiles using instanced rendering
    if (this.projectileInstance) {
      let projIndex = 0
      for (const proj of state.projectiles) {
        if (projIndex >= 2000) break
        
        this.tempMatrix.makeScale(1, 1, 1)
        this.tempMatrix.setPosition(proj.pos)
        this.projectileInstance.setMatrixAt(projIndex, this.tempMatrix)
        
        // Set color based on owner
        const color = proj.owner.startsWith('enemy') ? 0xff8800 : 0x00ffff
        this.projectileInstance.setColorAt(projIndex, this.tempColor.setHex(color))
        
        projIndex++
      }
      
      this.projectileInstance.count = projIndex
      this.projectileInstance.instanceMatrix.needsUpdate = true
      if (this.projectileInstance.instanceColor) {
        this.projectileInstance.instanceColor.needsUpdate = true
      }
    }
    
    // Update squad labels (keep these as sprites for readability)
    this.updateSquadLabels(state)
    
    // Update landmarks
    this.updateLandmarks(state)
    
    // Update paths
    this.updatePaths(state)
  }
  
  private updateSquadLabels(state: GameState) {
    for (const squad of state.squads.values()) {
      const labelId = `label-${squad.name}`
      
      if (squad.ships.length === 0) {
        // Remove label if squad is dead
        const label = this.squadLabels.get(labelId)
        if (label) {
          this.scene.remove(label)
          this.squadLabels.delete(labelId)
        }
        continue
      }
      
      let label = this.squadLabels.get(labelId)
      if (!label) {
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 128
        const texture = new THREE.CanvasTexture(canvas)
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
        label = new THREE.Sprite(material)
        label.scale.set(10, 5, 1)
        this.scene.add(label)
        this.squadLabels.set(labelId, label)
      }
      
      // Update label content
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 128
      const ctx = canvas.getContext('2d')!
      
      // Squad type color
      ctx.fillStyle = this.getSquadColor(squad.squadType)
      ctx.fillRect(0, 0, 256, 4)
      
      ctx.fillStyle = 'white'
      ctx.font = 'bold 48px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(squad.name.toUpperCase(), 128, 40)
      ctx.font = '20px Arial'
      ctx.fillText(`${squad.squadType} | ${squad.ships.length} ships`, 128, 80)
      
      const texture = new THREE.CanvasTexture(canvas)
      ;(label.material as THREE.SpriteMaterial).map = texture
      ;(label.material as THREE.SpriteMaterial).needsUpdate = true
      
      label.position.copy(squad.center)
      label.position.y = 8
    }
  }
  
  private updateLandmarks(state: GameState) {
    // Clear old landmarks
    for (const m of this.landmarkMeshes) {
      this.scene.remove(m)
    }
    this.landmarkMeshes = []
    
    if (state.landmarks && state.landmarks.length) {
      for (const lm of state.landmarks) {
        const geom = new THREE.TetrahedronGeometry(1.2)
        const mat = new THREE.MeshStandardMaterial({ 
          color: '#ffaa00', 
          emissive: '#442200', 
          emissiveIntensity: 0.4 
        })
        const mesh = new THREE.Mesh(geom, mat)
        mesh.position.copy(lm.position)
        this.scene.add(mesh)
        this.landmarkMeshes.push(mesh)
        
        // Label
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 128
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = 'white'
        ctx.font = 'bold 36px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(lm.name.toUpperCase(), 128, 64)
        
        const tex = new THREE.CanvasTexture(canvas)
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
        spr.scale.set(8, 4, 1)
        spr.position.copy(lm.position)
        spr.position.y = 6
        this.scene.add(spr)
        this.landmarkMeshes.push(spr as any)
      }
    }
  }
  
  private updatePaths(state: GameState) {
    for (const squad of state.squads.values()) {
      if (squad.path && squad.path.length > 1) {
        let line = this.pathLines.get(squad.name)
        if (!line) {
          const geom = new THREE.BufferGeometry()
          const mat = new THREE.LineBasicMaterial({ 
            color: this.getSquadColor(squad.squadType),
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
        const line = this.pathLines.get(squad.name)
        if (line) {
          this.scene.remove(line)
          this.pathLines.delete(squad.name)
        }
      }
    }
  }

  updateHandIndicators(gestures: { type: string, hand: string, position: [number, number, number], strength?: number }[], dragPath?: [number, number, number][]) {
    // Clear old indicators
    for (const [, mesh] of this.handIndicators.entries()) {
      this.scene.remove(mesh)
    }
    this.handIndicators.clear()

    // Add new indicators
    for (const g of gestures) {
      const worldPos = this.screenToWorld(g.position[0], g.position[1])

      let geom: THREE.BufferGeometry
      let color: string
      let scale = 1

      if (g.type === 'pinch') {
        geom = new THREE.TorusGeometry(2, 0.5, 8, 16)
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
    const worldX = (0.5 - x) * 100
    const worldZ = (y - 0.5) * 100
    return new THREE.Vector3(worldX, 0, worldZ)
  }
  
  private getSquadColor(type: SquadType): string {
    switch (type) {
      case 'assault': return '#ff4444'
      case 'sniper': return '#aa44ff'
      case 'bomber': return '#ff8844'
      case 'defender': return '#4488ff'
      default: return '#888888'
    }
  }
  
  private getSquadGeometry(type: SquadType): THREE.BufferGeometry {
    switch (type) {
      case 'assault':
        return new THREE.ConeGeometry(0.7, 2.8, 6)
      case 'sniper':
        return new THREE.OctahedronGeometry(0.8, 0)
      case 'bomber':
        return new THREE.SphereGeometry(1, 8, 6)
      case 'defender':
        return new THREE.BoxGeometry(1.2, 0.8, 1.8)
      default:
        return new THREE.ConeGeometry(0.8, 2.4, 8)
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
