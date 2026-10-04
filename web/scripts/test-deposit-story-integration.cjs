const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
      // Offline UI acceptance: no chain/indexer/wallet service calls leave the browser.
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.addInitScript(() => {
      window.demoWalletCalls = []
      window.ethereum = { on() {}, removeListener() {}, request: async ({ method }) => {
        window.demoWalletCalls.push(method)
        if (method === 'eth_accounts') return []
        if (method === 'eth_chainId') return '0x279f'
        throw Error('Unexpected wallet request: ' + method)
      } }
    })
    await page.goto('http://127.0.0.1:4180/')
    const trigger = page.getByRole('button', { name: 'How does this work?' })
    await trigger.waitFor()
    const amount = page.locator('.v5-product-card input[type=number]')
    await amount.fill('7.25')
    await page.locator('.token-select-btn').click()
    await page.locator('.token-dropdown-item').filter({ hasText: 'shMON' }).click()
    const styleBefore = await page.locator('.v5-product-card').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, font: getComputedStyle(el).fontFamily }))
    const baselineCalls = await page.evaluate(() => [...window.demoWalletCalls])
    const out = path.resolve(__dirname, '../../.preview-qa')
    fs.mkdirSync(out,{recursive:true})
    await page.screenshot({ path: path.join(out, 'integrated-vault.png'), fullPage: true })
    await trigger.scrollIntoViewIfNeeded()
    const geometry = async () => page.locator('.v5-product-card, #vault-card, .v5-action-pill, .v5-tickets-value, #vault-card .vault-door').evaluateAll(nodes => nodes.map(el => { const r=el.getBoundingClientRect(); return [r.x,r.y+scrollY,r.width,r.height] }))
    const beforeGeometry = await geometry()
    const beforeScroll = await page.evaluate(() => scrollY)
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'How does this work? — demo mode' })
    await dialog.locator('.demo-heading').waitFor()
    assert.equal(await page.locator('.app-shell').evaluate(el => el.inert), true)
    assert.deepEqual(await geometry(), beforeGeometry, 'Cards and controls must not resize or move')
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden', 'Opening locks the focused view')
    const liveVault = await page.locator('#vault-card .vault-door').boundingBox()
    const demoVault = await dialog.locator('[data-testid="anchored-vault"] > circle').first().evaluate(el => el.getBoundingClientRect().toJSON())
    assert.ok(Math.abs(demoVault.width - Math.min(liveVault.width,liveVault.height)*310/320) < 1, 'Animated vault must match the real outer ring diameter')
    assert.ok(Math.abs(demoVault.x+demoVault.width/2-liveVault.x-liveVault.width/2) < 1, 'Vault center x must not move')
    assert.ok(Math.abs(demoVault.y+demoVault.height/2-liveVault.y-liveVault.height/2) < 1, 'Vault center y must not move')
    assert.equal(await dialog.locator('.demo-heading').textContent(), 'DEMO MODE')
    assert.equal(await page.locator('.v5-product-card').evaluate(el => getComputedStyle(el).fontFamily), styleBefore.font)
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab')
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'Focus must stay inside modal')
    }
    const bubblePositions = []
    assert.equal(await page.locator('.stat-card').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(16, 35, 28)')
    assert.equal(await page.locator('.stat-value').first().evaluate(el => getComputedStyle(el, '::after').content), '"0"')
    for (let step = 0; step < 8; step++) {
      await page.waitForTimeout(500)
      assert.equal(await dialog.locator('main').getAttribute('data-stage'), String(step))
      const bubble = await dialog.locator('.action-bubble').boundingBox()
      bubblePositions.push([Math.round(bubble.x),Math.round(bubble.y)])
      if (step === 7) {
        assert.equal(await page.locator('.v5-action-pill-knob').evaluate(el => getComputedStyle(el, '::after').content), '"−"')
        assert.equal(await page.locator('.v5-action-pill-btn').last().evaluate(el => getComputedStyle(el).color), 'rgb(237, 255, 245)')
        assert.equal(await dialog.locator('.action-bubble p').textContent(), 'You can withdraw your deposit and your prize tokens the same way you deposited them')
      }
      if ([0, 3, 6, 7].includes(step)) await page.screenshot({ path: path.join(out, 'integrated-step-' + step + '.png') })
      const name = step === 7 ? 'Done' : step === 6 ? 'What if I want to withdraw?' : 'Next'
      await dialog.getByRole('button', { name, exact: true }).click()
    }
    assert.ok(new Set(bubblePositions.map(p=>p.join(','))).size>=5, 'Bubbles must move between action areas')
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await geometry(), beforeGeometry, 'Closing must restore the same geometry')
    assert.equal(await page.evaluate(() => scrollY), beforeScroll, 'Closing must not scroll')
    assert.equal(await amount.inputValue(), '7.25')
    assert.match(await page.locator('.token-select-btn').textContent(), /shMON/)
    await page.waitForFunction(() => document.activeElement?.textContent.includes('How does this work?'))
    assert.deepEqual(await page.evaluate(() => window.demoWalletCalls), baselineCalls)
    const styleAfter = await page.locator('.v5-product-card').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, font: getComputedStyle(el).fontFamily }))
    assert.deepEqual(styleAfter, styleBefore)
    await page.getByRole('button', { name: 'Withdraw', exact: true }).click()
    await trigger.click()
    await dialog.locator('.demo-heading').waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.match(await page.locator('.v5-action-pill-btn.active').textContent(), /Withdraw/)
    assert.equal(await amount.inputValue(), '7.25')
    assert.equal(await page.evaluate(() => document.body.style.overflow), '')
    await page.setViewportSize({ width: 390, height: 844 })
    await trigger.click()
    await dialog.locator('.demo-heading').waitFor()
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false)
    await page.screenshot({ path: path.join(out, 'integrated-mobile.png') })
    for (let step=0;step<7;step++) {
      await page.waitForTimeout(400)
      const bounds=await page.locator(step>=2 && step<=6 && step!==5 ? '#vault-card' : '.v5-product-card').boundingBox()
      assert.ok(bounds.x>=0 && bounds.x+bounds.width<=390,'Active mobile card fits screen')
      const bubble=await dialog.locator('.action-bubble').boundingBox()
      if([2,3,4,6].includes(step)) assert.ok(bubble.y>=bounds.y+bounds.height,'Mobile vault caption stays outside the vault')
      else assert.ok(bubble.y>bounds.y && bubble.y+bubble.height<bounds.y+bounds.height,'Mobile deposit caption stays in its card')
      if([2,6].includes(step)) await page.screenshot({path:path.join(out,'integrated-mobile-'+step+'.png')})
      if(step<6) await dialog.getByRole('button',{name:'Next',exact:true}).click()
    }
    await dialog.getByRole('button', { name: 'Exit demo', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(await page.evaluate(() => window.demoWalletCalls), baselineCalls)
    assert.deepEqual(errors, [])
    const result = { passed: true, checks: ['real V5 integration', 'eight stages', 'native modal focus containment', 'amount and asset preserved', 'withdraw mode preserved', 'no additional wallet requests', 'styles isolated', 'Escape and Exit and Done close', 'scroll restored', 'mobile no horizontal overflow'], visualApproval: 'user approved 2026-10-04', network: 'external services mocked; no chain transaction performed' }
    fs.writeFileSync(path.join(out, 'integration-results.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exit(1) })
