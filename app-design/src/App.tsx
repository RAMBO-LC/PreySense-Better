import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────
type Screen = 'dashboard' | 'fan' | 'lighting' | 'display'
type FanMode = 'auto' | 'max' | 'custom'
type DisplayProfile = 'native' | 'srgb' | 'custom'
type PerfMode = 'quiet' | 'balanced' | 'performance' | 'turbo'
type LightEffect = 'static' | 'breathing' | 'off'
interface FanPoint { temp: number; speed: number }

// ─── Constants ─────────────────────────────────────────────────────────
const A = '#5fa8b0'   // accent
const T = '#e4e6ea'   // text
const M = '#8b909a'   // muted
const P = '#1c1f24'   // panel
const P2 = '#22262d'  // panel2
const B = 'rgba(255,255,255,0.08)' // border

const DEF_CPU: FanPoint[] = [
  { temp: 0, speed: 0 }, { temp: 40, speed: 20 }, { temp: 60, speed: 45 },
  { temp: 75, speed: 68 }, { temp: 85, speed: 85 }, { temp: 100, speed: 100 },
]
const DEF_GPU: FanPoint[] = [
  { temp: 0, speed: 0 }, { temp: 45, speed: 25 }, { temp: 65, speed: 50 },
  { temp: 78, speed: 72 }, { temp: 88, speed: 90 }, { temp: 100, speed: 100 },
]

const SWATCHES = [
  '#ffffff', '#b0bac8', '#ff6b6b', '#ff9f43',
  '#f9ca24', '#7cb67e', '#5fa8b0', '#74b9ff',
  '#a29bfe', '#e056a0', '#fd79a8', '#2a2f38',
]
const ZONE_LABELS = ['Zone 1 · Left', 'Zone 2 · Ctr-L', 'Zone 3 · Ctr-R', 'Zone 4 · Right']
const ZONE_DEF = ['#5fa8b0', '#7ca8cc', '#cc9a5f', '#a07bb0']

// ─── Utility ───────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function hslToHex(h: number, s: number, l: number) {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function hex2rgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── Live Data ─────────────────────────────────────────────────────────
function useLive() {
  const [d, setD] = useState({ cpuTemp: 61.4, gpuTemp: 54.2, cpuFan: 2340, gpuFan: 1820, watt: 44.8 })
  useEffect(() => {
    const id = setInterval(() => setD(p => ({
      cpuTemp: clamp(p.cpuTemp + (Math.random() - 0.5) * 2.5, 42, 92),
      gpuTemp: clamp(p.gpuTemp + (Math.random() - 0.5) * 2, 36, 86),
      cpuFan: Math.round(clamp(p.cpuFan + (Math.random() - 0.5) * 140, 1200, 5000)),
      gpuFan: Math.round(clamp(p.gpuFan + (Math.random() - 0.5) * 90, 1000, 4500)),
      watt: clamp(p.watt + (Math.random() - 0.5) * 3.5, 24, 92),
    })), 2500)
    return () => clearInterval(id)
  }, [])
  return d
}

// ─── Fan Curve Math ────────────────────────────────────────────────────
const PL = 40, PT = 18, PR = 14, PB = 34, SW = 420, SH = 200
const PW = SW - PL - PR, PH = SH - PT - PB
const tX = (t: number) => PL + (t / 100) * PW
const sY = (s: number) => PT + (1 - s / 100) * PH
const xT = (x: number) => clamp(((x - PL) / PW) * 100, 0, 100)
const yS = (y: number) => clamp((1 - (y - PT) / PH) * 100, 0, 100)

function makePath(pts: FanPoint[]) {
  const sv = pts.map(p => ({ x: tX(p.temp), y: sY(p.speed) }))
  if (sv.length < 2) return ''
  let d = `M ${sv[0].x} ${sv[0].y}`
  for (let i = 1; i < sv.length; i++) {
    const p0 = sv[Math.max(0, i - 2)], p1 = sv[i - 1], p2 = sv[i], p3 = sv[Math.min(sv.length - 1, i + 1)]
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

// ─── Fan Curve Editor ─────────────────────────────────────────────────
function FanCurveEditor({ label, points, currentTemp, onChange }: {
  label: string; points: FanPoint[]; currentTemp: number; onChange: (p: FanPoint[]) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<number | null>(null)

  const getPos = useCallback((e: PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (SW / r.width), y: (e.clientY - r.top) * (SH / r.height) }
  }, [])

  const onDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = i
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  const onMove = (e: React.PointerEvent) => {
    if (dragging.current === null) return
    const i = dragging.current
    const { x, y } = getPos(e.nativeEvent)
    const pts = [...points]
    const minT = i > 0 ? points[i - 1].temp + 2 : 0
    const maxT = i < points.length - 1 ? points[i + 1].temp - 2 : 100
    pts[i] = {
      temp: i === 0 ? 0 : i === points.length - 1 ? 100 : clamp(xT(x), minT, maxT),
      speed: Math.round(yS(y)),
    }
    onChange(pts)
  }

  const onUp = () => { dragging.current = null }
  const path = makePath(points)
  const cx = tX(currentTemp)

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: M, marginBottom: 8, fontWeight: 500 }}>
        {label}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${SW} ${SH}`}
        style={{ width: '100%', display: 'block', cursor: 'crosshair', borderRadius: 8 }}
        onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        <rect x="0" y="0" width={SW} height={SH} rx="8" fill={P2} />
        {[25, 50, 75].map(v => (
          <g key={v}>
            <line x1={tX(v)} y1={PT} x2={tX(v)} y2={PT + PH} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <line x1={PL} y1={sY(v)} x2={PL + PW} y2={sY(v)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          </g>
        ))}
        <rect x={PL} y={PT} width={PW} height={PH} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
        <line x1={cx} y1={PT} x2={cx} y2={PT + PH} stroke={`${A}44`} strokeWidth="1" strokeDasharray="4 3" />
        <text x={cx} y={PT - 5} textAnchor="middle" fill={`${A}99`} fontSize="9" fontFamily="'JetBrains Mono',monospace">
          {Math.round(currentTemp)}°C
        </text>
        <path d={path} fill="none" stroke={A} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={tX(p.temp)} cy={sY(p.speed)} r="5"
            fill={P2} stroke={A} strokeWidth="1.75"
            style={{ cursor: 'grab' }}
            onPointerDown={onDown(i)} />
        ))}
        {[0, 25, 50, 75, 100].map(v => (
          <text key={v} x={tX(v)} y={SH - 10} textAnchor="middle" fill={M} fontSize="9" fontFamily="'JetBrains Mono',monospace">{v}°</text>
        ))}
        {[0, 50, 100].map(v => (
          <text key={v} x={PL - 7} y={sY(v) + 3} textAnchor="end" fill={M} fontSize="9" fontFamily="'JetBrains Mono',monospace">{v}%</text>
        ))}
      </svg>
    </div>
  )
}

// ─── Keyboard Diagram ─────────────────────────────────────────────────
type K = [string, number, number?]
const KB: K[][] = [
  [['ESC', 0, 1.5], ['F1', 0], ['F2', 0], ['F3', 0], ['F4', 0], ['F5', 1], ['F6', 1], ['F7', 1], ['F8', 1], ['F9', 2], ['F10', 2], ['F11', 2], ['F12', 2], ['Del', 3, 2]],
  [['~', 0], ['1', 0], ['2', 0], ['3', 0], ['4', 0], ['5', 0], ['6', 1], ['7', 1], ['8', 1], ['9', 2], ['0', 2], ['-', 2], ['=', 2], ['⌫', 3, 2]],
  [['Tab', 0, 1.5], ['Q', 0], ['W', 0], ['E', 0], ['R', 0], ['T', 0], ['Y', 1], ['U', 1], ['I', 1], ['O', 2], ['P', 2], ['[', 2], [']', 2], ['\\', 2, 1.5]],
  [['Caps', 0, 1.75], ['A', 0], ['S', 0], ['D', 0], ['F', 0], ['G', 1], ['H', 1], ['J', 1], ['K', 2], ['L', 2], [';', 2], ["'", 2], ['↵', 3, 2.25]],
  [['⇧', 0, 2.25], ['Z', 0], ['X', 0], ['C', 0], ['V', 0], ['B', 1], ['N', 1], ['M', 1], [',', 2], ['.', 2], ['/', 2], ['⇧', 3, 2.75]],
  [['Ctrl', 0, 1.25], ['⊞', 0, 1.25], ['Alt', 0, 1.25], ['', 1, 5.75], ['Alt', 2, 1.25], ['Fn', 2, 1.25], ['Ctrl', 3, 1.25], ['←', 3], ['↓', 3], ['↑', 3], ['→', 3]],
]
const KU = 26, KG = 3, KRH = 22

function KeyboardDiagram({ activeZone, zoneColors, onSelect }: {
  activeZone: number; zoneColors: string[]; onSelect: (z: number) => void
}) {
  return (
    <div style={{ background: P2, borderRadius: 10, padding: '10px 14px', userSelect: 'none', display: 'inline-block' }}>
      {KB.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: KG, marginBottom: ri < KB.length - 1 ? KG : 0 }}>
          {row.map(([label, zone, wm = 1], ki) => {
            const w = wm * KU + (wm - 1) * KG
            const active = zone === activeZone
            const col = zoneColors[zone]
            return (
              <div key={ki} onClick={() => onSelect(zone)} style={{
                width: w, height: KRH, flexShrink: 0,
                background: active ? hex2rgba(col, 0.24) : hex2rgba(col, 0.09),
                border: `1px solid ${active ? hex2rgba(col, 0.55) : B}`,
                borderRadius: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.12s, border-color 0.12s',
                fontSize: label.length > 3 ? 7 : label.length > 2 ? 8 : 9,
                color: active ? col : M,
                fontFamily: "'Inter',sans-serif",
                fontWeight: 500,
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

// ─── UI Primitives ────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: P, borderRadius: 10, padding: '20px', border: `1px solid ${B}`, ...style }}>
      {children}
    </div>
  )
}

function SegCtrl<V extends string>({ opts, val, onChange }: {
  opts: { v: V; l: string }[]; val: V; onChange: (v: V) => void
}) {
  return (
    <div style={{ display: 'inline-flex', background: P2, borderRadius: 7, padding: 3, gap: 2 }}>
      {opts.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          padding: '5px 14px', borderRadius: 5, border: 'none',
          background: val === o.v ? '#2b3038' : 'transparent',
          color: val === o.v ? T : M,
          fontSize: 12, fontWeight: val === o.v ? 500 : 400,
          fontFamily: "'Inter',sans-serif",
          cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
          letterSpacing: '0.01em',
        }}>
          {o.l}
        </button>
      ))}
    </div>
  )
}

function Mono({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span style={{ fontFamily: "'JetBrains Mono',monospace", color: A, ...style }}>{children}</span>
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', color: M, fontWeight: 500, marginBottom: 14 }}>
      {children}
    </div>
  )
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
    { label: 'CPU', value: `${Math.round(live.cpuTemp)}°C` },
    { label: 'GPU', value: `${Math.round(live.gpuTemp)}°C` },
    { label: 'FAN', value: `${live.cpuFan.toLocaleString()} / ${live.gpuFan.toLocaleString()}` },
    { label: 'PWR', value: `${Math.round(live.watt)} W` },
  ]

  return (
    <div style={{
      height: 34, display: 'flex', alignItems: 'center', flexShrink: 0,
      background: '#101215', borderBottom: `1px solid ${B}`,
      padding: '0 20px', gap: 18,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: T, textTransform: 'uppercase' }}>
        PreySense
      </span>
      <div style={{ width: 1, height: 14, background: B }} />
      {stats.map(({ label, value }) => (
        <div key={label} style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
          <span style={{ fontSize: 9, color: M, fontWeight: 600, letterSpacing: '0.08em' }}>{label}</span>
          <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: A }}>{value}</span>
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <div style={{
        padding: '2px 9px', background: hex2rgba(A, 0.1),
        border: `1px solid ${hex2rgba(A, 0.28)}`, borderRadius: 4,
        fontSize: 10, color: A, fontWeight: 500, letterSpacing: '0.05em',
      }}>
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

function Sidebar({ screen, onNav }: { screen: Screen; onNav: (s: Screen) => void }) {
  return (
    <div style={{
      width: 170, flexShrink: 0, background: '#101215',
      borderRight: `1px solid ${B}`,
      display: 'flex', flexDirection: 'column',
      padding: '20px 0',
    }}>
      <div style={{ padding: '0 16px 20px', borderBottom: `1px solid ${B}`, marginBottom: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: M, marginBottom: 2 }}>Helios Neo 16</div>
        <div style={{ fontSize: 10, color: M, opacity: 0.6 }}>SN2024-PRD-0041</div>
      </div>
      {NAV.map(({ id, label, Icon }) => {
        const active = screen === id
        return (
          <button key={id} onClick={() => onNav(id)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 14px', margin: '1px 8px',
            borderRadius: 7, border: 'none',
            background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
            color: active ? T : M,
            cursor: 'pointer',
            transition: 'background 0.12s, color 0.12s',
            textAlign: 'left',
          }}>
            <div style={{ color: active ? A : M, transition: 'color 0.12s', flexShrink: 0 }}>
              <Icon />
            </div>
            <span style={{ fontSize: 12, fontWeight: active ? 500 : 400, fontFamily: "'Inter',sans-serif", letterSpacing: '0.01em' }}>
              {label}
            </span>
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
  return (
    <div style={{ padding: '28px 28px' }}>
      <PageHeader title="System Overview" subtitle="Acer Predator Helios Neo 16" />

      <Card style={{ marginBottom: 12 }}>
        <Label>Performance Mode</Label>
        <SegCtrl
          opts={[{ v: 'quiet' as PerfMode, l: 'Quiet' }, { v: 'balanced' as PerfMode, l: 'Balanced' }, { v: 'performance' as PerfMode, l: 'Performance' }, { v: 'turbo' as PerfMode, l: 'Turbo' }]}
          val={mode} onChange={onMode}
        />
        <p style={{ margin: '12px 0 0', fontSize: 12, color: M, lineHeight: 1.65 }}>{PERF_DESCS[mode]}</p>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Card>
          <Label>Thermal</Label>
          <StatLine label="CPU Temperature" value={`${live.cpuTemp.toFixed(1)} °C`} />
          <StatLine label="GPU Temperature" value={`${live.gpuTemp.toFixed(1)} °C`} />
        </Card>

        <Card>
          <Label>Fan Speed</Label>
          <StatLine label="CPU Fan" value={`${live.cpuFan.toLocaleString()} rpm`} />
          <StatLine label="GPU Fan" value={`${live.gpuFan.toLocaleString()} rpm`} />
        </Card>

        <Card>
          <Label>Power</Label>
          <StatLine label="System Draw" value={`${live.watt.toFixed(1)} W`} />
          <StatLine label="Battery" value="94 %" />
          <StatLine label="AC Adapter" value="230 W" />
        </Card>

        <Card>
          <Label>Manage</Label>
          {([
            ['Fan Control', 'fan' as Screen],
            ['Keyboard Lighting', 'lighting' as Screen],
            ['Display Settings', 'display' as Screen],
          ] as [string, Screen][]).map(([label, s]) => (
            <NavRow key={s} label={label} onClick={() => onNav(s)} />
          ))}
        </Card>
      </div>
    </div>
  )
}

function NavRow({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '7px 0', background: 'none', border: 'none',
        borderBottom: `1px solid ${B}`, color: hover ? T : M,
        fontSize: 12, fontFamily: "'Inter',sans-serif",
        cursor: 'pointer', transition: 'color 0.12s',
      }}>
      {label}
      <span style={{ fontSize: 10, opacity: hover ? 0.8 : 0.4, transition: 'opacity 0.12s' }}>→</span>
    </button>
  )
}

// ─── Fan Screen ────────────────────────────────────────────────────────
function FanScreen({ live }: { live: ReturnType<typeof useLive> }) {
  const [mode, setMode] = useState<FanMode>('auto')
  const [cpuCurve, setCpuCurve] = useState<FanPoint[]>(DEF_CPU)
  const [gpuCurve, setGpuCurve] = useState<FanPoint[]>(DEF_GPU)

  return (
    <div style={{ padding: '28px 28px' }}>
      <PageHeader title="Fan Control" subtitle="Adjust cooling behavior for acoustics and thermals" />
      <div style={{ marginBottom: 20 }}>
        <SegCtrl
          opts={[{ v: 'auto' as FanMode, l: 'Auto' }, { v: 'max' as FanMode, l: 'Max' }, { v: 'custom' as FanMode, l: 'Custom' }]}
          val={mode} onChange={setMode}
        />
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
            CPU target: <Mono>5,000 rpm</Mono>. GPU target: <Mono>4,500 rpm</Mono>.
          </p>
          <div style={{ fontSize: 11, color: 'rgba(210,140,80,0.85)', paddingTop: 10, borderTop: `1px solid ${B}` }}>
            Acoustics will be significant. For sustained use, ensure adequate ventilation.
          </div>
        </Card>
      )}

      {mode === 'custom' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <FanCurveEditor label="CPU Fan" points={cpuCurve} currentTemp={live.cpuTemp} onChange={setCpuCurve} />
            <FanCurveEditor label="GPU Fan" points={gpuCurve} currentTemp={live.gpuTemp} onChange={setGpuCurve} />
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: M }}>
            Drag control points to set speed (%) at temperature (°C). Endpoints are fixed at 0°C and 100°C.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Lighting Screen ───────────────────────────────────────────────────
function LightingScreen() {
  const [activeZone, setActiveZone] = useState(0)
  const [zoneColors, setZoneColors] = useState<string[]>(ZONE_DEF)
  const [brightness, setBrightness] = useState(80)
  const [effect, setEffect] = useState<LightEffect>('static')
  const [hue, setHue] = useState(185)

  const setZoneColor = (color: string) => {
    const c = [...zoneColors]; c[activeZone] = color; setZoneColors(c)
  }

  const handleHue = (h: number) => {
    setHue(h)
    setZoneColor(hslToHex(h, 72, 60))
  }

  return (
    <div style={{ padding: '28px 28px' }}>
      <PageHeader title="Keyboard Lighting" subtitle="Per-zone color, brightness, and effect" />

      <div style={{ marginBottom: 20 }}>
        <SegCtrl
          opts={[{ v: 'static' as LightEffect, l: 'Static' }, { v: 'breathing' as LightEffect, l: 'Breathing' }, { v: 'off' as LightEffect, l: 'Off' }]}
          val={effect} onChange={setEffect}
        />
      </div>

      {effect === 'off' ? (
        <Card>
          <p style={{ margin: 0, fontSize: 12, color: M }}>Keyboard backlight is disabled.</p>
        </Card>
      ) : (
        <>
          <div style={{ marginBottom: 16, overflowX: 'auto' }}>
            <KeyboardDiagram activeZone={activeZone} zoneColors={zoneColors} onSelect={setActiveZone} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            {ZONE_LABELS.map((label, i) => (
              <button key={i} onClick={() => setActiveZone(i)} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 12px', borderRadius: 6, border: '1px solid',
                borderColor: i === activeZone ? hex2rgba(zoneColors[i], 0.6) : B,
                background: i === activeZone ? hex2rgba(zoneColors[i], 0.12) : 'transparent',
                color: i === activeZone ? zoneColors[i] : M,
                fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 500,
                cursor: 'pointer', transition: 'all 0.12s',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: zoneColors[i], flexShrink: 0 }} />
                {label}
              </button>
            ))}
          </div>

          <Card>
            <Label>{ZONE_LABELS[activeZone]}</Label>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
              {SWATCHES.map(c => (
                <button key={c} onClick={() => setZoneColor(c)} style={{
                  width: 24, height: 24, borderRadius: 5, background: c, border: '2px solid',
                  borderColor: zoneColors[activeZone] === c ? T : `${c}55`,
                  cursor: 'pointer', transition: 'border-color 0.1s', padding: 0,
                }} />
              ))}
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, color: M, marginBottom: 8 }}>Custom Hue</div>
              <div style={{ position: 'relative', height: 4, borderRadius: 2, background: 'linear-gradient(to right,hsl(0,72%,60%),hsl(60,72%,60%),hsl(120,72%,60%),hsl(180,72%,60%),hsl(240,72%,60%),hsl(300,72%,60%),hsl(360,72%,60%))' }}>
                <input type="range" min="0" max="360" value={hue}
                  onChange={e => handleHue(Number(e.target.value))}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', margin: 0 }}
                />
                <div style={{
                  position: 'absolute', top: '50%', left: `${(hue / 360) * 100}%`,
                  transform: 'translate(-50%,-50%)',
                  width: 12, height: 12, borderRadius: '50%',
                  background: hslToHex(hue, 72, 60),
                  border: '2px solid #15171b', pointerEvents: 'none',
                }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: M }}>Brightness</span>
                <Mono style={{ fontSize: 11 }}>{brightness}%</Mono>
              </div>
              <input type="range" min="0" max="100" value={brightness}
                onChange={e => setBrightness(Number(e.target.value))} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 9, color: M, opacity: 0.6 }}>Off</span>
                <span style={{ fontSize: 9, color: M, opacity: 0.6 }}>Full</span>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

// ─── Display Screen ────────────────────────────────────────────────────
const PROFILE_DESCS: Record<DisplayProfile, string> = {
  native: 'Full panel gamut (DCI-P3 87%). Vivid color reproduction for gaming and media.',
  srgb: 'Restricted to sRGB color space. More accurate for web content and productivity. Slightly lower peak brightness.',
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
      <PageHeader title="Display" subtitle="QHD+ 2560 × 1600 · IPS · 165 Hz · 3 ms · DCI-P3 87%" />

      <Card style={{ marginBottom: 12 }}>
        <Label>Color Profile</Label>
        <SegCtrl
          opts={[{ v: 'native' as DisplayProfile, l: 'Native' }, { v: 'srgb' as DisplayProfile, l: 'sRGB' }, { v: 'custom' as DisplayProfile, l: 'Custom' }]}
          val={profile} onChange={setProfile}
        />
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
              color: refresh === r ? A : M,
              fontSize: 13, fontFamily: "'JetBrains Mono',monospace", fontWeight: 500,
              cursor: 'pointer', transition: 'all 0.12s',
            }}>
              {r} Hz
            </button>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 12, color: M }}>{refreshDescs[refresh]}</p>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <Label>Backlight</Label>
          <Mono style={{ fontSize: 12 }}>{brightness}%</Mono>
        </div>
        <input type="range" min="0" max="100" value={brightness}
          onChange={e => setBrightness(Number(e.target.value))} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 9, color: M, opacity: 0.6 }}>Dim</span>
          <span style={{ fontSize: 9, color: M, opacity: 0.6 }}>Full</span>
        </div>
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

  const navigate = (s: Screen) => {
    if (s === screen) return
    setOpacity(0)
    setTimeout(() => { setScreen(s); setOpacity(1) }, 150)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#15171b', color: T, fontFamily: "'Inter',sans-serif", overflow: 'hidden' }}>
      <StatusBar live={live} mode={PERF_LABELS[perfMode]} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar screen={screen} onNav={navigate} />
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
