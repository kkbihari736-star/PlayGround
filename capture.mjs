import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const started = performance.now()
const timings = []
async function step(name, fn) {
  const t0 = performance.now()
  try {
    return await fn()
  } finally {
    timings.push(`${name}: ${((performance.now() - t0) / 1000).toFixed(2)}s`)
  }
}

class TransientError extends Error {
  constructor(message) {
    super(message)
    this.exitCode = 75
  }
}

const url = process.env.CAPTURE_URL
const outDir = process.env.CAPTURE_DIR
if (!url || !outDir) {
  console.error('Set CAPTURE_URL and CAPTURE_DIR.')
  process.exit(1)
}

const runtime = join(process.env.HOME || '', '.local/share/omgithub-playwright')
let chromium
try {
  const require = createRequire(join(runtime, 'package.json'))
  ;({ chromium } = require('playwright'))
} catch (error) {
  console.error(`Unable to load Playwright from ${runtime}: ${error.message}`)
  process.exit(75)
}

if (process.platform === 'linux' && !process.env.DISPLAY) {
  const displayFile = join(runtime, 'display')
  if (existsSync(displayFile)) {
    const display = readFileSync(displayFile, 'utf8').trim()
    if (display) process.env.DISPLAY = `:${display}`
  }
}

let launchOptions = { headless: true }
const configFile = join(runtime, process.platform === 'darwin' ? 'metal.json' : 'linux.json')
if (existsSync(configFile)) {
  try {
    launchOptions = JSON.parse(readFileSync(configFile, 'utf8')).browser?.launchOptions || launchOptions
  } catch {
    // Keep the headless fallback.
  }
}

mkdirSync(outDir, { recursive: true })

const transient = (error) => {
  if (error?.exitCode) throw error
  throw new TransientError(error?.message || String(error))
}

let browser
try {
  browser = await step('launch', () => chromium.launch({ ...launchOptions, timeout: 30000 }).catch(transient))

  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const context = await step(`${name}:new-context`, () =>
      browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }).catch(transient)
    )
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })

    let response
    try {
      response = await step(`${name}:goto`, () =>
        page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(transient)
      )
    } catch (error) {
      // A failed navigation is temporary infrastructure unless it is a script defect.
      throw error
    }

    if (!response || !response.ok()) {
      const status = response?.status()
      const temporary = !response || [408, 429, 500, 502, 503, 504].includes(status)
      const message = `HTTP ${status ?? 'no response'} loading ${url}`
      if (temporary) throw new TransientError(message)
      throw new Error(message)
    }

    let ready = true
    try {
      await step(`${name}:ready-selector`, () =>
        page.locator('[data-ready="true"]').waitFor({ state: 'visible', timeout: 30000 })
      )
    } catch {
      ready = false
    }

    await step(`${name}:fonts`, () => page.evaluate(() => document.fonts.ready).catch(() => undefined))
    await step(`${name}:settle`, () => page.waitForTimeout(900))

    const check = await page.evaluate(() => {
      const heading = document.querySelector('h1')
      const canvas = document.querySelector('canvas')
      if (!heading || !canvas) return { ok: false, reason: 'missing heading or canvas' }
      if (!heading.textContent || !heading.textContent.trim()) return { ok: false, reason: 'empty heading' }
      const width = canvas.width
      const height = canvas.height
      if (!width || !height) return { ok: false, reason: 'empty canvas' }
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return { ok: false, reason: 'no 2d context' }
      const data = context.getImageData(0, 0, width, height).data
      let min = 255
      let max = 0
      let samples = 0
      for (let i = 0; i < data.length; i += 4 * 89) {
        const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
        min = Math.min(min, luminance)
        max = Math.max(max, luminance)
        samples += 1
      }
      if (samples < 20 || max - min < 20) return { ok: false, reason: 'canvas appears blank' }
      return { ok: true }
    })

    if (!ready) throw new Error(`${name}: app never signalled data-ready`)
    if (!check.ok) throw new Error(`${name}: ${check.reason}`)
    if (pageErrors.length) {
      console.error(`${name}: page errors: ${pageErrors.slice(0, 4).join(' | ')}`)
      throw new Error(`${name}: runtime errors on the page`)
    }

    await step(`${name}:screenshot`, () =>
      page
        .screenshot({ path: join(outDir, `final-${name}.png`), fullPage: false, timeout: 30000 })
        .catch((error) => {
          if (error.name === 'TimeoutError' || !browser.isConnected()) transient(error)
          throw error
        })
    )
    console.log(`captured ${join(outDir, `final-${name}.png`)} (${width}x${height})`)
    await context.close()
  }
} catch (error) {
  console.error(error?.message || error)
  process.exitCode = error?.exitCode || 1
} finally {
  if (browser) {
    await browser.close().catch(() => {
      process.exitCode ||= 75
    })
  }
  for (const line of timings) console.log(`[time] ${line}`)
  console.log(`[time] total: ${((performance.now() - started) / 1000).toFixed(2)}s`)
}
