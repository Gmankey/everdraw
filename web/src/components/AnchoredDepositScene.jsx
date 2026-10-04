import VaultMotion, { Ball, Ticket } from '../prototypes/deposit-story/VaultMotion.jsx'
import { residents } from '../prototypes/deposit-story/motion.js'
import { STEPS, ease, positionOnCurve, reveal, ticketCount } from '../prototypes/deposit-story/story.js'
import { depositFloorPath, withdrawFloorPath, entryBarProgress } from './depositStoryMotion.js'

export default function AnchoredDepositScene({ step, elapsed, reduced, capturedEntries, secondEntries, layout, bubble }) {
  const t = reduced ? Math.max(elapsed, STEPS[step].duration, step === 1 ? 9000 : 0) : elapsed
  const { vault, input, count, timeline, pageWidth, pageHeight } = layout
  const scale = Math.min(vault.width, vault.height) * 155 / 320 / 208
  const cx = vault.x + vault.width / 2, cy = vault.y + vault.height / 2
  const toWorld = (x, y) => ({ x: (x-cx)/scale, y: (y-cy)/scale })
  const origin = toWorld(input.x + 22*scale, input.y + input.height - 22*scale)
  const edge = toWorld(input.x+input.width, input.y+input.height-22*scale)
  const target = toWorld(count.x + 12, count.y + count.height/2)
  const user = residents(step, t).find(b => b.id === 'you')
  const progress = ease(t/2000)
  const withdraw = (start, time, index) => withdrawFloorPath(time-6500,index,start,origin,{x:edge.x-22,y:edge.y})
  let position = step === 0 ? origin : user
  if (step === 1) position = depositFloorPath(t,origin,edge,user)
  if (step === 7) position = withdraw(user, t+6500, 0)
  const light = step === 6 ? reveal(t).winnerShine : null
  const jitter = !reduced && light !== null ? Math.sin(t*.09)*Math.sin(light*Math.PI)*3 : 0
  const entries = ticketCount(step, t, capturedEntries, secondEntries)
  const barProgress = entryBarProgress(step,t,entries,capturedEntries)
  const userScreen = {x:cx+user.x*scale,y:cy+user.y*scale}
  const pointingTo = step===0 || step===7 ? {x:input.x+22*scale,y:input.y+input.height+5}
    : step===1 || step===5 ? {x:count.x+20,y:count.y-5}
    : step===4 || step===6 ? {x:userScreen.x-22*scale,y:userScreen.y}
    : {x:cx,y:cy-210*scale}
  const leadStart = step===0 || step===7 ? {x:bubble.x+26,y:bubble.y} : {x:bubble.x+bubble.width,y:bubble.y+35}
  const activeTickets = (step === 1 && t > 2450) || (step === 5 && t > 2250)
  const hideEntries = false
  return <svg className="story-scene anchored-scene" width={pageWidth} height={pageHeight} viewBox={`0 0 ${pageWidth} ${pageHeight}`} aria-label={STEPS[step].caption} data-step={step}>
    <defs>
      <radialGradient id="ball-sphere" cx="32%" cy="25%" r="78%"><stop stopColor="#d9bbff"/><stop offset=".27" stopColor="#ac7af0"/><stop offset=".65" stopColor="#7643b9"/><stop offset="1" stopColor="#33204f"/></radialGradient>
      <radialGradient id="interior"><stop stopColor="#18392f"/><stop offset="1" stopColor="#071a15"/></radialGradient>
      <radialGradient id="metal"><stop stopColor="#22493f"/><stop offset="1" stopColor="#31594c"/></radialGradient>
      <linearGradient id="glass"><stop stopColor="#b7ffe0" stopOpacity=".14"/><stop offset="1" stopColor="#b7ffe0" stopOpacity=".02"/></linearGradient>
      <clipPath id="inside"><circle r="178"/></clipPath>
    </defs>
    <g transform={`translate(${cx} ${cy}) scale(${scale})`} data-testid="anchored-vault">
      <circle r="208" fill="none" stroke="#15392e" strokeWidth={208/310}/>
      <circle r="200" fill="url(#metal)" stroke="#477763" strokeWidth="2"/>
      {Array.from({length:48}, (_,i) => <path key={i} d="M0 196V189" transform={`rotate(${i*7.5})`} stroke="#81a999" opacity=".3" strokeWidth="3"/>)}
      <circle r="181" fill="url(#interior)" stroke="#315e4c" strokeWidth="3"/>
      <VaultMotion step={step} time={t} vx={0} vy={0} reduced={reduced} withdrawalPath={withdraw}/>
      <Ball x={position.x+jitter} y={position.y} border="#78efc3" user tokenId="you" shine={light} rotation={step===0?0:position.rotation ?? user.rotation ?? 0}/>
      {step>0 && step!==7 && (step!==1 || progress===1) && <text x={user.x} y={user.y+35} textAnchor="middle" fill="#78efc3" fontSize="13">YOU</text>}
      {activeTickets && !reduced && Array.from({length:3}, (_,i) => {
        const age=(t-(step===1?2450:2250)-i*820)%2460
        if(age<0 || age>1700) return null
        const p=age/1700
        // Approach the counter through the lower corridor, never behind a bubble.
        return <Ticket key={i} {...positionOnCurve(p,{x:user.x,y:user.y-35},{x:target.x+140,y:Math.max(user.y,target.y)+120},target)} opacity={Math.min(1,p*6,(1-p)*7)}/>
      })}
    </g>
    <path d={`M${leadStart.x} ${leadStart.y} L${pointingTo.x} ${pointingTo.y}`} stroke="#d6b783" strokeWidth="1.5" opacity=".8" fill="none" data-testid="bubble-leader"/>
    {!hideEntries && <><text x={count.x} y={count.y+count.height*.8} fontFamily={count.fontFamily} fontSize={count.fontSize} fontWeight={count.fontWeight} fill="#f0edfa" opacity={step===5 && t<1300?1-ease(t/1200):1} data-testid="ticket-count">{entries}</text>
    <rect data-testid="demo-ticket-fill" x={timeline.x} y={timeline.y} width={timeline.width*barProgress} height={timeline.height} rx={timeline.height/2} fill="#78efc3"/></>}
  </svg>
}
