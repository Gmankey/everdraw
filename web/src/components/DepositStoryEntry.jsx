import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AnchoredDepositScene from './AnchoredDepositScene'

const DepositStory = lazy(() => import('../prototypes/deposit-story/DepositStory.jsx'))
function measure() {
  const rect = selector => {
    const el = document.querySelector(selector), b = el.getBoundingClientRect(), css = getComputedStyle(el)
    return { x:b.x+window.scrollX, y:b.y+window.scrollY, width:b.width, height:b.height, fontSize:css.fontSize, fontFamily:css.fontFamily, fontWeight:css.fontWeight }
  }
  const card = rect('.v5-product-card'), cta = rect('.v5-product-card .deposit-cta-wrap')
  return {
    card, cta, vaultCard:rect('#vault-card'), vault:rect('#vault-card .vault-door'), input:rect('.v5-product-card .input-wrapper'),
    count:rect('.v5-tickets-value'), timeline:rect('.v5-tickets-timeline'), ticketHeading:rect('.v5-tickets-head'),
    heading:rect('.app-container > h1'), controls:rect('[data-demo-entry-row]'),
    bubble:{ x:Math.max(12,Math.min(card.x+24,document.documentElement.clientWidth-Math.min(350,card.width-48,document.documentElement.clientWidth-24)-12)), y:cta.y+4, width:Math.min(350,card.width-48,document.documentElement.clientWidth-24) },
    pageWidth:document.documentElement.clientWidth, pageHeight:document.documentElement.scrollHeight, scrollY:window.scrollY, viewportHeight:window.innerHeight,
    focusStacked:Math.abs(document.querySelector('#vault-card').getBoundingClientRect().top-document.querySelector('.v5-product-card').getBoundingClientRect().top)>10,
  }
}
class DemoBoundary extends Component {
  state = { failed:false }
  static getDerivedStateFromError() { return { failed:true } }
  render() { return this.state.failed ? <div role="alert">Unable to load demo. <button onClick={this.props.onClose}>Close demo</button></div> : this.props.children }
}
function InPlaceDemo({ onClose }) {
  const [root,setRoot] = useState(null), [layout,setLayout] = useState(measure), [stage,setStage] = useState(0)
  const [visible,setVisible]=useState(false)
  const closing=useRef(false), closeTimer=useRef(null)
  function requestClose() {
    if(closing.current) return
    closing.current=true;setVisible(false)
    closeTimer.current=setTimeout(onClose,450)
  }
  const shadowHost=useRef(null)
  const attach = useCallback(el => {
    shadowHost.current=el
    if(el) setRoot(el.shadowRoot || el.attachShadow({mode:'open'}))
  },[])
  const host = useRef(null), focusY=useRef(window.scrollY), activeStage=useRef(0)
  const scrollFrame=useRef(null)
  useEffect(() => {
    const app = document.querySelector('.app-shell')
    const prior = app.inert
    const previousY=window.scrollY
    const html=document.documentElement, body=document.body
    const previousOverflow=html.style.overflow, previousBodyOverflow=body.style.overflow, previousGutter=html.style.scrollbarGutter, previousPadding=body.style.paddingRight
    const previousHtmlOverscroll=html.style.overscrollBehaviorY, previousBodyOverscroll=body.style.overscrollBehaviorY
    const previousAnchor=body.style.overflowAnchor
    body.style.overflowAnchor='none'
    app.inert = true
    const mobileQuery=matchMedia('(max-width: 720px)')
    let keysBlocked=false, touchY=null
    const blockKeys=event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key)) event.preventDefault()}
    const setKeyBlocking=blocked=>{
      if(keysBlocked===blocked) return
      keysBlocked=blocked
      window[blocked?'addEventListener':'removeEventListener']('keydown',blockKeys)
    }
    const applyScrollMode=()=>{
      html.style.overflow=previousOverflow;body.style.overflow=previousBodyOverflow
      html.style.scrollbarGutter=previousGutter;body.style.paddingRight=previousPadding
      html.style.overscrollBehaviorY=previousHtmlOverscroll;body.style.overscrollBehaviorY=previousBodyOverscroll
      if(mobileQuery.matches) {
        html.style.overscrollBehaviorY='none';body.style.overscrollBehaviorY='none'
        setKeyBlocking(false)
        return
      }
      const scrollbarWidth=window.innerWidth-html.clientWidth
      if(scrollbarWidth) body.style.paddingRight=`${parseFloat(getComputedStyle(body).paddingRight)+scrollbarWidth}px`
      html.style.overflow='hidden';body.style.overflow='hidden'
      setKeyBlocking(true)
    }
    const mobileScrollBounds=()=>{
      const grid=document.querySelector('.main-grid').getBoundingClientRect()
      const shadow=shadowHost.current?.shadowRoot
      const chromeBottom=Math.max(128,...['.demo-heading','.demo-toolbar'].map(selector=>shadow?.querySelector(selector)?.getBoundingClientRect().bottom || 0))
      const min=Math.max(0,grid.top+window.scrollY-chromeBottom-8)
      const max=Math.max(min,grid.bottom+window.scrollY-window.innerHeight+16)
      return {min,max}
    }
    const clampMobileScroll=value=>{
      if(!mobileQuery.matches) return value
      const {min,max}=mobileScrollBounds()
      return Math.max(min,Math.min(max,value))
    }
    const handleWheel=event=>{
      event.preventDefault()
      if(mobileQuery.matches) window.scrollTo({top:clampMobileScroll(window.scrollY+event.deltaY),behavior:'instant'})
    }
    const handleTouchStart=event=>{touchY=event.touches[0]?.clientY ?? null}
    const handleTouchMove=event=>{
      event.preventDefault()
      if(!mobileQuery.matches || touchY===null) return
      const nextY=event.touches[0]?.clientY ?? touchY
      window.scrollTo({top:clampMobileScroll(window.scrollY+touchY-nextY),behavior:'instant'})
      touchY=nextY
    }
    window.addEventListener('wheel',handleWheel,{passive:false})
    window.addEventListener('touchstart',handleTouchStart,{passive:true})
    window.addEventListener('touchmove',handleTouchMove,{passive:false})
    applyScrollMode()
    const update = () => {
      const grid=document.querySelector('.main-grid').getBoundingClientRect()
      const stacked=Math.abs(document.querySelector('#vault-card').getBoundingClientRect().top-document.querySelector('.v5-product-card').getBoundingClientRect().top)>10
      const target=stacked ? document.querySelector(activeStage.current>=2 && activeStage.current<=6 && activeStage.current!==5 ? '#vault-card' : '.v5-product-card').getBoundingClientRect() : grid
      const captionSpace=stacked && [2,3,4,6].includes(activeStage.current)?160:0
      const inset=Math.max(12,Math.min(72,(window.innerHeight-target.height-captionSpace-16)),(window.innerHeight-target.height-captionSpace)/2)
      const destination=clampMobileScroll(Math.max(0,target.y+window.scrollY-inset))
      if(scrollFrame.current && Math.abs(destination-focusY.current)<1) return
      cancelAnimationFrame(scrollFrame.current)
      focusY.current=destination
      const from=window.scrollY,start=performance.now()
      const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:700
      function scrollTick(now) {
        const p=duration?Math.min(1,(now-start)/duration):1
        window.scrollTo({top:from+(destination-from)*(.5-.5*Math.cos(Math.PI*p)),behavior:'instant'})
        setLayout(measure())
        scrollFrame.current=p<1?requestAnimationFrame(scrollTick):null
      }
      scrollFrame.current=requestAnimationFrame(scrollTick)
      setLayout(measure())
    }
    const keepFocus=()=>{
      if(mobileQuery.matches && !scrollFrame.current) {
        const bounded=clampMobileScroll(window.scrollY)
        if(Math.abs(bounded-window.scrollY)>.5) window.scrollTo({top:bounded,behavior:'instant'})
      }
      setLayout(measure())
    }
    const handleResize=()=>{applyScrollMode();update()}
    const observer = new ResizeObserver(update)
    observer.observe(document.querySelector('.main-grid'))
    window.addEventListener('resize',handleResize)
    window.addEventListener('scroll',keepFocus)
    window.addEventListener('demo-stage-focus',update)
    const frame=requestAnimationFrame(()=>{update();setVisible(true)})
    return () => {
      cancelAnimationFrame(frame);cancelAnimationFrame(scrollFrame.current); clearTimeout(closeTimer.current); app.inert=prior; observer.disconnect()
      window.removeEventListener('resize',handleResize); window.removeEventListener('scroll',keepFocus)
      window.removeEventListener('wheel',handleWheel);window.removeEventListener('touchstart',handleTouchStart);window.removeEventListener('touchmove',handleTouchMove)
      setKeyBlocking(false); window.removeEventListener('demo-stage-focus',update)
      html.style.overflow=previousOverflow; body.style.overflow=previousBodyOverflow; html.style.scrollbarGutter=previousGutter;body.style.paddingRight=previousPadding
      html.style.overscrollBehaviorY=previousHtmlOverscroll;body.style.overscrollBehaviorY=previousBodyOverscroll
      body.style.overflowAnchor=previousAnchor
      window.scrollTo({top:previousY,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
    }
  },[])
  function changeStage(next) {activeStage.current=next;setStage(next);window.dispatchEvent(new Event('demo-stage-focus'))}
  useEffect(() => {
    if (!root) return
    const frame = requestAnimationFrame(() => root.querySelector('button:not([disabled])')?.focus({preventScroll:true}))
    return () => cancelAnimationFrame(frame)
  },[root])
  return createPortal(<div ref={host} role="dialog" aria-modal="true" aria-label="How does this work? — demo mode"
    style={{ position:'absolute', top:0,left:0,width:'100%',height:'100%',zIndex:1000,pointerEvents:'none',opacity:visible?1:0,transition:'opacity 450ms ease' }}
    onKeyDown={event => {
      if(event.key==='Escape') { event.preventDefault(); requestClose(); return }
      if(event.key!=='Tab' || !root) return
      const buttons=[...root.querySelectorAll('button:not([disabled])')].filter(el=>el.getClientRects().length)
      const first=buttons[0],last=buttons.at(-1),active=root.activeElement
      if(!first) return
      if(!buttons.includes(active)||(event.shiftKey&&active===first)||(!event.shiftKey&&active===last)) {
        event.preventDefault(); (event.shiftKey?last:first).focus({preventScroll:true})
      }
    }}>
    <style>{visible ? `
      .app-shell.v5-release-mode, .app-shell.v5-release-mode .app-container { background:#081713; }
      .app-container > header, .app-container > h1, .vault-bar, .v5-uat-strip,
      .v5-draw-health-banner, .beta-corner-ribbon, .stats-grid, .site-footer,
      .app-container > .deposit-caption { opacity:0 !important; }
      .v5-product-card { background:#10231c !important; border-color:#345646 !important; }
      #vault-card { background:#0b1e17 !important; }
      .v5-release-mode { --color-primary:#78efc3; --color-text-muted:#8eae9d; }
      .v5-release-mode .stats-grid .stat-card { background:#10231c !important; border-color:#345646 !important; }
      .v5-release-mode .stat-label, .v5-release-mode .card-icon { color:#78efc3 !important; }
      .v5-release-mode .stat-value { color:transparent !important; position:relative; }
      .v5-release-mode .stat-value::after { content:'0'; color:#edf9f2; position:absolute; inset:0; }
      .v5-release-mode .stat-sub { visibility:hidden; }
      .v5-action-pill { background:#102c20 !important; border-color:#426c56 !important; }
      .v5-action-pill-track { background:#081c13 !important; }
      .v5-action-pill-knob { background:#45a47c !important; color:transparent !important; left:${stage===7?'calc(100% - 29px)':'3px'} !important; }
      .v5-action-pill-knob::after { content:'${stage===7?'−':'+'}'; color:white; position:absolute; }
      .v5-action-pill-btn:first-child { color:${stage===7?'#779989':'#edfff5'} !important; }
      .v5-action-pill-btn:last-child { color:${stage===7?'#edfff5':'#779989'} !important; }
      .v5-tickets-head, .v5-tickets-scale { color:#8eae9d !important; }
      .v5-tickets-timeline { background:#294639 !important; border-color:#426c56 !important; }
      .v5-product-card .input-wrapper, .v5-tickets-panel { border-color:#426c56 !important; }
      .app-container > h1, [data-demo-entry-row] > button,
      .v5-product-card input, .v5-product-card .currency-label,
      .v5-product-card .balance-info, .v5-product-card .deposit-cta-wrap,
      .v5-tickets-value, .v5-tickets-rate, .v5-tickets-fill, .v5-tickets-copy,
      .v5-tickets-head > span:last-child, #vault-card .vault-door,
      #vault-card .countdown-center { opacity:0 !important; }
    ` : ''}</style>
    <div ref={attach}/>
    {root && createPortal(<>
      <style>{':host { font-family: sans-serif; } .loading { position:fixed;top:16px;right:16px;padding:16px;background:#10231c;color:white;pointer-events:auto; }'}</style>
      <DemoBoundary onClose={requestClose}><Suspense fallback={<div className="loading">Loading demo… <button onClick={requestClose}>Close demo</button></div>}>
        <DepositStory initialDemo onExit={requestClose} onStageChange={changeStage} layout={layout} sceneComponent={AnchoredDepositScene}/>
      </Suspense></DemoBoundary>
    </>,root)}
  </div>,document.body)
}
export default function DepositStoryEntry({disabled=false}) {
  const [open,setOpen]=useState(false),trigger=useRef(null)
  function close() { setOpen(false); requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true})) }
  return <>
    <style>{`
      .app-shell.v5-release-mode, .v5-release-mode .app-container,
      .v5-release-mode .card, .v5-action-pill, .v5-action-pill-track, .v5-action-pill-knob {
        transition:background-color 450ms ease,border-color 450ms ease,color 450ms ease;
      }
      .v5-release-mode header, .v5-release-mode h1, .vault-bar, .v5-uat-strip,
      .v5-draw-health-banner, .beta-corner-ribbon, .stats-grid, .site-footer,
      .deposit-caption, [data-demo-entry-row] > button, .v5-product-card input,
      .v5-product-card .currency-label, .v5-product-card .balance-info, .deposit-cta-wrap,
      .v5-tickets-value, .v5-tickets-rate, .v5-tickets-fill, .v5-tickets-copy,
      .v5-tickets-head > span:last-child, #vault-card .vault-door, #vault-card .countdown-center {
        transition:opacity 450ms ease;
      }
      #vault-card .card-header { align-items:center;gap:12px; }
      [data-demo-entry-row] { position:relative;z-index:5;margin-left:auto;flex-shrink:0; }
      .deposit-story-entry {
        display:inline-flex; align-items:center; justify-content:center; gap:6px;pointer-events:auto;
        height:30px; max-width:100%; padding:0 2px;
        background:transparent;
        border:0; border-radius:14px;
        color:#f3ebff; font-family:inherit;
        font-size:13px; font-weight:500; line-height:1.2;
        box-shadow:none; cursor:pointer;
        transition:background .18s ease,border-color .18s ease;
      }
      .deposit-story-entry:hover:not(:disabled) { background:#a779e814; }
      .deposit-story-entry:focus-visible { outline:3px solid #d3b8ff; outline-offset:4px; }
      .deposit-story-entry:disabled { opacity:.45; cursor:default; }
      .deposit-story-entry .story-play {
        display:grid; place-items:center; width:20px; height:20px; flex-shrink:0;
        border-radius:50%; background:#a779e833; color:#ddc4ff;
      }
      @media(prefers-reduced-motion:reduce) { .deposit-story-entry { transition:none; } }
    `}</style>
    <div data-demo-entry-row style={{display:'flex'}}>
      <button type="button" ref={trigger} disabled={disabled} onClick={()=>setOpen(true)} className="deposit-story-entry" aria-haspopup="dialog">
        <span className="story-play" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 2L10 6L4 10Z" fill="currentColor"/></svg></span>
        How does this work?
      </button>
    </div>
    {open && <InPlaceDemo onClose={close}/>}
  </>
}
