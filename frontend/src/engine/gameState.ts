import * as THREE from 'three'

export interface Ship {
  id: string
  squad: 'alpha' | 'bravo' | 'charlie'
  position: THREE.Vector3
  velocity: THREE.Vector3
  target?: THREE.Vector3
  hp: number
  maxHp: number
  cooldown?: number
}

export interface Enemy {
  id: string
  type: 'fighter' | 'bomber' | 'capital'
  position: THREE.Vector3
  velocity: THREE.Vector3
  target?: string  // ship id
  hp: number
  maxHp: number
  cooldown?: number
}

export interface Squad {
  name: 'alpha' | 'bravo' | 'charlie'
  ships: Ship[]
  formation: 'wedge' | 'wall' | 'sphere' | 'swarm' | 'column'
  center: THREE.Vector3
  heading: number
  speed: number
  path?: THREE.Vector3[]  // waypoints from gestures
  currentWaypoint?: number
  pathCycle?: boolean
  encircle?: {
    center: THREE.Vector3
    radius: number
    angularSpeed: number
    angle: number
  }
}

export class GameState {
  squads: Map<string, Squad> = new Map()
  enemies: Map<string, Enemy> = new Map()
  projectiles: { id: string, pos: THREE.Vector3, vel: THREE.Vector3, owner: string, damage: number }[] = []
  frame = 0
  landmarks: { name: string, position: THREE.Vector3 }[] = []
  private assaultPulseTimer = 0
  
  constructor() {
    this.initSquads()
    this.initLandmarks()
  }
  
  private initSquads() {
    // Create 3 squads of 20 ships each
    const squadNames: ('alpha' | 'bravo' | 'charlie')[] = ['alpha', 'bravo', 'charlie']
    
    for (let s = 0; s < squadNames.length; s++) {
      const squadName = squadNames[s]
      const ships: Ship[] = []
      
      for (let i = 0; i < 20; i++) {
        const ship: Ship = {
          id: `${squadName}-${i}`,
          squad: squadName,
          position: new THREE.Vector3(
            (i % 5) * 3 - 6,
            0.5,
            Math.floor(i / 5) * 3 + s * 20 - 20
          ),
          velocity: new THREE.Vector3(0, 0, 0),
          hp: 100,
          maxHp: 100,
          cooldown: 0
        }
        ships.push(ship)
      }
      
      this.squads.set(squadName, {
        name: squadName,
        ships,
        formation: 'wedge',
        center: new THREE.Vector3(0, 0, s * 20 - 20),
        heading: 0,
        speed: 2,
        path: undefined,
        currentWaypoint: undefined,
        pathCycle: false,
        encircle: undefined
      })
    }
  }

  private initLandmarks() {
    this.landmarks = [
      { name: 'delta', position: new THREE.Vector3(30, 0, -30) },
      { name: 'echo', position: new THREE.Vector3(-35, 0, 25) },
      { name: 'foxtrot', position: new THREE.Vector3(10, 0, 40) },
    ]
  }
  
  update(dt: number) {
    this.frame++
    this.assaultPulseTimer += dt
    
    // Update squad movements
    for (const squad of this.squads.values()) {
      this.updateSquad(squad, dt)
    }
    
    // Update enemies
    for (const enemy of this.enemies.values()) {
      this.updateEnemy(enemy, dt)
    }
    
    // Update projectiles
    this.updateProjectiles(dt)
    
    // Check collisions
    this.checkCollisions()

    // Assault pulses: periodic fighter injections to keep pressure up
    const wave = Math.floor(this.frame / 600) + 1
    const pulseInterval = Math.max(5, 12 - wave) // faster with waves, floor at 5s
    if (this.assaultPulseTimer >= pulseInterval) {
      this.assaultPulseTimer = 0
      const count = Math.min(20, 2 + Math.floor(wave * 1.5))
      this.spawnAssaultBurst(count)
    }
  }
  
  private updateSquad(squad: Squad, dt: number) {
    // Follow path if exists
    if (squad.path && squad.path.length > 0) {
      const waypoint = squad.currentWaypoint ?? 0
      if (waypoint < squad.path.length) {
        const target = squad.path[waypoint]
        const toTarget = target.clone().sub(squad.center)
        const dist = toTarget.length()
        
         if (dist < 2) {
          // Reached waypoint
          const next = waypoint + 1
          if (next >= squad.path.length) {
            if (squad.pathCycle) {
              squad.currentWaypoint = 0
            } else {
              squad.path = undefined
              squad.currentWaypoint = undefined
            }
          } else {
            squad.currentWaypoint = next
          }
        } else {
          // Move toward waypoint
          const dir = toTarget.normalize()
           squad.center.addScaledVector(dir, squad.speed * dt)
          squad.heading = Math.atan2(dir.x, dir.z)
        }
      }
    } else if (squad.encircle) {
      // Encircle behavior: move along a circle around center
      squad.encircle.angle = (squad.encircle.angle + squad.encircle.angularSpeed * dt) % (Math.PI * 2)
      const ex = squad.encircle.center.x + Math.cos(squad.encircle.angle) * squad.encircle.radius
      const ez = squad.encircle.center.z + Math.sin(squad.encircle.angle) * squad.encircle.radius
      const target = new THREE.Vector3(ex, 0, ez)
      const toTarget = target.sub(squad.center)
      const dist = toTarget.length()
      const dir = dist > 0.0001 ? toTarget.normalize() : new THREE.Vector3(0,0,0)
      squad.center.addScaledVector(dir, squad.speed * dt)
      if (dir.lengthSq() > 0) squad.heading = Math.atan2(dir.x, dir.z)
    }
    
    // Update individual ships to maintain formation
    this.applyFormation(squad, dt)
    
    // Auto-fire at enemies in range (always on)
    const FIRE_RANGE = 50  // 1.3x previous 20
    const FIRE_COOLDOWN = 0.25
    for (const ship of squad.ships) {
      ship.cooldown = Math.max(0, (ship.cooldown ?? 0) - dt)
      let fired = false
      for (const enemy of this.enemies.values()) {
        const dist = ship.position.distanceTo(enemy.position)
        if (dist < FIRE_RANGE) {
          if (ship.cooldown <= 0) {
            const aim = enemy.position.clone().sub(ship.position).normalize()
            this.fireProjectile(ship.position, aim, ship.id, 15)
            ship.cooldown = FIRE_COOLDOWN
            fired = true
          }
          break
        }
      }
      if (!fired && ship.cooldown < 0.05) {
        // small random jitter to avoid sync volleys
        ship.cooldown += Math.random() * 0.02
      }
    }
  }
  
  private applyFormation(squad: Squad, dt: number) {
    const { formation, center, heading, ships } = squad
    
    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i]
      let localPos = new THREE.Vector3()
      
      switch (formation) {
        case 'wedge': {
          const row = Math.floor(i / 5)
          const col = i % 5 - 2
          localPos.set(col * 2 + row * 0.5, 0, row * -3)
          break
        }
        case 'wall': {
          const row = Math.floor(i / 10)
          const col = i % 10 - 5
          localPos.set(col * 2, 0, row * -3)
          break
        }
        case 'sphere': {
          const theta = (i / ships.length) * Math.PI * 2
          const phi = Math.acos(1 - 2 * (i / ships.length))
          const r = 8
          localPos.set(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
          )
          break
        }
        case 'column': {
          const col = i % 2
          const row = Math.floor(i / 2)
          localPos.set(col * 2 - 1, 0, row * -2)
          break
        }
        default: // swarm
          const angle = (i / ships.length) * Math.PI * 2
          const r = 3 + (i % 3) * 2
          localPos.set(r * Math.cos(angle), 0, r * Math.sin(angle))
      }
      
      // Rotate by heading
      localPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading)
      
      // Target position
      const targetPos = center.clone().add(localPos)
      
      // Smooth movement toward target
      const toTarget = targetPos.sub(ship.position)
      ship.velocity.lerp(toTarget.multiplyScalar(2), 0.1)
      ship.position.addScaledVector(ship.velocity, dt)
    }
  }
  
  private updateEnemy(enemy: Enemy, dt: number) {
    // Behavior varies by type; all target nearest ship
    let nearest: Ship | null = null
    let minDist = Infinity
    for (const squad of this.squads.values()) {
      for (const ship of squad.ships) {
        const d = enemy.position.distanceTo(ship.position)
        if (d < minDist) { minDist = d; nearest = ship }
      }
    }
    if (!nearest) return
    const toTarget = nearest.position.clone().sub(enemy.position)
    const dist = toTarget.length()
    const dir = dist > 0.0001 ? toTarget.normalize() : new THREE.Vector3(0,0,0)
    
    const wave = Math.floor(this.frame / 600) + 1
    const speedMul = 1 + wave * 0.12
    const cdMul = 1 + wave * 0.06
    if (enemy.type === 'fighter') {
      // Fast, strafing behavior
      const desired = dir.clone().multiplyScalar(9 * speedMul)
      // Strafe perpendicular a bit
      const strafe = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.sin(this.frame * 0.12 + enemy.position.x) * 3)
      enemy.velocity.lerp(desired.add(strafe), 0.12)
      enemy.position.addScaledVector(enemy.velocity, dt)
      // Fire short-range bursts
      enemy.cooldown = Math.max(0, (enemy.cooldown ?? 0) - dt)
      if (dist < 30 && enemy.cooldown <= 0) {
        this.fireProjectile(enemy.position, dir, enemy.id, 8)
        enemy.cooldown = 0.15 / cdMul
      }
    } else if (enemy.type === 'bomber') {
      // Slow, heads straight in, drops a spread at mid-range
      const desired = dir.clone().multiplyScalar(4.5 * speedMul)
      enemy.velocity.lerp(desired, 0.07)
      enemy.position.addScaledVector(enemy.velocity, dt)
      enemy.cooldown = Math.max(0, (enemy.cooldown ?? 0) - dt)
      if (dist < 55 && enemy.cooldown <= 0) {
        const shots = 7 + Math.min(8, Math.floor(wave/2))
        const spreadWidth = 0.5
        for (let i = 0; i < shots; i++) {
          const a = -spreadWidth/2 + (spreadWidth/(shots-1)) * i
          const spread = new THREE.Vector3(
            dir.x * Math.cos(a) - dir.z * Math.sin(a),
            0,
            dir.x * Math.sin(a) + dir.z * Math.cos(a)
          )
          this.fireProjectile(enemy.position, spread, enemy.id, 12)
        }
        enemy.cooldown = 0.9 / cdMul
      }
    } else { // capital
      // Very slow, turreted long-range fire
      const desired = dir.clone().multiplyScalar(2.2 * speedMul)
      enemy.velocity.lerp(desired, 0.045)
      enemy.position.addScaledVector(enemy.velocity, dt)
      enemy.cooldown = Math.max(0, (enemy.cooldown ?? 0) - dt)
      if (dist < 100 && enemy.cooldown <= 0) {
        this.fireProjectile(enemy.position, dir, enemy.id, 15)
        enemy.cooldown = 0.4 / cdMul
      }
    }
  }

  private spawnAssaultBurst(count: number) {
    // Spawn fighters closer and on multiple arcs
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = 45 + Math.random()*15
      const enemy: Enemy = {
        id: `pulse-${Date.now()}-${i}`,
        type: 'fighter',
        position: new THREE.Vector3(Math.cos(angle)*radius, 0.5, Math.sin(angle)*radius),
        velocity: new THREE.Vector3(0,0,0),
        hp: 50,
        maxHp: 50,
        cooldown: 0
      }
      this.enemies.set(enemy.id, enemy)
    }
  }
  
  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      p.pos.addScaledVector(p.vel, dt)
      
      // Remove if out of bounds
      if (p.pos.length() > 150) {
        this.projectiles.splice(i, 1)
      }
    }
  }
  
  private checkCollisions() {
    // Check projectile-ship collisions
    for (const p of this.projectiles) {
      for (const squad of this.squads.values()) {
        for (const ship of squad.ships) {
          if (p.owner.startsWith('enemy') && p.pos.distanceTo(ship.position) < 1) {
            ship.hp -= p.damage
            p.damage = 0  // mark for removal
          }
        }
      }
      
      // Check projectile-enemy collisions
      for (const enemy of this.enemies.values()) {
        if (!p.owner.startsWith('enemy') && p.pos.distanceTo(enemy.position) < 2) {
          enemy.hp -= p.damage
          p.damage = 0
        }
      }
    }
    
    // Remove dead projectiles and entities
    this.projectiles = this.projectiles.filter(p => p.damage > 0)
    
    for (const squad of this.squads.values()) {
      squad.ships = squad.ships.filter(s => s.hp > 0)
    }
    
    for (const [id, enemy] of this.enemies.entries()) {
      if (enemy.hp <= 0) this.enemies.delete(id)
    }
  }
  
  fireProjectile(from: THREE.Vector3, direction: THREE.Vector3, owner: string, damage: number) {
    this.projectiles.push({
      id: Math.random().toString(36),
      pos: from.clone(),
      vel: direction.multiplyScalar(20),
      owner,
      damage
    })
  }
  
  spawnEnemyWave(count: number) {
    const wave = Math.floor(this.frame / 600) + 1
    const fighterBias = Math.min(0.9, 0.6 + wave * 0.05)
    const bomberChance = Math.min(0.3, 0.15 + wave * 0.02)
    const capitalChance = Math.min(0.1, 0.02 + Math.floor(wave/4) * 0.02)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random()*0.4
      const radius = 70 + Math.random()*20
      const r = Math.random()
      const type: Enemy['type'] = r < capitalChance ? 'capital' : r < capitalChance + bomberChance ? 'bomber' : 'fighter'
      const enemy: Enemy = {
        id: `enemy-${Date.now()}-${i}-${Math.floor(Math.random()*1e6)}`,
        type,
        position: new THREE.Vector3(
          Math.cos(angle) * radius,
          0.5,
          Math.sin(angle) * radius
        ),
        velocity: new THREE.Vector3(0, 0, 0),
        hp: 50,
        maxHp: 50,
        cooldown: 0
      }
      this.enemies.set(enemy.id, enemy)
    }
  }
  
  // Get world context for LLM
  getWorldContext() {
    // Detailed squad telemetry
    const squadInfo: any = {}
    for (const [name, s] of this.squads.entries()) {
      const enemiesInRange = Array.from(this.enemies.values())
        .map(e => ({ id: e.id, dist: e.position.distanceTo(s.center) }))
        .filter(e => e.dist < 50)
        .sort((a, b) => a.dist - b.dist)
      
      const nearestEnemy = enemiesInRange[0]
      const underFire = enemiesInRange.some(e => e.dist < 20)
      
      squadInfo[name] = {
        alive: s.ships.length > 0,
        shipCount: s.ships.length,
        maxShips: 20,
        health: Math.round((s.ships.length / 20) * 100) + '%',
        formation: s.formation,
        position: { 
          x: Math.round(s.center.x), 
          z: Math.round(s.center.z),
          quadrant: this.getQuadrant(s.center.x, s.center.z)
        },
        heading: Math.round(s.heading * 180 / Math.PI),
        headingDirection: this.getHeadingDirection(s.heading),
        speed: s.speed,
        status: underFire ? 'combat' : s.path ? 'moving' : 'idle',
        isMoving: !!s.path && s.path.length > 0,
        pathRemaining: s.path ? s.path.length - (s.currentWaypoint || 0) : 0,
        underAttack: underFire,
        enemiesNearby: enemiesInRange.length,
        nearestEnemyDistance: nearestEnemy ? Math.round(nearestEnemy.dist) : null,
        canFire: true,
        fireRange: 20
      }
    }
    
    // Enemy clusters and threats
    const enemyClusters = this.getEnemyClusters()
    const threats = enemyClusters.map(cluster => ({
      size: cluster.enemies.length,
      center: { x: Math.round(cluster.center.x), z: Math.round(cluster.center.z) },
      quadrant: this.getQuadrant(cluster.center.x, cluster.center.z),
      nearestSquad: cluster.nearestSquad,
      distance: Math.round(cluster.distance),
      threat: cluster.enemies.length > 10 ? 'high' : cluster.enemies.length > 5 ? 'medium' : 'low'
    }))
    
    // Battlefield analysis
    const battlefield = {
      dimensions: { width: 100, height: 100 },
      center: { x: 0, z: 0 },
      squadPositions: Object.entries(squadInfo).map(([name, info]: [string, any]) => 
        `${name}:${info.position.quadrant}`
      ),
      enemyConcentration: threats.length > 0 ? threats[0].quadrant : 'none',
      combatZones: threats.filter(t => t.distance < 30).map(t => t.quadrant)
    }
    
    // Tactical suggestions based on state
    const tactical = {
      squadsAlive: Object.values(squadInfo).filter((s: any) => s.alive).length,
      squadsInCombat: Object.values(squadInfo).filter((s: any) => s.status === 'combat').length,
      recommendedAction: this.getRecommendedAction(squadInfo, threats),
      enemyPressure: this.enemies.size > 30 ? 'overwhelming' : 
                     this.enemies.size > 15 ? 'heavy' : 
                     this.enemies.size > 5 ? 'moderate' : 'light'
    }
    
    return {
      timestamp: Date.now(),
      frame: this.frame,
      squads: squadInfo,
      enemyCount: this.enemies.size,
      threats,
      battlefield,
      tactical,
      projectilesActive: this.projectiles.length,
      waveNumber: Math.floor(this.frame / 600) + 1  // Estimate wave based on frame
    }
  }
  
  private getQuadrant(x: number, z: number): string {
    if (x >= 0 && z >= 0) return 'northeast'
    if (x < 0 && z >= 0) return 'northwest'  
    if (x < 0 && z < 0) return 'southwest'
    return 'southeast'
  }
  
  private getHeadingDirection(heading: number): string {
    const deg = heading * 180 / Math.PI
    const normalized = (deg + 360) % 360
    if (normalized < 45 || normalized >= 315) return 'east'
    if (normalized < 135) return 'north'
    if (normalized < 225) return 'west'
    return 'south'
  }
  
  private getEnemyClusters() {
    const clusters: any[] = []
    const processed = new Set<string>()
    
    for (const enemy of this.enemies.values()) {
      if (processed.has(enemy.id)) continue
      
      const cluster = {
        enemies: [enemy],
        center: enemy.position.clone()
      }
      
      // Find nearby enemies
      for (const other of this.enemies.values()) {
        if (other.id !== enemy.id && !processed.has(other.id)) {
          if (enemy.position.distanceTo(other.position) < 20) {
            cluster.enemies.push(other)
            processed.add(other.id)
          }
        }
      }
      
      processed.add(enemy.id)
      
      // Calculate cluster center
      if (cluster.enemies.length > 1) {
        cluster.center = new THREE.Vector3()
        for (const e of cluster.enemies) {
          cluster.center.add(e.position)
        }
        cluster.center.divideScalar(cluster.enemies.length)
      }
      
      // Find nearest squad
      let nearest = { name: '', dist: Infinity }
      for (const [name, squad] of this.squads.entries()) {
        const dist = cluster.center.distanceTo(squad.center)
        if (dist < nearest.dist) {
          nearest = { name, dist }
        }
      }
      
      clusters.push({
        enemies: cluster.enemies,
        center: cluster.center,
        nearestSquad: nearest.name,
        distance: nearest.dist
      })
    }
    
    return clusters.sort((a, b) => b.enemies.length - a.enemies.length)
  }
  
  private getRecommendedAction(squads: any, threats: any[]): string {
    const aliveCount = Object.values(squads).filter((s: any) => s.alive).length
    const combatCount = Object.values(squads).filter((s: any) => s.status === 'combat').length
    
    if (aliveCount === 0) return 'respawn_needed'
    if (threats.length === 0) return 'patrol'
    if (combatCount === aliveCount) return 'tactical_retreat'
    if (threats[0]?.threat === 'high') return 'concentrate_fire'
    if (aliveCount === 3 && combatCount === 0) return 'advance'
    return 'hold_position'
  }
}
