import { clamp, ease, positionOnCurve } from '../prototypes/deposit-story/story.js'
export function depositFloorPath(time, origin, edge, destination) {
  const roll = ease(time / 1200)
  if (time <= 1200) return { x:origin.x+(edge.x-origin.x)*roll, y:origin.y, rotation:(edge.x-origin.x)*roll/22*180/Math.PI }
  const p = ease((time-1200)/800)
  const clear = {x:edge.x+60,y:edge.y+65}
  const point = p<.45 ? {x:edge.x+60*p/.45,y:edge.y+65*(p/.45)**2}
    : positionOnCurve((p-.45)/.55,clear,{x:destination.x,y:clear.y},destination)
  return { ...point, rotation:(edge.x-origin.x)/22*180/Math.PI+p*160 }
}
export function withdrawFloorPath(time, index, start, origin, edge) {
  const age = time-index*460, lift = ease(age/1000), end = {x:origin.x+index*52,y:origin.y}
  if (age < 1000) {
    const outside={x:edge.x+80,y:edge.y+65}
    const point=lift<.45 ? positionOnCurve(lift/.45,start,{x:outside.x,y:start.y},outside)
      : positionOnCurve((lift-.45)/.55,outside,{x:edge.x+100,y:edge.y-90},edge)
    return {...point,p:clamp(age/2500),rotation:-180*lift}
  }
  const roll = ease((age-1000)/1500)
  return {x:edge.x+(end.x-edge.x)*roll,y:origin.y,p:clamp(age/2500),rotation:-180+(end.x-edge.x)*roll/22*180/Math.PI}
}
export function entryBarProgress(step,time,count,captured) {
  if(step===7) return 0
  if(step===5 && time<1300) return Math.min(.62,captured/20)*(1-ease(time/1200))
  return Math.min(.62,count/20)
}
export function bubbleAnchor(layout,step,height=145) {
  const {card,input,count,ticketHeading,pageWidth}=layout
  const width=Math.min(step===7?390:320,card.width-48,pageWidth-24)
  if(layout.focusStacked && [2,3,4,6].includes(step)) {
    const vault=layout.vaultCard
    return {x:Math.max(12,Math.min(vault.x+(step===4?12:vault.width-width-12),pageWidth-width-12)),y:vault.y+vault.height+12,width}
  }
  // Reserve the blank space between the deposit floor and ticket heading.
  // Height is measured from the rendered bubble, not guessed from the copy.
  const top=input.y+input.height+26
  const bottom=(ticketHeading?.y ?? count.y-28)-24-height
  const positions=[[0,0],[0,1],[1,0],[1,.4],[1,1],[0,.8],[1,.2],[0,0]]
  const [across,down]=positions[step] || positions[0]
  const x=card.x+24+across*Math.max(0,card.width-width-48)
  return {x:Math.max(12,Math.min(x,pageWidth-width-12)),y:top+down*Math.max(0,bottom-top),width}
}
