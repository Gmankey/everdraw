import React, { useId } from 'react'
import { BALL_RADIUS, GAP_HALF, FLOOR_Y, POUR, POURED, ORANGE_DROP, GREEN_DROP, GREEN_SETTLED, sample, residents } from './motion.js'
import { clamp, ease, positionOnCurve, reveal, withdrawalPoint } from './story.js'

const MINT = '#78efc3', ORANGE = '#ffb16f', BLUE = '#90bfff', WHITE = '#eee9ff'
export function Ball({ x, y, border, user = false, rotation = 0, opacity = 1, shine = null, borderStrength = 1, tokenId }) {
  const id = useId(), r = BALL_RADIUS
  const light = shine === null ? 0 : Math.sin(shine * Math.PI)
  return <g transform={`translate(${x} ${y})`} opacity={opacity} data-ball={tokenId || 'token'} data-radius={r} data-owner={border || 'unassigned'} data-shining={light > .1 || undefined} data-user-token={user || undefined}>
    <defs><clipPath id={id}><circle r={r - 1} /></clipPath></defs>
    <ellipse cy={r + 3} rx={r * .84} ry="4" fill="#000" opacity=".22" />
    <g transform={`rotate(${rotation})`}>
      <circle r={r} fill="url(#ball-sphere)" stroke="#a980d1" strokeWidth="1" />
      {border && <circle r={r} fill="none" stroke={border} strokeWidth={user ? 4 : 2.6} opacity={borderStrength} />}
      <ellipse cx="-7" cy="-9" rx="11" ry="7" fill="#fff" opacity=".12" transform="rotate(-30)" />
      <text y="1" dominantBaseline="central" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800">M</text>
      {user && <path d="M-4-24L0-29L4-24Z" fill={MINT} />}
    </g>
    {light > 0 && <g clipPath={`url(#${id})`}><circle r={r} fill="#fffbe6" opacity={light * .68} /><rect x={-60 + shine * 105} y="-40" width="18" height="80" fill="#fff" opacity={light * .9} transform="rotate(24)" /></g>}
    {light > .1 && <g transform={`translate(17 -18) scale(${light})`} fill="#fff9cf"><path d="M0-15L3-3L15 0L3 3L0 15L-3 3L-15 0L-3-3Z" /><path d="M-28 12l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" /></g>}
  </g>
}
export function Ticket({ x, y, color = MINT, rotation = -15, opacity = 1, scale = 1, shine = null }) {
  const strength = shine === null ? 0 : Math.sin(shine * Math.PI)
  return <g transform={`translate(${x} ${y}) rotate(${rotation}) scale(${scale})`} opacity={opacity} data-ticket data-winning-ticket={shine !== null || undefined}>
    {strength > 0 && <g opacity={strength} stroke="#fff2ac" strokeWidth="1.5">{Array.from({ length: 8 }, (_, i) => <path key={i} d="M0-20V-31" transform={`rotate(${i * 45})`} />)}</g>}
    <path d="M-17-10H17V-3Q10 0 17 3V10H-17V3Q-10 0-17-3Z" fill={strength > .15 ? '#fff3bc' : '#17392a'} stroke={strength > .15 ? '#fff' : color} strokeWidth="1.8" />
    <path d="M8-6V6" stroke={strength > .15 ? '#725923' : color} strokeDasharray="2 2" />
    <path d="M-7-5L-5-1L-1 0L-5 2L-7 6L-9 2L-13 0L-9-1Z" fill={strength > .15 ? '#b28424' : color} />
  </g>
}
export default function VaultMotion({ step, time, vx, vy, reduced, withdrawalPath = withdrawalPoint }) {
  const t = time, winnerStage = step === 3 || step === 6
  const color = step === 6 ? MINT : ORANGE, winner = residents(step, t).find(b => b.id === (step === 6 ? 'you' : 'orange'))
  const light = reveal(t)
  const drop = step === 4 || (step === 6 && t >= 6200) || step === 7
  const dropTime = reduced || step === 7 ? 8000 : step === 6 ? t - 6200 : t
  const gap = drop ? GAP_HALF * ease(dropTime / 420) : 0
  // The hatch retracts horizontally. Balls collide with the same shelf endpoints.
  const prizes = step === 2 ? sample(POUR, t) : step === 4 ? sample(ORANGE_DROP, dropTime) : step === 5 ? sample(POUR, t - 1300) : (step === 7 || (step === 6 && t >= 6200)) ? sample(GREEN_DROP, dropTime) : step > 2 ? POURED : []
  const showJug = (step === 2 && t < 5800) || (step === 5 && t < 7100)
  return <g>
    <path d={`M${vx - 173} ${vy - 1}H${vx + 173}V${vy - 150}H${vx - 173}Z`} fill="#142e25" opacity=".45" clipPath="url(#inside)" />
    {step >= 2 && <text data-testid="prize-pool-label" x={vx} y={vy - 94} textAnchor="middle" fontSize="12" fill="#8eae9d" letterSpacing="2">PRIZE POOL</text>}
    <text data-testid="deposit-pool-label" x={vx} y={vy + 96} textAnchor="middle" fontSize="12" fill="#8eae9d" letterSpacing="2">DEPOSIT POOL</text>
    <path data-shelf="left" d={`M${vx - 176} ${vy + FLOOR_Y}H${vx - gap}`} stroke="#789986" strokeWidth="4" strokeLinecap="round" />
    <path data-shelf="right" d={`M${vx + gap} ${vy + FLOOR_Y}H${vx + 176}`} stroke="#789986" strokeWidth="4" strokeLinecap="round" />
    {drop && <path d={`M${vx - gap} ${vy + FLOOR_Y + 5}v7M${vx + gap} ${vy + FLOOR_Y + 5}v7`} stroke="#e6c799" strokeWidth="2" opacity=".7" />}
    {residents(step, t).filter(b => b.id !== 'you').map(b => {
      const pulse = step === 3 && b.id === 'orange' ? light.winnerShine : null
      const jitter = !reduced && pulse !== null ? Math.sin(t * .09) * Math.sin(pulse * Math.PI) * 3 : 0
      return <Ball key={b.id} x={vx + b.x + jitter} y={vy + b.y} border={b.id.includes('orange') || b.id.startsWith('prize-') ? ORANGE : b.id === 'blue' ? BLUE : WHITE} shine={pulse} rotation={(b.rotation || 0) + jitter * 2} tokenId={b.id} />
    })}
    {prizes.map((b, i) => {
      const pulse = winnerStage ? light.prizeShine : null
      const jitter = !reduced && pulse !== null ? Math.sin(t * .11 + i) * Math.sin(pulse * Math.PI) * 2.5 : 0
      const assigned = step === 4 ? ORANGE : step === 7 ? MINT : winnerStage && light.border > 0 ? color : undefined
      const start = { x: vx + b.x, y: vy + b.y }
      const pos = step === 7 ? withdrawalPath({ x: vx + GREEN_SETTLED[i].x, y: vy + GREEN_SETTLED[i].y }, t + 6500, i + 1, vx, vy) : start
      return <Ball key={i} x={pos.x + jitter} y={pos.y} border={assigned} borderStrength={winnerStage ? light.border : 1} rotation={pos.rotation ?? b.rotation + jitter * 3 + (pos.p || 0) * -720} shine={pulse} tokenId={'prize-' + i} />
    })}
    {showJug && <g opacity={1 - clamp((t - (step === 2 ? 5200 : 6500)) / 600)} transform={`translate(${vx + 73} ${vy - 216}) rotate(${-22 * Math.sin(clamp((t - (step === 5 ? 1300 : 0)) / 4800) * Math.PI)})`} data-testid="pouring-vessel">
      <path d="M-62-27H58L45 31Q0 47-44 26L-49-6L-70-12Z" fill="url(#glass)" stroke="#a8cfbd" strokeWidth="2" />
      <path d="M57-17H72Q92 7 49 15" fill="none" stroke="#a8cfbd" strokeWidth="3" />
      <path d="M-50-20H51" stroke="#d9fdeb" opacity=".5" />
    </g>}
    {winnerStage && <g>
      <rect x={vx - 31} y={vy - 159} width="62" height="38" rx="8" fill="#263f32" stroke="#b2cdb9" />
      <path d={`M${vx - 15} ${vy - 150}H${vx + 15}`} stroke="#e9e8bd" strokeWidth="4" strokeLinecap="round" />
      {t < 3100 && (() => {
        const raised = { x: vx, y: vy - 148 - 56 * light.ticketRise }
        const point = t < 1800 ? raised : positionOnCurve(light.ticketTravel, { x: vx, y: vy - 204 }, { x: vx + (step === 6 ? -90 : 110), y: vy - 120 }, { x: vx + winner.x, y: vy + winner.y - 12 })
        return <Ticket {...point} color={color} scale={1.5 - .5 * light.ticketTravel} rotation={light.ticketTravel * (step === 6 ? -22 : 22)} shine={light.ticketShine} opacity={light.ticketOpacity} />
      })()}
    </g>}
    {step === 6 && t >= 2900 && <g data-testid="win-celebration">
      <defs><linearGradient id="win-rainbow"><stop stopColor={reduced?'#ffd782':`hsl(${(t/25)%360} 95% 75%)`}/><stop offset=".5" stopColor="#fff7cb"/><stop offset="1" stopColor={reduced?'#78efc3':`hsl(${(t/25+130)%360} 90% 72%)`}/></linearGradient></defs>
      {!reduced && t < 5600 && Array.from({length:44},(_,i)=>{
        const age=Math.max(0,(t-2900-i*9)/1000),angle=-Math.PI*(.1+.8*(i/43))
        const x=vx+Math.cos(angle)*(75+(i%5)*9)*age
        const y=vy-70+Math.sin(angle)*(230+(i%7)*9)*age+100*age*age
        return <rect key={i} data-confetti x="-3" y="-5" width="6" height="10" rx="1" fill={['#78efc3','#ffd782','#a5c9ff','#ff9bce','#fff6c7'][i%5]} opacity={clamp((2.6-age)/.6)} transform={`translate(${x} ${y}) rotate(${i*31+age*180})`}/>
      })}
      <g transform={`translate(${vx} ${vy-56}) scale(${reduced?1:1+.045*Math.sin((t-2900)/320)})`}>
        <text textAnchor="middle" fontSize="28" fontWeight="900" letterSpacing="1" stroke="#133e2a" strokeWidth="4" paintOrder="stroke" fill="url(#win-rainbow)">CONGRATS!</text>
        {!reduced && <text textAnchor="middle" fontSize="28" fontWeight="900" letterSpacing="1" fill="#fff" opacity={.1+.18*Math.max(0,Math.sin((t-2900)/450))}>CONGRATS!</text>}
      </g>
    </g>}
  </g>
}
