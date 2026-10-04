import React, { useEffect, useRef, useState } from 'react'
import { STEPS, clamp, ease, positionOnCurve, ticketCount, canAdvance, reveal, withdrawalPoint } from './story.js'
import storyStyles from './style.css?inline'
import VaultMotion, { Ball as Coin, Ticket } from './VaultMotion.jsx'
import { DEPOSITS, residents } from './motion.js'
import { bubbleAnchor } from '../../components/depositStoryMotion.js'

const MINT = '#78efc3'
function useMedia(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => { const media = window.matchMedia(query); const change = () => setMatches(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change) }, [query])
  return matches
}
function Arrow({ direction = 'right' }) { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={direction === 'left' ? { transform: 'rotate(180deg)' } : undefined}><path d="M5 12H19M13 6L19 12L13 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> }

function Scene({ step, elapsed, reduced, compact, capturedEntries, secondEntries }) {
  const demo = step >= 0
  const t = reduced && demo ? Math.max(elapsed, STEPS[step].duration, step === 1 ? 9000 : 0) : elapsed
  const w = compact ? 600 : 1240, h = compact ? 1175 : 570
  const left = { x: 8, y: 8, w: compact ? 584 : 684, h: 550 }
  const vx = compact ? 300 : 980, vy = compact ? 945 : 300, radius = demo ? 200 : compact ? 201 : 211
  const panelY = compact ? 715 : 8
  const userBall = residents(step, t).find(b => b.id === 'you') || DEPOSITS[0]
  const origin = { x: 62, y: 170 }, destination = { x: vx + userBall.x, y: vy + userBall.y }
  const ticketTarget = { x: 73, y: 462 }
  const progress = ease(t / 2000)
  let userPosition = origin
  if (step === 1) {
    const edge = { x: left.w - 33, y: 170 }
    userPosition = progress < .58
      ? { x: origin.x + (edge.x - origin.x) * progress / .58, y: origin.y }
      : positionOnCurve((progress - .58) / .42, edge, { x: compact ? 550 : 848, y: compact ? 600 : 190 }, destination)
  }
  else if (step === 7) userPosition = withdrawalPoint(destination, t + 6500, 0, vx, vy)
  else if (step > 1) userPosition = destination
  const userShine = step === 6 ? reveal(t).winnerShine : null
  const userJitter = !reduced && userShine !== null ? Math.sin(t * .09) * Math.sin(userShine * Math.PI) * 3 : 0
  const activeTickets = (step === 1 && t > 2450) || (step === 5 && t > 2250)
  const count = demo ? ticketCount(step, t, capturedEntries, secondEntries) : 15.44
  const resetOpacity = step === 5 && t < 1300 ? 1 - clamp(t / 1200) : 1
  const entryProgress = step === 7 ? 0 : step === 5 ? (t < 1300 ? .6 * (1 - clamp(t / 1200)) : Math.min(.18, count / 65)) : demo ? Math.min(.62, count / 20) : .6
  const fs = compact ? 22 : 16
  return <svg className="story-scene" viewBox={`0 0 ${w} ${h}`} role="img" data-step={step} aria-label={demo ? `${STEPS[step].title}. ${STEPS[step].caption} Illustrative tokens and tickets, not live balances.` : 'Illustrative EverDraw deposit card and prize vault. Open the interactive demo to follow a deposit.'}>
    <defs>
      <radialGradient id="ball-sphere" cx="32%" cy="25%" r="78%"><stop stopColor="#d9bbff" /><stop offset=".27" stopColor="#ac7af0" /><stop offset=".65" stopColor="#7643b9" /><stop offset="1" stopColor="#33204f" /></radialGradient>
      <linearGradient id="token" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ba8aff" /><stop offset=".45" stopColor="#8950dc" /><stop offset="1" stopColor="#50318c" /></linearGradient>
      <radialGradient id="metal"><stop stopColor={demo ? '#22493f' : '#302248'} /><stop offset=".75" stopColor={demo ? '#17372f' : '#251b37'} /><stop offset="1" stopColor={demo ? '#31594c' : '#46325d'} /></radialGradient>
      <radialGradient id="interior"><stop stopColor="#18392f" /><stop offset="1" stopColor="#071a15" /></radialGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b7ffe0" stopOpacity=".14" /><stop offset="1" stopColor="#b7ffe0" stopOpacity=".02" /></linearGradient>
      <linearGradient id="ticketbar"><stop stopColor={demo ? MINT : '#996bff'} /><stop offset="1" stopColor={demo ? '#3ea888' : '#c2a9ec'} /></linearGradient>
      <clipPath id="inside"><circle cx={vx} cy={vy} r={radius - 22} /></clipPath>
    </defs>
    <rect x={left.x} y={left.y} width={left.w} height={left.h} rx="24" className="deposit-surface" /><rect x={compact ? 8 : 716} y={panelY} width={compact ? 584 : 516} height={compact ? 450 : 550} rx="24" className="vault-surface" />
    <rect x="32" y="32" width="280" height="42" rx="21" className="segmented" /><text x="54" y="59" className="bright" fontSize="14" fontWeight="750">DEPOSIT</text><rect x="139" y="38" width="60" height="30" rx="15" className="switch-track" /><circle cx={step === 7 ? 183 : 155} cy="53" r="12" className="accent-fill" /><text x={step === 7 ? 183 : 155} y="58" textAnchor="middle" fill="#fff" fontSize="17">{step === 7 ? '−' : '+'}</text><text x="216" y="59" className="muted" fontSize="14" fontWeight="700">WITHDRAW</text>
    {!demo && <text x="32" y="168" fontSize="46" fontWeight="650" className="bright">1</text>}
    {!demo && <><text x={left.w - 20} y="159" textAnchor="end" className="bright" fontSize="24" fontWeight="700">MON</text><text x="32" y="216" fontSize={fs} className="muted">Wallet balance</text><text x={left.w - 17} y="216" textAnchor="end" fontSize={fs} className="muted">15.0434 MON   MAX</text></>}
    <path d={`M32 192H${left.w - 16}`} className="rule" />
    {!demo && <><rect x="32" y="268" width={left.w - 48} height="43" rx="12" className="token-select" /><circle cx="55" cy="289" r="10" fill="#8652e9" /><text x="55" y="294" fontSize="13" textAnchor="middle" fill="white" fontWeight="800">M</text><text x="76" y="295" className="bright" fontSize="16" fontWeight="700">MON</text><path d={`M${left.w - 40} 286l5 5 5-5`} fill="none" className="muted-stroke" /></>}
    {!demo && <><rect x="32" y="324" width={left.w - 48} height="55" rx="28" className="normal-inert-button" /><text x={left.w / 2 + 8} y="358" textAnchor="middle" fontWeight="700" fontSize={compact ? 20 : 17} className="bright">Deposit with MON</text></>}
    <path d={`M32 402H${left.w - 16}`} className="rule" /><text x="32" y="429" className="muted" fontSize={compact ? 19 : 14} letterSpacing="1">YOUR TICKETS · THIS DRAW</text>
    <text data-testid="ticket-count" x="32" y="468" className="bright" fontSize="36" fontWeight="700" opacity={resetOpacity}>{demo ? count : '15.44'}</text>{step === 5 && t < 2200 && <text x="113" y="462" fill={MINT} fontSize="19" opacity={Math.sin(clamp(t / 2200) * Math.PI)}>New draw</text>}{!demo && <text x="32" y="493" className="muted" fontSize={compact ? 18 : 13}>+0.01 tickets / min</text>}
    <rect x="32" y="513" width={left.w - 48} height="9" rx="4.5" className="bar-track" /><rect x="32" y="513" width={(left.w - 48) * entryProgress} height="9" rx="4.5" fill="url(#ticketbar)" /><text x="32" y="542" className="muted" fontSize="12" letterSpacing="1">START</text><text x={left.w - 16} y="542" className="muted" fontSize="12" textAnchor="end" letterSpacing="1">DRAW</text>
    <text x={compact ? 32 : 740} y={panelY + 35} className="bright" fontSize={compact ? 23 : 19} fontWeight="650">{demo ? 'Inside the vault' : 'Next prize draw'}</text>
    <circle cx={vx} cy={vy} r={radius + 8} fill="none" stroke={demo ? '#15392e' : '#282035'} strokeWidth="2" /><circle cx={vx} cy={vy} r={radius} fill="url(#metal)" stroke={demo ? '#477763' : '#54416e'} strokeWidth="2" />
    {Array.from({ length: 48 }, (_, i) => { const a = i * Math.PI / 24; return <path key={i} d={`M${vx + Math.sin(a) * (radius - 4)} ${vy + Math.cos(a) * (radius - 4)}L${vx + Math.sin(a) * (radius - 11)} ${vy + Math.cos(a) * (radius - 11)}`} stroke={demo ? '#81a999' : '#9674bd'} opacity=".3" strokeWidth="3" /> })}
    <circle cx={vx} cy={vy} r={radius - 19} fill={demo ? 'url(#interior)' : '#100d1e'} stroke={demo ? '#315e4c' : '#392a52'} strokeWidth="3" />
    {!demo ? <g>{[0, 45, 90, 135].map(a => <rect key={a} x={vx - radius + 22} y={vy - 11} width={(radius - 22) * 2} height="22" rx="3" fill="#211a35" stroke="#49356c" transform={`rotate(${a} ${vx} ${vy})`} />)}<circle cx={vx} cy={vy} r="78" fill="#120f20" stroke="#614488" strokeWidth="6" /><circle cx={vx} cy={vy} r="65" fill="#120f20" stroke="#332447" /><circle cx={vx} cy={vy} r={radius - 9} fill="none" stroke="#a274ff" strokeWidth="10" strokeDasharray={`${Math.PI * (radius - 9)} ${Math.PI * (radius - 9)}`} transform={`rotate(-90 ${vx} ${vy})`} strokeLinecap="round" /><text x={vx} y={vy + 14} textAnchor="middle" fill="#cbb0ff" fontSize="58" fontWeight="800" letterSpacing="-3">4d 20h</text><text x={vx} y={vy + 49} textAnchor="middle" className="muted" fontSize="14">Illustrative countdown</text></g> : <VaultMotion step={step} time={t} vx={vx} vy={vy} reduced={reduced} />}

    {step === 4 && <path className="deposit-pointer" d={compact ? `M180 1165L180 1135L${destination.x} ${destination.y + 30}` : `M825 460L${destination.x - 30} ${destination.y}`} fill="none" stroke="#d6b783" strokeWidth="2" />}
    {demo && <><Coin {...userPosition} x={userPosition.x + userJitter} user border={MINT} shine={userShine} tokenId="you" rotation={step === 1 ? progress * 720 : step === 7 ? (userPosition.p || 0) * -720 : (userBall.rotation || 0) + userJitter * 2} />{step >= 1 && step !== 7 && (step !== 1 || progress === 1) && <text x={destination.x} y={destination.y + 35} textAnchor="middle" fontSize="13" fontWeight="700" fill={MINT}>YOU</text>}{activeTickets && !reduced && Array.from({ length: 3 }, (_, i) => { const age = (t - (step === 1 ? 2450 : 2250) - i * 820) % 2460; if (age < 0 || age > 1700) return null; const p = age / 1700; const pos = positionOnCurve(p, { x: destination.x, y: destination.y - 35 }, { x: compact ? 105 : 680, y: compact ? 620 : 130 }, ticketTarget); return <Ticket key={i} {...pos} rotation={-20 + p * 35} opacity={Math.min(1, p * 6, (1 - p) * 7)} /> })}</>}
  </svg>
}

export default function DepositStory({ initialDemo = false, onExit, layout, sceneComponent, onStageChange }) {
  const SceneComponent = sceneComponent || Scene
  const [step, setStep] = useState(initialDemo ? 0 : -1), [elapsed, setElapsed] = useState(0), [paused, setPaused] = useState(false)
  const [capturedEntries, setCapturedEntries] = useState(0)
  const [secondEntries, setSecondEntries] = useState(0)
  const [bubbleHeight,setBubbleHeight]=useState(145)
  const bubbleRef=useRef(null)
  const caption=STEPS[step]?.caption
  const lastCaption=useRef(caption)
  const [outgoingCaption,setOutgoingCaption]=useState(null)
  useEffect(()=>{
    if(lastCaption.current===caption) return
    setOutgoingCaption(lastCaption.current);lastCaption.current=caption
    const timer=setTimeout(()=>setOutgoingCaption(null),450)
    return ()=>clearTimeout(timer)
  },[caption])
  const compact = useMedia('(max-width: 720px)'), reduced = useMedia('(prefers-reduced-motion: reduce)')
  const time = useRef(0), previous = useRef(null), startButton = useRef(null)
  const demo = step >= 0
  const bubble = layout ? bubbleAnchor(layout,step,bubbleHeight) : null
  useEffect(()=>{
    if(!layout || !bubbleRef.current) return
    const observer=new ResizeObserver(entries=>setBubbleHeight(entries[0].target.getBoundingClientRect().height))
    observer.observe(bubbleRef.current)
    return ()=>observer.disconnect()
  },[layout,step])
  useEffect(() => {
    if (!demo || paused || reduced) return
    let frame
    function tick(now) { if (previous.current !== null && !document.hidden) time.current += Math.min(64, now - previous.current); previous.current = now; setElapsed(time.current); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); previous.current = null }
  }, [demo, step, paused, reduced])
  function go(next) {
    onStageChange?.(next)
    if (step === 1 && next === 2) setCapturedEntries(ticketCount(1, reduced ? 9000 : elapsed))
    if (step === 5 && next === 6) setSecondEntries(ticketCount(5, reduced ? 7500 : elapsed, capturedEntries))
    if (next <= 0) { setCapturedEntries(0); setSecondEntries(0) }
    time.current = 0; previous.current = null; setElapsed(0); setStep(next); setPaused(false)
  }
  function exit() { if (onExit) { onExit(); return } go(-1); requestAnimationFrame(() => startButton.current?.focus()) }
  useEffect(() => { const onKey = e => { if (e.key === 'Escape' && demo) exit() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) })
  const ready = canAdvance(step, elapsed, reduced), finished = step === STEPS.length - 1
  return <main className={`preview ${demo ? 'is-demo' : ''} ${layout ? 'is-anchored' : ''}`} data-stage={step}><style>{storyStyles}</style>{layout && <style>{`
    .is-anchored.preview { min-height: 0; background: transparent; overflow: visible; }
    .is-anchored .ambient { display:none; }
    .is-anchored .shell { width:100%; max-width:none; margin:0; padding:0; }
    .is-anchored .scene-wrap { position:static; margin:0; }
    .is-anchored .story-scene { position:absolute; top:0; left:0; width:${layout.pageWidth}px; height:${layout.pageHeight}px; overflow:hidden; }
    .is-anchored .demo-heading { position:fixed; top:0; left:0; width:100%; height:64px; pointer-events:none; background:#081713ed; z-index:3; }
    .is-anchored .demo-toolbar { position:fixed; top:62px; left:24px; width:calc(100% - 48px); min-height:0; height:36px; padding:0; pointer-events:auto; z-index:4; }
    .is-anchored .action-bubble { position:absolute; left:${bubble.x}px; top:${bubble.y}px; width:${bubble.width}px; pointer-events:auto; transition:left .35s ease,top .35s ease; }
    .is-anchored .action-bubble::after { display:none; }
    @keyframes caption-arrive { from { opacity:0; } to { opacity:1; } }
    @keyframes caption-leave { from { opacity:1; } to { opacity:0; } }
    .is-anchored.preview { animation:caption-arrive 450ms ease; }
    .caption-crossfade { display:grid;flex:1; }
    .caption-crossfade p { grid-area:1 / 1; }
    .is-anchored .action-bubble p { animation:caption-arrive 450ms ease; }
    .is-anchored .action-bubble p.caption-outgoing { animation:caption-leave 450ms ease forwards;pointer-events:none; }
    @media(prefers-reduced-motion:reduce) { .is-anchored .action-bubble p { animation:none; } }
  `}</style>}<div className="ambient" aria-hidden="true" /><div className="shell">
    {demo && <header className="demo-heading"><h2>DEMO MODE</h2></header>}
    <section className="demo-toolbar">{!demo ? <button ref={startButton} className="start-button" onClick={() => go(0)}>See what my deposit does <Arrow /></button> : <><div className="utility-actions"><button aria-label="Previous step" disabled={step === 0} onClick={() => go(step - 1)}>Back</button>{!reduced && step > 0 && <button onClick={() => setPaused(p => !p)} aria-pressed={paused}>{paused ? 'Resume motion' : 'Pause motion'}</button>}<button onClick={exit}>Exit demo</button></div></>}</section>
    <div className="scene-wrap">
      <SceneComponent step={step} elapsed={elapsed} reduced={reduced} compact={compact} capturedEntries={capturedEntries} secondEntries={secondEntries} layout={layout} bubble={bubble} />
      {demo && <div ref={bubbleRef} className={`action-bubble bubble-${STEPS[step].id}`} aria-label="Step explanation">
        <div className="caption-crossfade"><p key={step} aria-live="polite" aria-atomic="true">{STEPS[step].caption}</p>{layout && outgoingCaption && <p className="caption-outgoing" aria-hidden="true">{outgoingCaption}</p>}</div>
        <button className={`bubble-next ${step === 6 || finished ? 'bubble-wide' : ''}`} aria-label={finished ? 'Done' : step === 6 ? 'What if I want to withdraw?' : 'Next'} title={ready ? '' : 'Animation in progress'} disabled={!ready} onClick={() => finished ? exit() : go(step + 1)}>{finished ? 'Done' : step === 6 ? 'What if I want to withdraw?' : <Arrow />}</button>
      </div>}
    </div>
  </div></main>
}
