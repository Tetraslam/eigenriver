import * as THREE from 'three'
import type { GameState } from './gameState'

export type WavePattern = 'surround' | 'blitz' | 'pincer' | 'artillery' | 'swarm' | 'boss'

export class WaveManager {
  private currentWave = 0
  private subWave = 0
  private waveTimer = 0
  private bossSpawned = false
  
  getNextWave(): { pattern: WavePattern, count: number, composition: string } {
    this.currentWave++
    this.subWave = 0
    this.bossSpawned = false
    
    // Every 5 waves is a boss wave
    if (this.currentWave % 5 === 0) {
      return {
        pattern: 'boss',
        count: 20 + this.currentWave * 2,
        composition: 'Boss wave with escorts'
      }
    }
    
    // Progressive difficulty with variety
    const patterns: WavePattern[] = ['surround', 'blitz', 'pincer', 'artillery', 'swarm']
    const pattern = patterns[Math.floor(Math.random() * patterns.length)]
    
    // Base count increases with waves
    const baseCount = 25 + this.currentWave * 8
    const variance = Math.floor(Math.random() * 20) - 10
    const count = Math.min(600, baseCount + variance)
    
    let composition = ''
    switch (pattern) {
      case 'surround':
        composition = 'Enemies from all directions'
        break
      case 'blitz':
        composition = 'Fast assault from one direction'
        break
      case 'pincer':
        composition = 'Two-pronged attack'
        break
      case 'artillery':
        composition = 'Long-range bombardment'
        break
      case 'swarm':
        composition = 'Massive fighter swarm'
        break
    }
    
    return { pattern, count, composition }
  }
  
  spawnWavePattern(state: GameState, pattern: WavePattern, count: number) {
    const enemies: any[] = []
    
    switch (pattern) {
      case 'surround':
        // Enemies spawn in a circle around the battlefield
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2
          const radius = 70 + Math.random() * 20
          enemies.push({
            type: i % 10 === 0 ? 'bomber' : 'fighter',
            x: Math.cos(angle) * radius,
            z: Math.sin(angle) * radius
          })
        }
        break
        
      case 'blitz':
        // All enemies from one direction, very fast
        const blitzAngle = Math.random() * Math.PI * 2
        for (let i = 0; i < count; i++) {
          const spread = (Math.random() - 0.5) * 40
          const depth = Math.random() * 30
          enemies.push({
            type: 'fighter',
            x: Math.cos(blitzAngle) * (60 + depth) + Math.cos(blitzAngle + Math.PI/2) * spread,
            z: Math.sin(blitzAngle) * (60 + depth) + Math.sin(blitzAngle + Math.PI/2) * spread,
            speedMultiplier: 1.5
          })
        }
        break
        
      case 'pincer':
        // Two groups from opposite sides
        const pincerAngle = Math.random() * Math.PI
        for (let i = 0; i < count; i++) {
          const side = i < count / 2 ? 0 : Math.PI
          const angle = pincerAngle + side + (Math.random() - 0.5) * 0.5
          const radius = 60 + Math.random() * 20
          enemies.push({
            type: i % 8 === 0 ? 'bomber' : 'fighter',
            x: Math.cos(angle) * radius,
            z: Math.sin(angle) * radius
          })
        }
        break
        
      case 'artillery':
        // Mostly bombers and capitals at long range
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2
          const radius = 80 + Math.random() * 30
          enemies.push({
            type: i % 3 === 0 ? 'capital' : 'bomber',
            x: Math.cos(angle) * radius,
            z: Math.sin(angle) * radius
          })
        }
        break
        
      case 'swarm':
        // Massive number of fighters in waves
        for (let i = 0; i < count; i++) {
          const waveIndex = Math.floor(i / 20)
          const angle = (i % 20) / 20 * Math.PI * 2
          const radius = 50 + waveIndex * 10
          enemies.push({
            type: 'fighter',
            x: Math.cos(angle) * radius,
            z: Math.sin(angle) * radius,
            speedMultiplier: 0.8
          })
        }
        break
        
      case 'boss':
        // Boss wave: capital ships with fighter escorts
        const bossCount = Math.min(5, 1 + Math.floor(this.currentWave / 10))
        for (let i = 0; i < bossCount; i++) {
          const angle = (i / bossCount) * Math.PI * 2
          enemies.push({
            type: 'capital',
            x: Math.cos(angle) * 60,
            z: Math.sin(angle) * 60,
            isBoss: true
          })
        }
        // Add escorts
        for (let i = 0; i < count - bossCount; i++) {
          const angle = Math.random() * Math.PI * 2
          const radius = 50 + Math.random() * 30
          enemies.push({
            type: i % 3 === 0 ? 'bomber' : 'fighter',
            x: Math.cos(angle) * radius,
            z: Math.sin(angle) * radius
          })
        }
        break
    }
    
    // Actually spawn the enemies
    for (const enemy of enemies) {
      const id = `enemy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const e = {
        id,
        type: enemy.type,
        position: new THREE.Vector3(enemy.x, 0.5, enemy.z),
        velocity: new THREE.Vector3(0, 0, 0),
        hp: enemy.type === 'capital' ? (enemy.isBoss ? 500 : 150) : 
            enemy.type === 'bomber' ? 80 : 50,
        maxHp: enemy.type === 'capital' ? (enemy.isBoss ? 500 : 150) : 
               enemy.type === 'bomber' ? 80 : 50,
        cooldown: 0,
        speedMultiplier: enemy.speedMultiplier || 1
      }
      
      // Add to game state
      state.enemies.set(id, e as any)
    }
    
    console.log(`[WaveManager] Spawned wave ${this.currentWave} with pattern ${pattern}, ${count} enemies`)
  }
  
  shouldSpawnSubWave(state: GameState): boolean {
    // Spawn sub-waves during longer battles to maintain pressure
    if (state.enemies.size < 10 && this.subWave < 3) {
      this.waveTimer++
      if (this.waveTimer > 60) {  // 1 second at 60fps
        this.waveTimer = 0
        this.subWave++
        return true
      }
    }
    return false
  }
  
  getSubWaveCount(): number {
    return 10 + this.currentWave * 2 + this.subWave * 5
  }
}
