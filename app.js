(() => {
  'use strict'

  const $ = (selector, root = document) => root.querySelector(selector)
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector))

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */

  const TF_MS = 5 * 60 * 1000
  const TZ = 'America/New_York'
  const MONO = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

  const SESSIONS = [
    { id: 'asia', name: 'Asia', start: 20 * 60, end: 24 * 60, color: '#4f7cff', vol: 0.55 },
    { id: 'london', name: 'London', start: 2 * 60, end: 5 * 60, color: '#ff5d73', vol: 1.05 },
    { id: 'nyam', name: 'NY AM', start: 9 * 60 + 30, end: 11 * 60, color: '#37d67a', vol: 1.45 },
    { id: 'nylu', name: 'NY Lunch', start: 12 * 60, end: 13 * 60, color: '#f6d365', vol: 0.55 },
    { id: 'nypm', name: 'NY PM', start: 13 * 60 + 30, end: 16 * 60, color: '#a78bfa', vol: 1.1 }
  ]

  const nyParts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
  const nyStamp = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })

  function partsOf(timestamp) {
    const parts = nyParts.formatToParts(new Date(timestamp))
    const pick = (type) => parts.find((part) => part.type === type)?.value || ''
    return {
      weekday: pick('weekday'),
      year: pick('year'),
      month: pick('month'),
      day: pick('day'),
      hour: Number(pick('hour')),
      minute: Number(pick('minute'))
    }
  }

  function sessionAt(minuteOfDay) {
    for (const session of SESSIONS) {
      if (minuteOfDay >= session.start && minuteOfDay < session.end) return session
    }
    return null
  }

  function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  let seed = 20261028

  function generateBars() {
    const random = mulberry32(seed)
    const count = 760
    const last = Math.floor(Date.now() / TF_MS) * TF_MS - TF_MS
    const first = last - (count - 1) * TF_MS
    const bars = []
    let price = 2646.4
    for (let i = 0; i < count; i += 1) {
      const timestamp = first + i * TF_MS
      const parts = partsOf(timestamp)
      const session = sessionAt(parts.hour * 60 + parts.minute)
      const vol = session ? session.vol : 0.32
      const wave = Math.sin(i / 21) * 0.22 + Math.sin(i / 67) * 0.34
      const open = price
      const close = open + (random() - 0.5) * 2.35 * vol + wave * 0.055
      const wick = (0.08 + random() * 0.38) * vol
      const high = Math.max(open, close) + wick * random()
      const low = Math.min(open, close) - wick * random()
      price = close
      bars.push({
        t: timestamp,
        o: round(open),
        h: round(high),
        l: round(low),
        c: round(close),
        session: session ? session.id : null,
        parts
      })
    }
    return bars
  }

  function round(value) {
    return Math.round(value * 100) / 100
  }

  function buildZones(bars) {
    return SESSIONS.map((session) => {
      const zones = []
      let current = null
      for (let i = 0; i < bars.length; i += 1) {
        const bar = bars[i]
        if (bar.session === session.id) {
          if (!current) {
            current = { session, start: i, end: i, high: bar.h, low: bar.l }
          }
          current.end = i
          current.high = Math.max(current.high, bar.h)
          current.low = Math.min(current.low, bar.l)
        } else if (current) {
          zones.push(current)
          current = null
        }
      }
      if (current) zones.push(current)
      return zones
    }).flat()
  }

  function buildDailyOpens(bars) {
    const opens = []
    let key = ''
    for (let i = 0; i < bars.length; i += 1) {
      const parts = bars[i].parts
      const next = parts.year + parts.month + parts.day
      if (next !== key) {
        opens.push({ index: i, price: bars[i].o })
        key = next
      }
    }
    return opens
  }

  function aggregate(bars, minutes, limit) {
    const bucket = minutes * 60 * 1000
    const out = []
    let current = null
    let key = -1
    for (const bar of bars) {
      const next = Math.floor(bar.t / bucket)
      if (next !== key) {
        if (current) out.push(current)
        current = { t: next * bucket, o: bar.o, h: bar.h, l: bar.l, c: bar.c }
        key = next
      } else {
        current.h = Math.max(current.h, bar.h)
        current.l = Math.min(current.l, bar.l)
        current.c = bar.c
      }
    }
    if (current) out.push(current)
    return out.slice(-limit)
  }

  /* ------------------------------------------------------------------ */
  /* Demo canvas                                                         */
  /* ------------------------------------------------------------------ */

  const canvas = $('#chart')
  const ctx = canvas.getContext('2d')

  const view = {
    zones: true,
    pivots: true,
    dwm: true,
    htf: true,
    table: true
  }

  let bars = []
  let zones = []
  let dailyOpens = []
  let hover = null

  function fmtTime(timestamp) {
    return nyStamp.format(new Date(timestamp))
  }

  function duration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000))
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total - days * 86400) / 3600)
    const minutes = Math.floor((total - days * 86400 - hours * 3600) / 60)
    const seconds = total - days * 86400 - hours * 3600 - minutes * 60
    const two = (value) => String(value).padStart(2, '0')
    const clock = two(hours) + ':' + two(minutes) + ':' + two(seconds)
    return days > 0 ? days + 'D ' + clock : clock
  }

  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.arcTo(x + w, y, x + w, y + h, radius)
    ctx.arcTo(x + w, y + h, x, y + h, radius)
    ctx.arcTo(x, y + h, x, y, radius)
    ctx.arcTo(x, y, x + w, y, radius)
    ctx.closePath()
  }

  function alpha(hex, value) {
    const clean = hex.replace('#', '')
    const bigint = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255
    return `rgba(${r}, ${g}, ${b}, ${value})`
  }

  function render() {
    if (!canvas || !bars.length) return

    const rect = canvas.getBoundingClientRect()
    const width = Math.max(320, Math.round(rect.width))
    const height = Math.max(240, Math.round(rect.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const pad = { l: 10, r: 64, t: 26, b: 22 }
    const plotW = width - pad.l - pad.r
    const futureW = Math.max(150, Math.min(plotW * 0.36, 420))
    const mainW = plotW - futureW - 16
    const mainCount = 104
    const start = Math.max(0, bars.length - mainCount)
    const end = bars.length - 1
    const step = mainW / mainCount
    const xFor = (index) => pad.l + (index - start + 0.5) * step

    const panels = view.htf
      ? [
          { label: '5m', minutes: 5, candles: aggregate(bars, 5, 8) },
          { label: '15m', minutes: 15, candles: aggregate(bars, 15, 8) },
          { label: '1H', minutes: 60, candles: aggregate(bars, 60, 8) },
          { label: '4H', minutes: 240, candles: aggregate(bars, 240, 8) }
        ]
      : []

    const visibleBars = bars.slice(start)
    let min = Math.min(...visibleBars.map((bar) => bar.l))
    let max = Math.max(...visibleBars.map((bar) => bar.h))
    for (const panel of panels) {
      for (const candle of panel.candles) {
        min = Math.min(min, candle.l)
        max = Math.max(max, candle.h)
      }
    }
    const padding = (max - min) * 0.09 + 0.25
    min -= padding
    max += padding
    const yFor = (price) => pad.t + ((max - price) / (max - min)) * (height - pad.t - pad.b)

    const futureX = pad.l + mainW + 16

    /* horizontal grid + price axis */
    ctx.font = MONO
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const ticks = 5
    for (let i = 0; i <= ticks; i += 1) {
      const price = min + ((max - min) * i) / ticks
      const y = yFor(price)
      ctx.strokeStyle = 'rgba(255,255,255,0.055)'
      ctx.lineWidth = 1
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(pad.l, y)
      ctx.lineTo(width - pad.r, y)
      ctx.stroke()
      ctx.fillStyle = 'rgba(147,164,186,0.72)'
      ctx.fillText(price.toFixed(2), width - pad.r + 8, y)
    }

    /* vertical grid */
    for (let index = start; index <= end; index += 12) {
      const x = xFor(index)
      ctx.strokeStyle = 'rgba(255,255,255,0.035)'
      ctx.beginPath()
      ctx.moveTo(x, pad.t)
      ctx.lineTo(x, height - pad.b)
      ctx.stroke()
    }

    /* killzone shading */
    if (view.zones) {
      for (const zone of zones) {
        if (zone.end < start - 1 || zone.start > end) continue
        const from = Math.max(zone.start, start)
        const to = Math.min(zone.end, end)
        const x1 = xFor(from) - step / 2
        const x2 = xFor(to) + step / 2
        const y1 = yFor(zone.high)
        const y2 = yFor(zone.low)

        ctx.fillStyle = alpha(zone.session.color, 0.1)
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
        ctx.strokeStyle = alpha(zone.session.color, 0.3)
        ctx.lineWidth = 1
        ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1 - 1, y2 - y1 - 1)

        ctx.font = '600 9px ui-monospace, Menlo, monospace'
        ctx.fillStyle = alpha(zone.session.color, 0.95)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(zone.session.name.toUpperCase(), x1 + 5, y1 + 4)

        ctx.strokeStyle = alpha(zone.session.color, 0.55)
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y1)
        ctx.moveTo(x1, y2)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    /* DWM daily opens */
    if (view.dwm) {
      for (const open of dailyOpens) {
        if (open.index > end + 1) continue
        const y = yFor(open.price)
        if (y < pad.t || y > height - pad.b) continue
        const x = open.index < start ? pad.l : xFor(open.index)
        ctx.strokeStyle = 'rgba(246,183,60,0.5)'
        ctx.setLineDash([5, 4])
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(futureX - 8, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.font = '9px ui-monospace, Menlo, monospace'
        ctx.fillStyle = 'rgba(246,183,60,0.85)'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText('D OPEN', x + 4, y - 2)
      }
    }

    /* session start vertical markers */
    if (view.zones) {
      for (const zone of zones) {
        if (zone.start < start || zone.start > end) continue
        const x = xFor(zone.start) - step / 2
        ctx.strokeStyle = alpha(zone.session.color, 0.22)
        ctx.setLineDash([2, 4])
        ctx.beginPath()
        ctx.moveTo(x, pad.t)
        ctx.lineTo(x, height - pad.b)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    /* candles */
    for (let index = start; index <= end; index += 1) {
      const bar = bars[index]
      const x = xFor(index)
      const up = bar.c >= bar.o
      const color = up ? '#37d67a' : '#ff5d73'
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, yFor(bar.h))
      ctx.lineTo(x, yFor(bar.l))
      ctx.stroke()
      const bodyTop = yFor(Math.max(bar.o, bar.c))
      const bodyBottom = yFor(Math.min(bar.o, bar.c))
      const bodyW = Math.max(2, step * 0.58)
      ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, Math.max(1, bodyBottom - bodyTop))
    }

    /* pivots */
    if (view.pivots) {
      const recent = zones.filter((zone) => zone.end >= start)
      for (const zone of recent) {
        const pivotEnd = mitigationEnd(zone)
        const from = Math.max(zone.start, start)
        if (zone.start > end) continue
        const x1 = xFor(from)
        const x2 = xFor(Math.min(pivotEnd, end))
        const yHigh = yFor(zone.high)
        const yLow = yFor(zone.low)

        ctx.strokeStyle = alpha(zone.session.color, 0.8)
        ctx.lineWidth = 1
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(x1, yHigh)
        ctx.lineTo(x2, yHigh)
        ctx.moveTo(x1, yLow)
        ctx.lineTo(x2, yLow)
        ctx.stroke()
        ctx.setLineDash([])

        const showHigh = x2 > pad.l && x2 < futureX - 2
        if (showHigh) {
          const label = zone.session.id === 'asia' ? 'AS' : zone.session.id === 'london' ? 'LO' : zone.session.name.replace(' ', '')
          ctx.font = '9px ui-monospace, Menlo, monospace'
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'left'
          const text = label + '.H'
          const tw = ctx.measureText(text).width
          ctx.fillStyle = 'rgba(8,13,21,0.85)'
          roundRect(x2 + 3, yHigh - 8, tw + 8, 16, 4)
          ctx.fill()
          ctx.strokeStyle = alpha(zone.session.color, 0.5)
          ctx.stroke()
          ctx.fillStyle = alpha(zone.session.color, 0.95)
          ctx.fillText(text, x2 + 7, yHigh)
        }
      }
    }

    /* HTF panels */
    if (panels.length) {
      const panelW = (futureW - 8) / panels.length
      for (let p = 0; p < panels.length; p += 1) {
        const panel = panels[p]
        const px = futureX + p * panelW
        const inner = panelW - 14
        const slot = inner / 8
        const bodyW = Math.max(2.5, Math.min(7, slot * 0.55))
        const now = Date.now()

        ctx.fillStyle = 'rgba(255,255,255,0.018)'
        roundRect(px + 2, pad.t, panelW - 6, height - pad.t - pad.b, 8)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'
        ctx.setLineDash([])
        ctx.stroke()

        ctx.font = '600 10px ui-monospace, Menlo, monospace'
        ctx.fillStyle = 'rgba(233,239,248,0.86)'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(panel.label, px + 8, pad.t + 6)
        ctx.font = '9px ui-monospace, Menlo, monospace'
        ctx.fillStyle = 'rgba(147,164,186,0.65)'
        ctx.fillText(duration(panel.candles[panel.candles.length - 1].t + panel.minutes * 60000 - now), px + 30, pad.t + 7)

        for (let j = 0; j < panel.candles.length; j += 1) {
          const candle = panel.candles[j]
          const cx = px + 10 + j * slot + slot / 2
          const up = candle.c >= candle.o
          const color = up ? '#37d67a' : '#ff5d73'
          ctx.strokeStyle = color
          ctx.fillStyle = color
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(cx, yFor(candle.h))
          ctx.lineTo(cx, yFor(candle.l))
          ctx.stroke()
          const top = yFor(Math.max(candle.o, candle.c))
          const bottom = yFor(Math.min(candle.o, candle.c))
          ctx.fillRect(cx - bodyW / 2, top, bodyW, Math.max(1, bottom - top))
        }
      }
    }

    /* last price */
    const last = bars[end]
    const lastY = yFor(last.c)
    const up = last.c >= last.o
    const lastColor = up ? '#37d67a' : '#ff5d73'
    ctx.strokeStyle = alpha(lastColor, 0.6)
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(pad.l, lastY)
    ctx.lineTo(width - pad.r, lastY)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = lastColor
    roundRect(width - pad.r + 2, lastY - 9, pad.r - 4, 18, 3)
    ctx.fill()
    ctx.fillStyle = '#06120c'
    ctx.font = '600 10px ui-monospace, Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(last.c.toFixed(2), width - pad.r / 2 + 1, lastY)

    /* killzone range table */
    if (view.table) drawTable(start, end, min, max, pad)

    /* hover crosshair */
    if (hover) drawCrosshair(hover, start, end, step, pad, xFor, yFor, height, width)

    document.body.setAttribute('data-ready', 'true')
  }

  function mitigationEnd(zone) {
    for (let i = zone.end + 1; i < bars.length; i += 1) {
      if (bars[i].h > zone.high || bars[i].l < zone.low) return i
    }
    return bars.length - 1
  }

  function drawTable(start, end, min, max, pad) {
    const rows = []
    for (const session of SESSIONS) {
      const list = zones.filter((zone) => zone.session.id === session.id)
      if (!list.length) continue
      const latest = list[list.length - 1]
      const completed = list.slice(0, -1).slice(-5).map((zone) => zone.high - zone.low)
      const average = completed.length ? completed.reduce((a, b) => a + b, 0) / completed.length : 0
      rows.push({ name: session.name, color: session.color, range: latest.high - latest.low, average, count: completed.length })
    }
    if (!rows.length) return

    const colW = [92, 58, 54]
    const tableW = colW[0] + colW[1] + colW[2] + 16
    const rowH = 20
    const tableH = rowH * (rows.length + 1) + 12
    const x = pad.l + 10
    const y = pad.t + 10

    ctx.fillStyle = 'rgba(7,11,17,0.86)'
    roundRect(x, y, tableW, tableH, 8)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.font = '8.5px ui-monospace, Menlo, monospace'
    ctx.fillStyle = 'rgba(147,164,186,0.7)'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('KILLZONE', x + 8, y + 11)
    ctx.fillText('RANGE', x + 8 + colW[0], y + 11)
    ctx.fillText('AVG(' + (rows[0]?.count || 0) + ')', x + 8 + colW[0] + colW[1], y + 11)

    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.beginPath()
    ctx.moveTo(x + 8, y + 21)
    ctx.lineTo(x + tableW - 8, y + 21)
    ctx.stroke()

    rows.forEach((row, index) => {
      const rowY = y + 32 + index * rowH
      if (index % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.018)'
        ctx.fillRect(x + 1, rowY - 9, tableW - 2, rowH)
      }
      ctx.fillStyle = row.color
      ctx.fillRect(x + 8, rowY - 3, 5, 6)
      ctx.font = '10px ui-monospace, Menlo, monospace'
      ctx.fillStyle = 'rgba(233,239,248,0.9)'
      ctx.fillText(row.name, x + 19, rowY)
      ctx.fillStyle = 'rgba(233,239,248,0.72)'
      ctx.fillText(row.range.toFixed(2), x + 8 + colW[0], rowY)
      ctx.fillStyle = 'rgba(147,164,186,0.75)'
      ctx.fillText(row.average ? row.average.toFixed(2) : '—', x + 8 + colW[0] + colW[1], rowY)
    })
  }

  function drawCrosshair(info, start, end, step, pad, xFor, yFor, height, width) {
    const index = Math.max(start, Math.min(end, start + Math.floor((info.x - pad.l) / step)))
    const bar = bars[index]
    if (!bar) return
    const x = xFor(index)
    const y = yFor(bar.c)

    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.setLineDash([3, 3])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, pad.t)
    ctx.lineTo(x, height - pad.b)
    ctx.moveTo(pad.l, info.y)
    ctx.lineTo(width - pad.r, info.y)
    ctx.stroke()
    ctx.setLineDash([])

    const lines = [
      fmtTime(bar.t),
      'O ' + bar.o.toFixed(2) + '   H ' + bar.h.toFixed(2),
      'L ' + bar.l.toFixed(2) + '   C ' + bar.c.toFixed(2),
      bar.session ? bar.session.toUpperCase() + ' session' : 'Outside killzones'
    ]
    ctx.font = '10px ui-monospace, Menlo, monospace'
    const boxW = 148
    const boxH = 66
    let bx = x + 12
    if (bx + boxW > width - pad.r) bx = x - boxW - 12
    let by = Math.max(pad.t + 4, Math.min(info.y - boxH / 2, height - pad.b - boxH))
    ctx.fillStyle = 'rgba(7,11,17,0.94)'
    roundRect(bx, by, boxW, boxH, 7)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? '#f6b73c' : 'rgba(233,239,248,0.82)'
      ctx.fillText(line, bx + 9, by + 8 + i * 14)
    })
  }

  /* ------------------------------------------------------------------ */
  /* Interactions                                                        */
  /* ------------------------------------------------------------------ */

  function bindControls() {
    for (const button of $$('.toggle')) {
      button.addEventListener('click', () => {
        const key = button.dataset.toggle
        view[key] = !view[key]
        button.setAttribute('aria-pressed', String(view[key]))
        render()
      })
    }

    canvas.addEventListener('mousemove', (event) => {
      const rect = canvas.getBoundingClientRect()
      hover = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      render()
    })
    canvas.addEventListener('mouseleave', () => {
      hover = null
      render()
    })
    canvas.addEventListener('click', () => {
      seed += 17
      regenerate()
    })

    let pending = 0
    const onResize = () => {
      cancelAnimationFrame(pending)
      pending = requestAnimationFrame(render)
    }
    window.addEventListener('resize', onResize)
    if ('ResizeObserver' in window) {
      new ResizeObserver(onResize).observe(canvas.parentElement)
    }
  }

  function regenerate() {
    bars = generateBars()
    zones = buildZones(bars)
    dailyOpens = buildDailyOpens(bars)
    render()
  }

  /* ------------------------------------------------------------------ */
  /* Code viewer                                                         */
  /* ------------------------------------------------------------------ */

  const schemaEl = $('#inputs-schema')
  const scriptEl = $('#indicator-script')
  let inputsJson = '[]'
  let scriptSource = ''

  function bytes(text) {
    return new Blob([text]).size
  }

  function formatBytes(value) {
    if (value < 1024) return value + ' B'
    return (value / 1024).toFixed(1) + ' KB'
  }

  const codeState = { tab: 'inputs' }

  function activeText() {
    return codeState.tab === 'inputs' ? inputsJson : scriptSource
  }

  function updateCode() {
    const text = activeText()
    $('#code-text').textContent = text
    $('#file-meta').textContent =
      (codeState.tab === 'inputs' ? 'inputs.json' : 'indicator.js') + ' · ' + formatBytes(bytes(text))
    for (const tab of $$('.tab')) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === codeState.tab))
    }
    const panel = $('#code-view')
    panel.setAttribute('aria-labelledby', codeState.tab === 'inputs' ? 'tab-inputs' : 'tab-script')
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    }
  }

  function bindCode() {
    for (const tab of $$('.tab')) {
      tab.addEventListener('click', () => {
        codeState.tab = tab.dataset.tab
        updateCode()
      })
    }

    const copyButton = $('#copy-code')
    const copyLabel = $('#copy-label')
    copyButton.addEventListener('click', async () => {
      const ok = await copyText(activeText())
      copyLabel.textContent = ok ? 'Copied' : 'Failed'
      setTimeout(() => {
        copyLabel.textContent = 'Copy'
      }, 1400)
    })

    $('#download-code').addEventListener('click', () => {
      if (codeState.tab === 'inputs') {
        download('ict-killzones-inputs.json', inputsJson, 'application/json')
      } else {
        download('ict-killzones-script.js', scriptSource, 'text/javascript')
      }
    })

    $('#download-hero').addEventListener('click', () => {
      download('ict-killzones-script.js', scriptSource, 'text/javascript')
    })
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  function boot() {
    try {
      const parsed = JSON.parse(schemaEl.textContent)
      inputsJson = JSON.stringify(parsed, null, 2)
      $('#input-count').textContent = String(parsed.length)
    } catch {
      inputsJson = schemaEl.textContent.trim()
    }
    scriptSource = scriptEl.textContent.trim()
    if (!scriptSource || scriptSource.includes('PLACEHOLDER')) {
      scriptSource = '/* Conversion script not embedded. */'
    }

    bars = generateBars()
    zones = buildZones(bars)
    dailyOpens = buildDailyOpens(bars)

    bindControls()
    bindCode()
    updateCode()
    render()

    requestAnimationFrame(() => {
      render()
      setTimeout(() => {
        document.body.setAttribute('data-ready', 'true')
        window.__ICT_READY__ = true
      }, 60)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
