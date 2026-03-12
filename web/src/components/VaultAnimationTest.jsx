import { useEffect, useRef, useState } from 'react'

export default function VaultAnimationTest({ onComplete }) {
  const [opened, setOpened] = useState(false)
  const overlayRef = useRef(null)
  const wheelRef = useRef(null)
  const cardRef = useRef(null)
  const unlockAudioRef = useRef(null)
  const doorAudioRef = useRef(null)

  useEffect(() => {
    const unlock = new Audio('/sfx/vault_unlock.WAV')
    unlock.preload = 'auto'
    unlock.volume = 0.85

    const door = new Audio('/sfx/VAULT_DOOR_heaavy.WAV')
    door.preload = 'auto'
    door.volume = 0.95

    unlockAudioRef.current = unlock
    doorAudioRef.current = door

    return () => {
      unlock.pause()
      door.pause()
      unlockAudioRef.current = null
      doorAudioRef.current = null
    }
  }, [])

  const openVault = () => {
    if (opened) return
    setOpened(true)

    const unlock = unlockAudioRef.current
    const door = doorAudioRef.current
    if (unlock) {
      unlock.currentTime = 0
      unlock.play().catch(() => {})
    }

    const overlay = overlayRef.current
    const wheel = wheelRef.current
    const card = cardRef.current

    overlay.style.transition = 'opacity 0.3s'
    overlay.style.opacity = '0'

    const armDeltas = [270, 225, 180, 135, 90, 45, 0, -45]

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        armDeltas.forEach((deg, i) => {
          const arm = document.getElementById('arm-' + i)
          if (!arm) return
          arm.style.transition = 'transform 1.4s cubic-bezier(0.6, 0, 0.15, 1)'
          arm.style.transform = `rotate(${deg}deg)`
        })
      }),
    )

    setTimeout(() => {
      if (door) {
        door.currentTime = 0
        door.play().catch(() => {})
      }
      wheel.style.transition = 'transform 1.8s cubic-bezier(0.3, 0.05, 0.1, 1)'
      wheel.style.transform = 'translate(calc(-50% + 80px), -50%) rotate(180deg)'
    }, 1400)

    setTimeout(() => {
      const burst = document.createElement('div')
      Object.assign(burst.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%) scale(0)',
        width: '500px',
        height: '500px',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, rgba(220,200,255,0.45) 0%, rgba(155,109,255,0.28) 35%, transparent 70%)',
        transition:
          'transform 0.8s cubic-bezier(0.2, 0, 0.1, 1), opacity 0.6s ease 0.3s',
        opacity: '1',
        zIndex: '20',
        pointerEvents: 'none',
      })

      card.appendChild(burst)

      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          burst.style.transform = 'translate(-50%, -50%) scale(1)'
          burst.style.opacity = '0'
        }),
      )

      setTimeout(() => burst.remove(), 1600)
    }, 3200)

    setTimeout(() => {
      onComplete?.()
    }, 3400)
  }

  return (
    <div className="card filled" id="vault-card" ref={cardRef} style={{ justifyContent: 'flex-start' }}>
      <svg
        id="vault-ring"
        viewBox="0 0 320 320"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '85%',
          height: '85%',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      >
        <circle cx="160" cy="160" r="150" fill="none" stroke="#1D1836" strokeWidth="0.5" strokeDasharray="1 2" />
        <circle cx="160" cy="160" r="142" fill="none" stroke="#251F45" strokeWidth="20" />
        <circle cx="160" cy="160" r="142" fill="none" stroke="#9B6DFF" strokeWidth="8" transform="rotate(-90 160 160)" />
      </svg>

      <svg
        id="vault-wheel"
        ref={wheelRef}
        viewBox="0 0 320 320"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '85%',
          height: '85%',
          zIndex: 3,
        }}
      >
        <circle cx="160" cy="160" r="130" fill="#141026" />

        <g id="arm-0" style={{ transformOrigin: '160px 160px' }}><rect x="145" y="20" width="30" height="80" rx="2" fill="#1C1533" stroke="#3D2E6B" /></g>
        <g id="arm-1" style={{ transformOrigin: '160px 160px' }}><rect x="215" y="75" width="30" height="50" rx="2" fill="#1C1533" stroke="#3D2E6B" transform="rotate(45 230 100)" /></g>
        <g id="arm-2" style={{ transformOrigin: '160px 160px' }}><rect x="220" y="145" width="80" height="30" rx="2" fill="#1C1533" stroke="#3D2E6B" /></g>
        <g id="arm-3" style={{ transformOrigin: '160px 160px' }}><rect x="215" y="195" width="30" height="50" rx="2" fill="#1C1533" stroke="#3D2E6B" transform="rotate(-45 230 220)" /></g>
        <g id="arm-4" style={{ transformOrigin: '160px 160px' }}><rect x="145" y="220" width="30" height="80" rx="2" fill="#1C1533" stroke="#3D2E6B" /></g>
        <g id="arm-5" style={{ transformOrigin: '160px 160px' }}><rect x="75" y="195" width="30" height="50" rx="2" fill="#1C1533" stroke="#3D2E6B" transform="rotate(45 90 220)" /></g>
        <g id="arm-6" style={{ transformOrigin: '160px 160px' }}><rect x="20" y="145" width="80" height="30" rx="2" fill="#1C1533" stroke="#3D2E6B" /></g>
        <g id="arm-7" style={{ transformOrigin: '160px 160px' }}><rect x="75" y="75" width="30" height="50" rx="2" fill="#1C1533" stroke="#3D2E6B" transform="rotate(-45 90 100)" /></g>

        <circle cx="160" cy="160" r="65" fill="#120E22" stroke="#3D2E6B" strokeWidth="4" />
        <text x="160" y="278" textAnchor="middle" fontSize="10" fontWeight="500" fill="#9B6DFF" fontFamily="Outfit, sans-serif" letterSpacing="2">PROGRESS</text>
        <text x="160" y="293" textAnchor="middle" fontSize="14" fontWeight="700" fill="#9B6DFF" fontFamily="Outfit, sans-serif">100%</text>
      </svg>

      <div className="card-header" style={{ width: '100%', position: 'relative', zIndex: 10, paddingTop: 4 }}>
        <div className="card-title">Draw Finished</div>
      </div>

      <div className="draw-ended-overlay" id="overlay-content" ref={overlayRef}>
        <button className="btn btn-winners" id="btn-winners" onClick={openVault}>SEE WINNERS</button>
        <div className="countdown">00:00:00</div>
      </div>
    </div>
  )
}
