import {test} from 'node:test'
import assert from 'node:assert/strict'
import {depositFloorPath,withdrawFloorPath,entryBarProgress,bubbleAnchor} from './depositStoryMotion.js'
const origin={x:-600,y:-100},edge={x:-240,y:-100},dest={x:-65,y:145}
test('deposit rolls on floor to edge before falling',()=>{
 for(const t of [0,300,600,900,1200]) assert.equal(depositFloorPath(t,origin,edge,dest).y,origin.y)
 assert.equal(depositFloorPath(1200,origin,edge,dest).x,edge.x)
 for(const t of [1250,1500,1800]) {const p=depositFloorPath(t,origin,edge,dest);assert.ok(p.x>edge.x);assert.ok(p.y>edge.y)}
 assert.equal(depositFloorPath(2000,origin,edge,dest).x,dest.x)
})
test('all withdrawal tokens land at edge then roll on the floor',()=>{
 for(let i=0;i<6;i++){
  const at=t=>withdrawFloorPath(t+i*460,i,dest,origin,edge)
  assert.equal(at(1000).x,edge.x);assert.equal(at(1000).y,origin.y)
  for(const t of [1100,1500,2000,2500]) assert.equal(at(t).y,origin.y)
  assert.equal(at(2500).x,origin.x+i*52)
 }
})
test('ticket bar drains continuously before rebuilding',()=>{
 const widths=[0,300,600,900,1200].map(t=>entryBarProgress(5,t,8,8))
 assert.equal(widths[0],.4);assert.equal(widths.at(-1),0)
 for(let i=1;i<widths.length;i++) assert.ok(widths[i]<widths[i-1])
 assert.ok(entryBarProgress(5,4000,2,8)>0)
})
test('speech bubbles use different action anchors',()=>{
 const l={card:{x:60,width:778},input:{y:290,height:60},count:{y:615},cta:{y:420},vault:{x:900,y:260},pageWidth:1440}
 const anchors=[0,1,2,3,4,5,6,7].map(s=>bubbleAnchor(l,s))
 assert.ok(new Set(anchors.map(a=>a.x+','+a.y)).size>=5)
 for(const a of anchors) assert.ok(a.x>=0 && a.x+a.width<=1440)
})
