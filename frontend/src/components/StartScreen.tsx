import { useEffect, useRef } from 'react'
import * as THREE from 'three'

interface StartScreenProps {
  onStart: () => void
}

export function StartScreen({ onStart }: StartScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<THREE.Scene>()
  const rendererRef = useRef<THREE.WebGLRenderer>()
  const cameraRef = useRef<THREE.PerspectiveCamera>()
  const shipsRef = useRef<THREE.Group[]>([])
  const projectilesRef = useRef<THREE.Mesh[]>([])
  
  useEffect(() => {
    if (!canvasRef.current) return
    
    // Setup Three.js scene
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog('#0a0618', 50, 200)
    sceneRef.current = scene
    
    const renderer = new THREE.WebGLRenderer({ 
      canvas: canvasRef.current, 
      antialias: true,
      alpha: true 
    })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x000000, 0)
    rendererRef.current = renderer
    
    const camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    )
    camera.position.set(0, 30, 50)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404080, 0.5)
    scene.add(ambientLight)
    
    const dirLight = new THREE.DirectionalLight(0x8080ff, 0.8)
    dirLight.position.set(10, 20, 10)
    scene.add(dirLight)
    
    // Create dogfighting ships
    const shipGeometry = new THREE.ConeGeometry(0.5, 2, 4)
    shipGeometry.rotateX(Math.PI / 2)
    
    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group()
      
      // Fighter ship
      const shipMaterial = new THREE.MeshPhongMaterial({
        color: i < 4 ? 0x00ffff : 0xff4444,
        emissive: i < 4 ? 0x004444 : 0x441111,
        emissiveIntensity: 0.5
      })
      const ship = new THREE.Mesh(shipGeometry, shipMaterial)
      group.add(ship)
      
      // Engine glow
      const glowGeometry = new THREE.SphereGeometry(0.3, 8, 8)
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: i < 4 ? 0x00ffff : 0xffaa00,
        transparent: true,
        opacity: 0.8
      })
      const glow = new THREE.Mesh(glowGeometry, glowMaterial)
      glow.position.z = -1
      group.add(glow)
      
      // Position in space
      group.position.set(
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 60
      )
      
      scene.add(group)
      shipsRef.current.push(group)
    }
    
    // Create star particles
    const starGeometry = new THREE.BufferGeometry()
    const starVertices = []
    for (let i = 0; i < 1000; i++) {
      starVertices.push(
        (Math.random() - 0.5) * 200,
        (Math.random() - 0.5) * 200,
        (Math.random() - 0.5) * 200
      )
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3))
    const starMaterial = new THREE.PointsMaterial({ 
      color: 0xffffff, 
      size: 0.5,
      transparent: true,
      opacity: 0.6
    })
    const stars = new THREE.Points(starGeometry, starMaterial)
    scene.add(stars)
    
    // Animation loop
    let frame = 0
    const animate = () => {
      frame++
      
      // Animate ships
      shipsRef.current.forEach((ship, i) => {
        // Circular motion with variation
        const speed = 0.02 + i * 0.003
        const radius = 20 + i * 3
        const offset = i * Math.PI / 4
        
        ship.position.x = Math.cos(frame * speed + offset) * radius
        ship.position.z = Math.sin(frame * speed + offset) * radius
        ship.position.y = Math.sin(frame * speed * 2 + offset) * 5
        
        // Point ships forward
        const nextX = Math.cos((frame + 1) * speed + offset) * radius
        const nextZ = Math.sin((frame + 1) * speed + offset) * radius
        ship.lookAt(nextX, ship.position.y, nextZ)
        
        // Occasional projectiles
        if (frame % 60 === i * 7) {
          const projGeom = new THREE.SphereGeometry(0.2, 4, 4)
          const projMat = new THREE.MeshBasicMaterial({
            color: i < 4 ? 0x00ffff : 0xff4444,
            emissive: i < 4 ? 0x00ffff : 0xff4444
          })
          const projectile = new THREE.Mesh(projGeom, projMat)
          projectile.position.copy(ship.position)
          scene.add(projectile)
          projectilesRef.current.push(projectile)
        }
      })
      
      // Animate projectiles
      projectilesRef.current = projectilesRef.current.filter(proj => {
        proj.position.y += 0.5
        proj.position.x += (Math.random() - 0.5) * 0.5
        proj.scale.multiplyScalar(0.95)
        
        if (proj.scale.x < 0.01) {
          scene.remove(proj)
          return false
        }
        return true
      })
      
      // Rotate camera slowly
      camera.position.x = Math.sin(frame * 0.001) * 50
      camera.position.z = Math.cos(frame * 0.001) * 50
      camera.lookAt(0, 0, 0)
      
      renderer.render(scene, camera)
      requestAnimationFrame(animate)
    }
    animate()
    
    // Handle resize
    const handleResize = () => {
      if (!rendererRef.current || !cameraRef.current) return
      cameraRef.current.aspect = window.innerWidth / window.innerHeight
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', handleResize)
    
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])
  
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #0a0618 0%, #000000 100%)',
      zIndex: 100
    }}>
      <canvas 
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%'
        }}
      />
      
      <div style={{
        position: 'relative',
        textAlign: 'center',
        color: 'white',
        zIndex: 1,
        animation: 'fadeIn 2s ease-in'
      }}>
        <h1 style={{
          fontSize: 96,
          fontWeight: 300,
          letterSpacing: '0.1em',
          marginBottom: 0,
          fontFamily: 'Georgia, serif',
          textShadow: '0 0 40px rgba(0, 255, 255, 0.5)',
          background: 'linear-gradient(180deg, #ffffff 0%, #88ccff 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text'
        }}>
          EIGENRIVER
        </h1>
        
        <p style={{
          fontSize: 28,
          fontWeight: 200,
          letterSpacing: '0.2em',
          marginTop: 20,
          marginBottom: 50,
          textTransform: 'uppercase',
          color: '#88ccff',
          textShadow: '0 0 20px rgba(136, 204, 255, 0.5)'
        }}>
          Defend the Eigenriver
        </p>
        
        <button
          onClick={onStart}
          style={{
            padding: '18px 50px',
            fontSize: 20,
            fontWeight: 300,
            letterSpacing: '0.1em',
            background: 'linear-gradient(135deg, rgba(0,255,255,0.1) 0%, rgba(136,204,255,0.1) 100%)',
            border: '1px solid rgba(136, 204, 255, 0.5)',
            color: 'white',
            cursor: 'pointer',
            borderRadius: 0,
            textTransform: 'uppercase',
            transition: 'all 0.3s ease',
            boxShadow: '0 0 30px rgba(0, 255, 255, 0.2)',
            backdropFilter: 'blur(10px)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,255,255,0.2) 0%, rgba(136,204,255,0.2) 100%)'
            e.currentTarget.style.boxShadow = '0 0 40px rgba(0, 255, 255, 0.4)'
            e.currentTarget.style.transform = 'scale(1.05)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,255,255,0.1) 0%, rgba(136,204,255,0.1) 100%)'
            e.currentTarget.style.boxShadow = '0 0 30px rgba(0, 255, 255, 0.2)'
            e.currentTarget.style.transform = 'scale(1)'
          }}
        >
          Begin Mission
        </button>
        
        <div style={{
          marginTop: 60,
          fontSize: 14,
          color: '#667799',
          letterSpacing: '0.05em'
        }}>
          <p style={{ margin: '8px 0' }}>Voice & Gesture Controlled</p>
          <p style={{ margin: '8px 0', opacity: 0.7 }}>Camera and microphone will activate on start</p>
        </div>
        
        <div style={{
          position: 'absolute',
          bottom: -100,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 12,
          color: '#445566',
          letterSpacing: '0.1em'
        }}>
          eigenriver.com
        </div>
      </div>
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
