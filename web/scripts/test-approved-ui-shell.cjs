const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright')
const assert=require('node:assert/strict')
;(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']})
 try {
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.fulfill({body:'{}',contentType:'application/json'}))
  for(const route of ['/#vault','/#patron','/#stats','/#profile','/#leaderboard','/articles/drawn-back-to-defi']) {
   await page.goto('http://localhost:4180'+route)
   await page.locator('.footer-bar').waitFor({state:'attached'})
   assert.deepEqual(await page.locator('header .nav-links a').allTextContents(),['Vault','Patron','Profile','Leaderboard'])
   assert.deepEqual(await page.locator('.footer-links a').allTextContents(),['Articles','Docs'])
   assert.equal(await page.getByRole('link',{name:'EverDraw on X',exact:true}).getAttribute('href'),'https://x.com/everdrawing')
   assert.equal(await page.locator('.footer-bar').evaluate(e=>e.previousElementSibling.matches('.disclaimer-box')),true)
   if(route==='/#patron') {
    const paragraphs=await page.locator('.v5-patron-details p').allTextContents()
    assert.equal(paragraphs[0].trim(),'Depositing in the Patron Pool does not give you entries into the weekly draw. Instead, you become a patron and contribute your yield to the prize pool. This noble sacrifice helps make the weekly prize larger for everyone while you earn BOOSTED EverDraw points. The longer you remain a patron, the bigger your boosted points.')
    assert.equal(paragraphs[1].trim(),'This pool is illiquid and deposits are not tradeable in DeFi. When you withdraw, you receive 100% of your initial MON deposit value back as shMON.')
   }
   if(route==='/#stats') assert.ok(await page.locator('.stats-page').count() || await page.getByText('Stats',{exact:true}).count())
  }
  await page.goto('http://localhost:4180/')
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:900})
   await page.locator('.footer-bar').scrollIntoViewIfNeeded()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   assert.equal(await page.locator('.footer-bar').evaluate(e=>getComputedStyle(e,'::before').height),'1px')
   assert.equal(await page.locator('.footer-bar').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(21, 19, 31)')
  }
  assert.deepEqual(errors,[])
  console.log('PASS: six page routes, simplified navigation, exact Patron copy, accessible Stats, desktop/mobile footer')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)})
