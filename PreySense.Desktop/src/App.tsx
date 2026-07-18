import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────
type Screen = 'dashboard' | 'fan' | 'lighting' | 'display'
type FanMode = 'auto' | 'max' | 'custom'
type DisplayProfile = 'native' | 'srgb' | 'custom'
type PerfMode = 'quiet' | 'balanced' | 'performance' | 'turbo'
type RgbEffect = 'static' | 'zonal_static' | 'breathe' | 'neon' | 'wave' | 'shifting' | 'zoom' | 'snake' | 'disco'
type WaveDir = 'ltr' | 'rtl'

// ─── Constants ─────────────────────────────────────────────────────────
const A = '#5fa8b0'
const T = '#e4e6ea'
const M = '#8b909a'
const P = '#1c1f24'
const P2 = '#22262d'
const B = 'rgba(255,255,255,0.08)'

const SWATCHES = [{ l: 'Predator Red', c: '#e03a3a' }, { l: 'Predator Blue', c: '#2080e0' }, { l: 'White', c: '#ffffff' }, { l: 'Off', c: '#000000' }, { l: 'Cyan', c: '#5fa8b0' }, { l: 'Orange', c: '#e8843a' }]
const ZONE_LABELS = ['Zone 1 \u00b7 Left', 'Zone 2 \u00b7 Ctr-L', 'Zone 3 \u00b7 Ctr-R', 'Zone 4 \u00b7 Right']
const ZONE_DEF = ['#5fa8b0', '#7ca8cc', '#cc9a5f', '#a07bb0']

// Hardware mode IDs (matches RgbProfile.cs UiModeNames order)
const RGB_MODE: Record<RgbEffect, number> = { static: 0, zonal_static: 0, breathe: 1, neon: 2, wave: 3, shifting: 4, zoom: 5, snake: 6, disco: 7 }

// ─── Utility ───────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function hexToRgb(hex: string) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(c => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('')
}

function hsvToRgb(h: number, s: number, v: number) {
  const sn = clamp(s, 0, 100) / 100
  const vn = clamp(v, 0, 100) / 100
  const f = (n: number) => { const k = (n + h / 60) % 6; return vn - vn * sn * Math.max(Math.min(k, 4 - k, 1), 0) }
  return { r: clamp(Math.round(255 * f(5)), 0, 255), g: clamp(Math.round(255 * f(3)), 0, 255), b: clamp(Math.round(255 * f(1)), 0, 255) }
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = clamp(r, 0, 255) / 255; const gn = clamp(g, 0, 255) / 255; const bn = clamp(b, 0, 255) / 255
  const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn), d = mx - mn
  let h = 0; if (d) { if (mx === rn) h = ((gn - bn) / d) % 6; else if (mx === gn) h = (bn - rn) / d + 2; else h = (rn - gn) / d + 4; h *= 60; if (h < 0) h += 360 }
  return { h: Math.round(h * 100) / 100, s: Math.round((mx ? d / mx : 0) * 10000) / 100, v: Math.round(mx * 10000) / 100 }
}

function sendCmd(method: string, params?: Record<string, unknown>) {
  return window.preySense.send(method, params).catch(() => {})
}

const PERF_MAP: Record<PerfMode, number> = { quiet: 0, balanced: 1, performance: 4, turbo: 5 }
const FAN_MAP: Record<FanMode, number> = { auto: 0, max: 1, custom: 2 }

// ─── Live Data ─────────────────────────────────────────────────────────
function useLive() {
  const [d, setD] = useState({ cpuTemp: 0, gpuTemp: 0, cpuFan: 0, gpuFan: 0, watt: 0, cpuUsage: 0, gpuUsage: 0, onAc: false, batteryPercent: 0 })
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await window.preySense.getTelemetry()
        setD({
          cpuTemp: data.cpuTemp, gpuTemp: data.gpuTemp, cpuFan: data.cpuFanRpm, gpuFan: data.gpuFanRpm,
          watt: data.watt, cpuUsage: data.cpuUsage, gpuUsage: data.gpuUsage, onAc: data.onAc, batteryPercent: data.batteryPercent,
        })
      } catch { /* host not available */ }
    }
    poll()
    const id = setInterval(poll, 2500)
    return () => clearInterval(id)
  }, [])
  return d
}

// ─── UI Primitives ─────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: P, borderRadius: 10, padding: '20px', border: `1px solid ${B}`, ...style }}>{children}</div>
}

function SegCtrl<V extends string>({ opts, val, onChange }: { opts: { v: V; l: string }[]; val: V; onChange: (v: V) => void }) {
  return (
    <div style={{ display: 'inline-flex', background: P2, borderRadius: 7, padding: 3, gap: 2, flexWrap: 'wrap' }}>
      {opts.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          padding: '5px 14px', borderRadius: 5, border: 'none',
          background: val === o.v ? '#2b3038' : 'transparent',
          color: val === o.v ? T : M, fontSize: 12, fontWeight: val === o.v ? 500 : 400,
          fontFamily: "'Inter',sans-serif", cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
          letterSpacing: '0.01em', whiteSpace: 'nowrap',
        }}>{o.l}</button>
      ))}
    </div>
  )
}

function Mono({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span style={{ fontFamily: "'JetBrains Mono',monospace", color: A, ...style }}>{children}</span>
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', color: M, fontWeight: 500, marginBottom: 14 }}>{children}</div>
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', color: T }}>{title}</h1>
      {subtitle && <p style={{ margin: '4px 0 0', fontSize: 12, color: M }}>{subtitle}</p>}
    </div>
  )
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderBottom: `1px solid ${B}` }}>
      <span style={{ fontSize: 12, color: M }}>{label}</span>
      <Mono style={{ fontSize: 13 }}>{value}</Mono>
    </div>
  )
}

// ─── Color Wheel ───────────────────────────────────────────────────────
function ColorWheel({ hue, sat, val, size = 128, onChange }: { hue: number; sat: number; val: number; size?: number; onChange: (h: number, s: number, v: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const W = size, R = W / 2

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(W, W)
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - R, dy = y - R, dist = Math.sqrt(dx * dx + dy * dy)
        const i = (y * W + x) * 4
        if (dist > R) { img.data[i + 3] = 0; continue }
        const a = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360
        const s = (dist / R) * 100
        const { r, g, b } = hsvToRgb(a, s, 100)
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [])

  const handle = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = ref.current; if (!c) return
    const rect = c.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    const dx = x - R, dy = y - R, dist = Math.min(Math.sqrt(dx * dx + dy * dy), R)
    const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360
    const s = Math.round((dist / R) * 100)
    onChange(h, s, val)
  }, [val, onChange])

  const cx = R + (sat / 100) * R * Math.cos((hue - 90) * Math.PI / 180)
  const cy = R + (sat / 100) * R * Math.sin((hue - 90) * Math.PI / 180)

  return (
    <div style={{ position: 'relative', width: W, height: W, flexShrink: 0 }}>
      <canvas ref={ref} width={W} height={W} onClick={handle}
        style={{ width: W, height: W, borderRadius: '50%', cursor: 'crosshair', display: 'block' }} />
      <div style={{
        position: 'absolute', left: cx - 5, top: cy - 5, width: 10, height: 10, borderRadius: '50%',
        border: '2px solid #fff', pointerEvents: 'none', boxShadow: '0 0 3px rgba(0,0,0,0.6)',
      }} />
    </div>
  )
}

// ─── Value/Brightness Slider ────────────────────────────────────────────
function ValSlider({ val, height = 128, onChange }: { val: number; height?: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const update = useCallback((clientY: number) => {
    const el = ref.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const pct = 1 - clamp((clientY - rect.top) / rect.height, 0, 1)
    onChange(Math.round(pct * 100))
  }, [onChange])

  useEffect(() => {
    if (!dragging) return
    const m = (e: MouseEvent) => update(e.clientY)
    const u = () => setDragging(false)
    window.addEventListener('mousemove', m); window.addEventListener('mouseup', u)
    return () => { window.removeEventListener('mousemove', m); window.removeEventListener('mouseup', u) }
  }, [dragging, update])

  return (
    <div ref={ref} onMouseDown={e => { setDragging(true); update(e.clientY) }}
      style={{ width: 18, height, borderRadius: 9, background: 'linear-gradient(to top, #000, #fff)', cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
      <div style={{
        position: 'absolute', left: -2, right: -2, height: 4, top: `${100 - val}%`, marginTop: -2,
        background: '#fff', borderRadius: 2, pointerEvents: 'none',
      }} />
    </div>
  )
}

// ─── Numeric Inputs ────────────────────────────────────────────────────
function NumInput({ label, val, min, max, step, onChange }: { label: string; val: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <span style={{ fontSize: 9, color: M, fontWeight: 600 }}>{label}</span>
      <input type="number" min={min} max={max} step={step} value={val}
        onChange={e => onChange(clamp(Number(e.target.value) || 0, min, max))}
        style={{
          width: 48, padding: '4px 6px', borderRadius: 5, border: `1px solid ${B}`,
          background: P2, color: T, fontSize: 12, fontFamily: "'JetBrains Mono',monospace",
          textAlign: 'center', outline: 'none',
        }} />
    </div>
  )
}

// ─── Keyboard Diagram ─────────────────────────────────────────────────
type K = [string, number, number?]
const KB: K[][] = [
  [['ESC', 0, 1.5], ['F1', 0], ['F2', 0], ['F3', 0], ['F4', 0], ['F5', 1], ['F6', 1], ['F7', 1], ['F8', 1], ['F9', 2], ['F10', 2], ['F11', 2], ['F12', 2], ['Del', 3, 2]],
  [['~', 0], ['1', 0], ['2', 0], ['3', 0], ['4', 0], ['5', 0], ['6', 1], ['7', 1], ['8', 1], ['9', 2], ['0', 2], ['-', 2], ['=', 2], ['\u232b', 3, 2]],
  [['Tab', 0, 1.5], ['Q', 0], ['W', 0], ['E', 0], ['R', 0], ['T', 0], ['Y', 1], ['U', 1], ['I', 1], ['O', 2], ['P', 2], ['[', 2], [']', 2], ['\\', 2, 1.5]],
  [['Caps', 0, 1.75], ['A', 0], ['S', 0], ['D', 0], ['F', 0], ['G', 1], ['H', 1], ['J', 1], ['K', 2], ['L', 2], [';', 2], ["'", 2], ['\u23ce', 3, 2.25]],
  [['\u21e7', 0, 2.25], ['Z', 0], ['X', 0], ['C', 0], ['V', 0], ['B', 1], ['N', 1], ['M', 1], [',', 2], ['.', 2], ['/', 2], ['\u21e7', 3, 2.75]],
  [['Ctrl', 0, 1.25], ['\u229e', 0, 1.25], ['Alt', 0, 1.25], ['', 1, 5.75], ['Alt', 2, 1.25], ['Fn', 2, 1.25], ['Ctrl', 3, 1.25], ['\u2190', 3], ['\u2193', 3], ['\u2191', 3], ['\u2192', 3]],
]
const KU = 26, KG = 3, KRH = 22

function hex2rgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function KeyboardDiagram({ zoneColors, activeZones, onToggleZone, effect, speed }: {
  zoneColors: string[]; activeZones: Set<number>; onToggleZone: (z: number, multi: boolean) => void; effect: RgbEffect; speed: number
}) {
  const [tick, setTick] = useState(0)
  const animRef = useRef<number | null>(null)
  const startRef = useRef(Date.now())

  useEffect(() => {
    if (effect === 'static' || effect === 'zonal_static') { setTick(0); return }
    const period = Math.max(200, 1600 - speed * 280)
    const loop = () => {
      const elapsed = (Date.now() - startRef.current) % period
      setTick(elapsed / period)
      animRef.current = requestAnimationFrame(loop)
    }
    startRef.current = Date.now()
    animRef.current = requestAnimationFrame(loop)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [effect, speed])

  const zoneAnim = (zone: number) => {
    if (effect === 'static' || effect === 'zonal_static') return { bg: hex2rgba(zoneColors[zone], zoneColors[zone] === '#000000' ? 0.06 : 0.24), border: hex2rgba(zoneColors[zone], zoneColors[zone] === '#000000' ? 0.15 : 0.55) }
    const c = zoneColors[zone]
    if (effect === 'breathe') {
      const op = 0.15 + 0.6 * Math.abs(Math.sin(tick * Math.PI * 2))
      return { bg: hex2rgba(c, op), border: hex2rgba(c, op + 0.15) }
    }
    if (effect === 'neon') {
      const h = (tick * 360 * 2) % 360
      const { r, g, b } = hsvToRgb(h, 80, 90)
      const nc = rgbToHex(r, g, b)
      return { bg: hex2rgba(nc, 0.2), border: hex2rgba(nc, 0.5) }
    }
    if (effect === 'wave' || effect === 'shifting') {
      const offset = zone / 4
      const phase = (tick + offset) % 1
      const fade = 0.15 + 0.6 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2))
      return { bg: hex2rgba(c, fade), border: hex2rgba(c, fade + 0.15) }
    }
    if (effect === 'zoom') {
      const dist = Math.abs(zone - 1.5) / 1.5
      const phase = (tick + dist * 0.5) % 1
      const fade = 0.15 + 0.6 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2))
      return { bg: hex2rgba(c, fade), border: hex2rgba(c, fade + 0.15) }
    }
    return { bg: hex2rgba(c, 0.24), border: hex2rgba(c, 0.55) }
  }

  return (
    <div style={{ background: P2, borderRadius: 10, padding: '10px 14px', userSelect: 'none', display: 'inline-block' }}>
      {KB.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: KG, marginBottom: ri < KB.length - 1 ? KG : 0 }}>
          {row.map(([label, zone, wm = 1], ki) => {
            const w = wm * KU + (wm - 1) * KG
            const active = activeZones.has(zone)
            const { bg, border } = zoneAnim(zone)
            return (
              <div key={ki} onClick={e => onToggleZone(zone, e.shiftKey || e.ctrlKey || e.metaKey)} style={{
                width: w, height: KRH, flexShrink: 0,
                background: active ? bg : hex2rgba(zoneColors[zone], 0.09),
                border: `1px solid ${active ? border : B}`,
                borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: effect === 'static' || effect === 'zonal_static' ? 'background 0.12s, border-color 0.12s' : 'none',
                fontSize: label.length > 3 ? 7 : label.length > 2 ? 8 : 9,
                color: active ? zoneColors[zone] : M,
                fontFamily: "'Inter',sans-serif", fontWeight: 500,
                overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                {label}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────
const DashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="1" y="1" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
    <rect x="8.5" y="1" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
    <rect x="1" y="8.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
    <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)
const FanIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
    <path d="M7.5 5.8C7.5 3.5 8.9 1.5 10.2 1.5C10.2 3.9 8.8 5.8 7.5 5.8Z" fill="currentColor" opacity="0.85" />
    <path d="M9.2 7.5C11.5 7.5 13.5 6.1 13.5 4.8C11.1 4.8 9.2 6.2 9.2 7.5Z" fill="currentColor" opacity="0.7" />
    <path d="M7.5 9.2C7.5 11.5 6.1 13.5 4.8 13.5C4.8 11.1 6.2 9.2 7.5 9.2Z" fill="currentColor" opacity="0.85" />
    <path d="M5.8 7.5C3.5 7.5 1.5 8.9 1.5 10.2C3.9 10.2 5.8 8.8 5.8 7.5Z" fill="currentColor" opacity="0.7" />
  </svg>
)
const LightingIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="1" y="4" width="13" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <rect x="2.75" y="6" width="1.5" height="1.5" rx="0.4" fill="currentColor" opacity="0.75" />
    <rect x="5.25" y="6" width="1.5" height="1.5" rx="0.4" fill="currentColor" opacity="0.75" />
    <rect x="7.75" y="6" width="1.5" height="1.5" rx="0.4" fill="currentColor" opacity="0.75" />
    <rect x="10.25" y="6" width="1.5" height="1.5" rx="0.4" fill="currentColor" opacity="0.75" />
    <rect x="2.75" y="8.5" width="1.5" height="1.5" rx="0.4" fill="currentColor" opacity="0.75" />
    <rect x="5" y="8.5" width="5" height="1.5" rx="0.4" fill="currentColor" opacity="0.75" />
    <rect x="10.75" y="8.5" width="1.25" height="1.5" rx="0.4" fill="currentColor" opacity="0.75" />
  </svg>
)
const DisplayIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <rect x="1" y="1.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5 13H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M7.5 10.5V13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

// ─── Status Bar ────────────────────────────────────────────────────────
function StatusBar({ live, mode }: { live: ReturnType<typeof useLive>; mode: string }) {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }))
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })), 10000)
    return () => clearInterval(id)
  }, [])

  const stats = [
    { label: 'CPU', value: `${Math.round(live.cpuTemp)}\u00b0C` },
    { label: 'GPU', value: `${Math.round(live.gpuTemp)}\u00b0C` },
    { label: 'FAN', value: `${live.cpuFan.toLocaleString()} / ${live.gpuFan.toLocaleString()}` },
    { label: 'PWR', value: `${Math.round(live.watt)} W` },
  ]

  return (
    <div style={{
      height: 34, display: 'flex', alignItems: 'center', flexShrink: 0,
      background: '#101215', borderBottom: `1px solid ${B}`, padding: '0 20px', gap: 18,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: T, textTransform: 'uppercase' }}>PreySense</span>
      <div style={{ width: 1, height: 14, background: B }} />
      {stats.map(({ label, value }) => (
        <div key={label} style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
          <span style={{ fontSize: 9, color: M, fontWeight: 600, letterSpacing: '0.08em' }}>{label}</span>
          <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: A }}>{value}</span>
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <div style={{ padding: '2px 9px', background: hex2rgba(A, 0.1), border: `1px solid ${hex2rgba(A, 0.28)}`, borderRadius: 4, fontSize: 10, color: A, fontWeight: 500, letterSpacing: '0.05em' }}>
        {mode}
      </div>
      <div style={{ width: 1, height: 14, background: B }} />
      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: M }}>{time}</span>
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────
const NAV: { id: Screen; label: string; Icon: React.FC }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: DashIcon },
  { id: 'fan', label: 'Fan Control', Icon: FanIcon },
  { id: 'lighting', label: 'Lighting', Icon: LightingIcon },
  { id: 'display', label: 'Display', Icon: DisplayIcon },
]

function Sidebar({ screen, onNav, deviceName, serial }: { screen: Screen; onNav: (s: Screen) => void; deviceName: string; serial: string }) {
  return (
    <div style={{ width: 170, flexShrink: 0, background: '#101215', borderRight: `1px solid ${B}`, display: 'flex', flexDirection: 'column', padding: '20px 0' }}>
      <div style={{ padding: '0 16px 20px', borderBottom: `1px solid ${B}`, marginBottom: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: M, marginBottom: 2 }}>{deviceName}</div>
        <div style={{ fontSize: 10, color: M, opacity: 0.6 }}>{serial}</div>
      </div>
      {NAV.map(({ id, label, Icon }) => {
        const active = screen === id
        return (
          <button key={id} onClick={() => onNav(id)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', margin: '1px 8px',
            borderRadius: 7, border: 'none', background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
            color: active ? T : M, cursor: 'pointer', transition: 'background 0.12s, color 0.12s', textAlign: 'left',
          }}>
            <div style={{ color: active ? A : M, transition: 'color 0.12s', flexShrink: 0 }}><Icon /></div>
            <span style={{ fontSize: 12, fontWeight: active ? 500 : 400, fontFamily: "'Inter',sans-serif", letterSpacing: '0.01em' }}>{label}</span>
            {active && <div style={{ marginLeft: 'auto', width: 3, height: 3, borderRadius: '50%', background: A }} />}
          </button>
        )
      })}
    </div>
  )
}

// ─── Dashboard Screen ─────────────────────────────────────────────────
const PERF_DESCS: Record<PerfMode, string> = {
  quiet: 'Fans at low speed, reduced CPU/GPU boost. Best for quiet environments and battery life.',
  balanced: 'Default thermal profile. Boost applied as workload demands. Fans ramp automatically.',
  performance: 'Elevated fan curve with higher sustained clock targets. Requires AC power recommended.',
  turbo: 'Maximum fan speed and unlimited boost. Significant acoustics. AC power required.',
}

function DashboardScreen({ live, mode, onMode, onNav }: {
  live: ReturnType<typeof useLive>; mode: PerfMode; onMode: (m: PerfMode) => void; onNav: (s: Screen) => void
}) {
  const handleModeChange = (m: PerfMode) => {
    onMode(m)
    sendCmd('SetPowerMode', { mode: PERF_MAP[m] })
  }

  return (
    <div style={{ padding: '28px 28px' }}>
      <PageHeader title="System Overview" subtitle="Acer Predator Helios Neo 16" />
      <Card style={{ marginBottom: 12 }}>
        <Label>Performance Mode</Label>
        <SegCtrl opts={[{ v: 'quiet' as PerfMode, l: 'Quiet' }, { v: 'balanced' as PerfMode, l: 'Balanced' }, { v: 'performance' as PerfMode, l: 'Performance' }, { v: 'turbo' as PerfMode, l: 'Turbo' }]} val={mode} onChange={handleModeChange} />
        <p style={{ margin: '12px 0 0', fontSize: 12, color: M, lineHeight: 1.65 }}>{PERF_DESCS[mode]}</p>
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Card><Label>Thermal</Label><StatLine label="CPU Temperature" value={`${live.cpuTemp.toFixed(1)} \u00b0C`} /><StatLine label="GPU Temperature" value={`${live.gpuTemp.toFixed(1)} \u00b0C`} /></Card>
        <Card><Label>Fan Speed</Label><StatLine label="CPU Fan" value={`${live.cpuFan.toLocaleString()} rpm`} /><StatLine label="GPU Fan" value={`${live.gpuFan.toLocaleString()} rpm`} /></Card>
        <Card><Label>Power</Label><StatLine label="System Draw" value={`${live.watt.toFixed(1)} W`} /><StatLine label="Battery" value={`${live.batteryPercent} %`} /><StatLine label="AC Adapter" value={live.onAc ? 'Connected' : 'Disconnected'} /></Card>
        <Card><Label>Manage</Label>
          {([['Fan Control', 'fan' as Screen], ['Keyboard Lighting', 'lighting' as Screen], ['Display Settings', 'display' as Screen]] as [string, Screen][]).map(([l, s]) => (
            <NavRow key={s} label={l} onClick={() => onNav(s)} />
          ))}
        </Card>
      </div>
    </div>
  )
}

function NavRow({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '7px 0',
      background: 'none', border: 'none', borderBottom: `1px solid ${B}`, color: hover ? T : M,
      fontSize: 12, fontFamily: "'Inter',sans-serif", cursor: 'pointer', transition: 'color 0.12s',
    }}>
      {label}<span style={{ fontSize: 10, opacity: hover ? 0.8 : 0.4, transition: 'opacity 0.12s' }}>\u2192</span>
    </button>
  )
}

// ─── Lighting Screen ──────────────────────────────────────────────────
const EFFECT_OPTS: { v: RgbEffect; l: string }[] = [
  { v: 'static', l: 'Static' }, { v: 'zonal_static', l: 'Zonal Static' }, { v: 'breathe', l: 'Breathe' }, { v: 'neon', l: 'Neon' },
  { v: 'wave', l: 'Wave' }, { v: 'shifting', l: 'Shifting' }, { v: 'zoom', l: 'Zoom' },
]

const NEEDS_SPEED: Partial<Record<RgbEffect, boolean>> = { static: false, zonal_static: false }
const NEEDS_DIR: Partial<Record<RgbEffect, boolean>> = { wave: true }

const WHEEL_SIZE = 128

function LightingScreen() {
  const [effect, setEffect] = useState<RgbEffect>('static')
  const [activeZones, setActiveZones] = useState<Set<number>>(new Set([0, 1, 2, 3]))
  const [zoneColors, setZoneColors] = useState<string[]>(['#5fa8b0', '#5fa8b0', '#5fa8b0', '#5fa8b0'])
  const [brightness, setBrightness] = useState(80)
  const [speed, setSpeed] = useState(3)
  const [direction, setDirection] = useState<WaveDir>('ltr')
  const [hue, setHue] = useState(185)
  const [sat, setSat] = useState(72)
  const [val, setVal] = useState(90)
  const rgbTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initHex = rgbToHex(0, 180, 176)
  const [hexInput, setHexInput] = useState(initHex)

  const isZonal = effect === 'zonal_static'
  const isUniform = effect === 'static'
  const isAnimated = !isZonal && !isUniform
  const activeArr = [...activeZones]
  const activeColor = zoneColors[activeArr[0]] || '#5fa8b0'
  const curRgb = hsvToRgb(hue, sat, val)

  useEffect(() => {
    const hex = rgbToHex(curRgb.r, curRgb.g, curRgb.b)
    setHexInput(hex)
    if (isUniform) {
      setZoneColors([hex, hex, hex, hex])
    }
  }, [curRgb.r, curRgb.g, curRgb.b, isUniform])

  const applyColorToZones = (color: string, zones?: Set<number>) => {
    const target = zones ?? activeZones
    setZoneColors(prev => { const n = [...prev]; target.forEach(z => { n[z] = color }); return n })
  }

  const syncColor = (h: number, s: number, v: number, zones?: Set<number>) => {
    setHue(h); setSat(s); setVal(v)
    const { r, g, b } = hsvToRgb(h, s, v)
    applyColorToZones(rgbToHex(r, g, b), zones)
  }

  const sendPending = useCallback(() => {
    if (rgbTimer.current) clearTimeout(rgbTimer.current)
    rgbTimer.current = setTimeout(() => {
      if (isZonal) {
        zoneColors.forEach((c, i) => {
          const { r, g, b } = hexToRgb(c)
          sendCmd('SetRgbZone', { zone: i, r, g, b })
        })
      } else if (isUniform) {
        const { r, g, b } = hsvToRgb(hue, sat, val)
        sendCmd('SetRgbMode', { mode: 0, r, g, b, brightness: Math.round(brightness / 10), speed: 3, direction: 0 })
        for (let i = 0; i < 4; i++) sendCmd('SetRgbZone', { zone: i, r, g, b })
      } else {
        const hwDir = direction === 'rtl' ? 1 : 0
        sendCmd('SetRgbMode', { mode: RGB_MODE[effect], r: curRgb.r, g: curRgb.g, b: curRgb.b, brightness: Math.round(brightness / 10), speed, direction: hwDir })
      }
    }, 200)
  }, [effect, hue, sat, val, curRgb, brightness, speed, direction, zoneColors, isZonal, isUniform])

  useEffect(() => { sendPending() }, [effect, hue, sat, val, curRgb, brightness, speed, direction, zoneColors, sendPending, isZonal, isUniform])

  const handleEffectChange = (e: RgbEffect) => {
    setEffect(e)
    if (e === 'static') { setActiveZones(new Set([0, 1, 2, 3])); setZoneColors(['#5fa8b0', '#5fa8b0', '#5fa8b0', '#5fa8b0']) }
    if (e === 'zonal_static') setActiveZones(new Set([0]))
  }

  const toggleZone = (zone: number, multi: boolean) => {
    setActiveZones(prev => {
      const next = new Set(multi ? prev : [])
      if (next.has(zone)) next.delete(zone); else next.add(zone)
      if (next.size === 0) next.add(zone)
      return next
    })
  }

  const handleHexChange = (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { setHexInput(hex); return }
    const { r, g, b } = hexToRgb(hex)
    syncColor(...Object.values(rgbToHsv(r, g, b)))
  }

  const handleRgbField = (label: 'r' | 'g' | 'b', value: number) => {
    const rgb = { r: curRgb.r, g: curRgb.g, b: curRgb.b, [label]: clamp(value, 0, 255) }
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b)
    syncColor(hsv.h, hsv.s, hsv.v)
  }

  const zoneLabelStyle = (active: boolean, color: string) => ({
    display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 6, border: '1px solid',
    borderColor: active ? hex2rgba(A, 0.55) : B,
    background: active ? hex2rgba(A, 0.1) : 'transparent',
    color: active ? A : M, fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 500,
    cursor: 'pointer', transition: 'all 0.12s',
  })

  const subtitle = isZonal ? 'Per-zone color, multi-select with Shift+Click'
    : isUniform ? 'Single color across all zones'
    : 'Animated effect with global color'

  return (
    <div style={{ padding: '28px 28px' }}>
      <PageHeader title="Keyboard Lighting" subtitle={subtitle} />
      <div style={{ marginBottom: 20 }}>
        <SegCtrl opts={EFFECT_OPTS} val={effect} onChange={handleEffectChange} />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          <Card style={{ marginBottom: 12 }}>
            <div style={{ overflowX: 'auto' }}>
              <KeyboardDiagram zoneColors={isZonal ? zoneColors : ['#2a2a2a', '#2a2a2a', '#2a2a2a', '#2a2a2a']} activeZones={isZonal ? activeZones : new Set()} onToggleZone={isZonal ? toggleZone : () => {}} effect={isZonal ? effect : 'static'} speed={speed} />
            </div>
          </Card>

          {isZonal && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ZONE_LABELS.map((label, i) => {
                const active = isZonal ? activeZones.has(i) : true
                return (
                  <button key={i} onClick={e => isZonal && toggleZone(i, e.shiftKey || e.ctrlKey || e.metaKey)} style={zoneLabelStyle(active, zoneColors[i])}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: zoneColors[i], flexShrink: 0 }} />
                    {label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 280px', minWidth: 260 }}>
          <Card>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
              <ColorWheel hue={hue} sat={sat} val={val} size={WHEEL_SIZE} onChange={(h, s, v) => syncColor(h, s, v)} />
              <ValSlider val={val} height={WHEEL_SIZE} onChange={v => syncColor(hue, sat, v)} />
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-end' }}>
              <NumInput label="R" val={curRgb.r} min={0} max={255} step={1} onChange={v => handleRgbField('r', v)} />
              <NumInput label="G" val={curRgb.g} min={0} max={255} step={1} onChange={v => handleRgbField('g', v)} />
              <NumInput label="B" val={curRgb.b} min={0} max={255} step={1} onChange={v => handleRgbField('b', v)} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 9, color: M, fontWeight: 600 }}>HEX</span>
                <input value={hexInput} onChange={e => handleHexChange(e.target.value)}
                  style={{
                    width: 68, padding: '4px 6px', borderRadius: 5, border: `1px solid ${B}`,
                    background: P2, color: T, fontSize: 12, fontFamily: "'JetBrains Mono',monospace",
                    textAlign: 'center', outline: 'none',
                  }} />
              </div>
            </div>

            <div style={{ marginBottom: 16, borderTop: `1px solid ${B}`, paddingTop: 12 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.07em', textTransform: 'uppercase', color: M, fontWeight: 500, marginBottom: 8 }}>Quick picks</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SWATCHES.map(s => {
                  const refColor = isZonal ? zoneColors[activeArr[0]] : hexInput
                  return (
                    <button key={s.l} onClick={() => applyColorToZones(s.c)} style={{
                      width: 26, height: 26, borderRadius: 5, background: s.c, border: '2px solid',
                      borderColor: refColor === s.c ? T : `${s.c}44`,
                      cursor: 'pointer', transition: 'border-color 0.1s', padding: 0, flexShrink: 0,
                    }} title={s.l} />
                  )
                })}
              </div>
            </div>

            <div style={{ marginBottom: isAnimated ? 16 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: M }}>Brightness</span>
                <Mono style={{ fontSize: 11 }}>{brightness}%</Mono>
              </div>
              <input type="range" min="0" max="100" value={brightness} onChange={e => setBrightness(Number(e.target.value))} />
            </div>

            {isAnimated && NEEDS_SPEED[effect] !== false && (
              <div style={{ marginBottom: NEEDS_DIR[effect] ? 16 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: M }}>Speed</span>
                  <Mono style={{ fontSize: 11 }}>{speed}/5</Mono>
                </div>
                <input type="range" min="1" max="5" value={speed} onChange={e => setSpeed(Number(e.target.value))} />
              </div>
            )}

            {isAnimated && NEEDS_DIR[effect] && (
              <div style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 11, color: M, marginBottom: 8 }}>Direction</div>
                <SegCtrl opts={[{ v: 'ltr' as WaveDir, l: 'Left \u2192 Right' }, { v: 'rtl' as WaveDir, l: 'Right \u2192 Left' }]} val={direction} onChange={setDirection} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Fan Screen ───────────────────────────────────────────────────────
function FanScreen({ live }: { live: ReturnType<typeof useLive> }) {
  const [mode, setMode] = useState<FanMode>('auto')
  const [cpuPct, setCpuPct] = useState(50)
  const [gpuPct, setGpuPct] = useState(50)
  const [linked, setLinked] = useState(true)
  const fanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // SetFanControl API takes percentage (0–100), not RPM.
  // Fan RPM is read-only via WMI sensors. The slider maps UI percentage to hardware percentage directly.
  const sendFan = (m: FanMode, cpu?: number, gpu?: number) => {
    sendCmd('SetFanControl', { mode: FAN_MAP[m], cpuSpeed: cpu ?? cpuPct, gpuSpeed: gpu ?? gpuPct })
  }

  const handleModeChange = (m: FanMode) => {
    setMode(m)
    if (m === 'custom') sendFan(m)
    else sendFan(m)
  }

  const handleCpuChange = (pct: number) => {
    setCpuPct(pct)
    const g = linked ? pct : gpuPct
    if (linked) setGpuPct(pct)
    if (fanTimer.current) clearTimeout(fanTimer.current)
    fanTimer.current = setTimeout(() => sendFan('custom', pct, g), 300)
  }

  const handleGpuChange = (pct: number) => {
    setGpuPct(pct)
    if (fanTimer.current) clearTimeout(fanTimer.current)
    fanTimer.current = setTimeout(() => sendFan('custom', cpuPct, pct), 300)
  }

  return (
    <div style={{ padding: '28px 28px' }}>
      <PageHeader title="Fan Control" subtitle="Adjust cooling speed and behavior" />
      <div style={{ marginBottom: 20 }}>
        <SegCtrl opts={[{ v: 'auto' as FanMode, l: 'Auto' }, { v: 'max' as FanMode, l: 'Max' }, { v: 'custom' as FanMode, l: 'Custom' }]} val={mode} onChange={handleModeChange} />
      </div>

      {mode === 'auto' && (
        <Card>
          <Label>Auto Mode</Label>
          <p style={{ margin: 0, fontSize: 12, color: M, lineHeight: 1.65 }}>
            Fan speed is managed automatically based on real-time thermal load.<br />
            Currently running at <Mono>{live.cpuFan.toLocaleString()}</Mono> / <Mono>{live.gpuFan.toLocaleString()}</Mono> rpm.
          </p>
        </Card>
      )}

      {mode === 'max' && (
        <Card>
          <Label>Max Mode</Label>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: M, lineHeight: 1.65 }}>
            All fans run at maximum speed. Recommended for sustained heavy loads.<br />
            Current: <Mono>{live.cpuFan.toLocaleString()}</Mono> / <Mono>{live.gpuFan.toLocaleString()}</Mono> rpm.
          </p>
          <div style={{ fontSize: 11, color: 'rgba(210,140,80,0.85)', paddingTop: 10, borderTop: `1px solid ${B}` }}>
            Acoustics will be significant. For sustained use, ensure adequate ventilation.
          </div>
        </Card>
      )}

      {mode === 'custom' && (
        <Card>
          <Label>Custom Fan Speed</Label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: M }}>Link CPU/GPU</span>
            <button onClick={() => setLinked(!linked)} style={{
              width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
              background: linked ? A : P2, transition: 'background 0.15s',
            }}>
              <div style={{
                position: 'absolute', top: 2, width: 16, height: 16, borderRadius: '50%', background: '#fff',
                left: linked ? 18 : 2, transition: 'left 0.15s',
              }} />
            </button>
          </div>

          <FanSlider label="CPU Fan" pct={cpuPct} liveRpm={live.cpuFan} onChange={handleCpuChange} />
          <div style={{ height: 16 }} />
          <FanSlider label="GPU Fan" pct={gpuPct} liveRpm={live.gpuFan} onChange={handleGpuChange} />
        </Card>
      )}
    </div>
  )
}

function FanSlider({ label, pct, liveRpm, onChange }: { label: string; pct: number; liveRpm: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: T, fontWeight: 500 }}>{label}</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, color: M }}>Target: <Mono style={{ fontSize: 12 }}>{pct}%</Mono></span>
          <span style={{ fontSize: 11, color: M }}>Actual: <Mono style={{ fontSize: 12, color: '#8bc89a' }}>{liveRpm.toLocaleString()} rpm</Mono></span>
        </div>
      </div>
      <input type="range" min="0" max="100" step="5" value={pct} onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 9, color: M, opacity: 0.6 }}>0%</span>
        <span style={{ fontSize: 9, color: M, opacity: 0.6 }}>100%</span>
      </div>
    </div>
  )
}

// ─── Display Screen ────────────────────────────────────────────────────
const PROFILE_DESCS: Record<DisplayProfile, string> = {
  native: 'Full panel gamut (DCI-P3 87%). Vivid color reproduction for gaming and media.',
  srgb: 'Restricted to sRGB color space. More accurate for web content and productivity.',
  custom: 'Manually calibrated profile applied. White point and gamma adjusted to saved settings.',
}

function DisplayScreen() {
  const [profile, setProfile] = useState<DisplayProfile>('native')
  const [refresh, setRefresh] = useState(165)
  const [brightness, setBrightness] = useState(72)

  const refreshDescs: Record<number, string> = {
    60: 'Power-saving. Reduces display energy consumption, extends battery.',
    144: 'Balanced. Smooth visuals with moderate power draw.',
    165: 'Maximum rate. Lowest motion blur for fast-paced content.',
  }

  return (
    <div style={{ padding: '28px 28px' }}>
      <PageHeader title="Display" subtitle="QHD+ 2560 \u00d7 1600 \u00b7 IPS \u00b7 165 Hz \u00b7 3 ms \u00b7 DCI-P3 87%" />
      <Card style={{ marginBottom: 12 }}>
        <Label>Color Profile</Label>
        <SegCtrl opts={[{ v: 'native' as DisplayProfile, l: 'Native' }, { v: 'srgb' as DisplayProfile, l: 'sRGB' }, { v: 'custom' as DisplayProfile, l: 'Custom' }]} val={profile} onChange={setProfile} />
        <p style={{ margin: '12px 0 0', fontSize: 12, color: M, lineHeight: 1.65 }}>{PROFILE_DESCS[profile]}</p>
      </Card>
      <Card style={{ marginBottom: 12 }}>
        <Label>Refresh Rate</Label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[60, 144, 165].map(r => (
            <button key={r} onClick={() => setRefresh(r)} style={{
              padding: '7px 18px', borderRadius: 6, border: '1px solid',
              borderColor: refresh === r ? hex2rgba(A, 0.55) : B,
              background: refresh === r ? hex2rgba(A, 0.1) : 'transparent',
              color: refresh === r ? A : M, fontSize: 13, fontFamily: "'JetBrains Mono',monospace", fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.12s',
            }}>{r} Hz</button>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 12, color: M }}>{refreshDescs[refresh]}</p>
      </Card>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <Label>Backlight</Label><Mono style={{ fontSize: 12 }}>{brightness}%</Mono>
        </div>
        <input type="range" min="0" max="100" value={brightness} onChange={e => setBrightness(Number(e.target.value))} />
      </Card>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────
const PERF_LABELS: Record<PerfMode, string> = { quiet: 'Quiet', balanced: 'Balanced', performance: 'Performance', turbo: 'Turbo' }

export default function App() {
  const live = useLive()
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [perfMode, setPerfMode] = useState<PerfMode>('balanced')
  const [opacity, setOpacity] = useState(1)
  const [deviceName, setDeviceName] = useState('Helios Neo 16')
  const [serial, setSerial] = useState('\u2014')

  useEffect(() => {
    window.preySense.getDeviceInfo().then(info => {
      setDeviceName(info.name)
      setSerial(info.serial)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const unsub = window.preySense.onEvent(payload => {
      if (payload.name === 'modeChanged') {
        const modeVal = payload.data.mode
        const perf = modeVal === 0 ? 'quiet' : modeVal === 4 ? 'performance' : modeVal === 5 ? 'turbo' : 'balanced'
        setPerfMode(perf)
      }
    })
    return unsub
  }, [])

  const navigate = (s: Screen) => {
    if (s === screen) return
    setOpacity(0)
    setTimeout(() => { setScreen(s); setOpacity(1) }, 150)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#15171b', color: T, fontFamily: "'Inter',sans-serif", overflow: 'hidden' }}>
      <StatusBar live={live} mode={PERF_LABELS[perfMode]} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar screen={screen} onNav={navigate} deviceName={deviceName} serial={serial} />
        <main style={{ flex: 1, overflowY: 'auto', opacity, transition: 'opacity 0.15s ease' }}>
          {screen === 'dashboard' && <DashboardScreen live={live} mode={perfMode} onMode={setPerfMode} onNav={navigate} />}
          {screen === 'fan' && <FanScreen live={live} />}
          {screen === 'lighting' && <LightingScreen />}
          {screen === 'display' && <DisplayScreen />}
        </main>
      </div>
    </div>
  )
}
