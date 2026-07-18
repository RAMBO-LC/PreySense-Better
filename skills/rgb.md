# Keyboard RGB Panel — Design & Build Prompt (PreySense)

Use this as a spec you can hand to a designer, or paste into an AI coding assistant (Claude Code, etc.) alongside the existing PreySense/G-Helper RGB source, to implement the panel.

## 0. Reference

Baseline is Acer's own PredatorSense **Lighting** tab: dark chrome shell, cyan outline-glow per key, 4 zone toggles with color swatches, a Static/Dynamic switch, and a brightness slider tucked in the top corner. It's clean but shallow — zones are on/off + one color, there's no live animation preview, no per-key mode, and profile management is a single anonymous dropdown.

Goal: keep the chrome-and-glow visual language players already recognize, but make the panel actually *do more* and *show more* without growing past a single compact window.

## 1. Visual identity

| Token | Value | Use |
|---|---|---|
| `--bg-outer` | `#0a0d12` → `#12161c` radial gradient | window background, matches Predator's side-vent glow bezel |
| `--panel` | `#151a20` | card/section backgrounds |
| `--panel-raised` | `#1b222a` | inputs, chips, hover states |
| `--line` | `#232b33` | hairline borders, key outlines (idle) |
| `--accent` | `#00E5D2` (cyan, matches stock app) | active states, selected zone, primary glow |
| `--accent-soft` | `#00E5D2` at 18% opacity | idle key glow, background washes |
| `--text` | `#eef2f4` | primary text |
| `--text-dim` | `#7c8791` | labels, secondary text |
| Display font | Space Grotesk / Chakra Petch (angular, technical — matches "PredatorSense" wordmark energy) | headers, zone labels |
| Body font | Inter | everything else |
| Mono | IBM Plex Mono | RPM/temp/percentage values, hex codes |

Key visual signature carried over from stock: **rounded-square keys with a soft outer glow**, angled corner accents on the outer chrome (the diagonal cut lines top-right/bottom-left of the stock window). Keep those — they're the one thing that makes this recognizably a Predator tool. Everything inside gets rebuilt.

## 2. Layout (single window, ~880×560, resizable)

```
┌─────────────────────────────────────────────────────────┐
│ ⌗ PreySense           Home Lighting Fans Perf ⚙ – ▢ ✕     │ ← title bar, tabs inline (not stacked sidebar,
├───────────────────────────────┬───────────────────────────┤   matches stock's top-tab muscle memory)
│  Profile: [Gaming ▾] [+ Mgr]  │  ZONE 2 — selected         │
│  Mode: ( Static | Dynamic )   │  ─────────────────────     │
│                                │  Effect: [icon grid, 6]    │
│   ┌─ live keyboard preview ─┐ │  Color:  [swatches + hex]  │
│   │  glowing zoned keys      │ │  Speed:  [────●────]       │
│   │  (click a zone to edit)  │ │  Bright: [────●────]       │
│   └───────────────────────── │  Direction: [← →] (if wave) │
│  Zone chips: [1][2][3][4]     │                              │
│                                │  ☐ Sync to performance mode │
├────────────────────────────────┴──────────────────────────┤
│ Applies live · Zone 2 · Wave · 60% brightness               │
└─────────────────────────────────────────────────────────┘
```

Two-column split, no page navigation required to go from "pick a zone" to "edit its effect" — that round trip is the single biggest usability fix over stock, where changing a zone's behavior means hunting through a flat row of four identical toggle+swatch pairs with no feedback on what's currently active.

## 3. Component specs

**Profile row (top-left)**
- Dropdown shows profile name + a tiny live color strip preview (4 dots showing each zone's current color) so you can tell profiles apart without opening them.
- `Profile Manager` becomes a lightweight inline popover (rename, duplicate, delete, export/import as `.json`) instead of a separate modal window.

**Static / Dynamic toggle**
- Keep the same segmented pill from stock — it's already good and well recognized. Selecting **Dynamic** reveals the Effect grid; **Static** collapses it to just the color picker.

**Keyboard preview**
- Render actual physical layout (pull real key geometry from the laptop's layout file already used by G-Helper for per-key models; fall back to a generic ANSI layout for 4-zone-only models).
- Idle keys: 1px `--line` outline, 18% accent glow per their zone.
- **Live-animate the selected effect at true speed** in this preview — stock PredatorSense's keyboard graphic is static even when "Dynamic" wave/breathing is selected, so you can't tell what you're about to apply. This is the single highest-value fix.
- Click a zone's keys (or the zone chip below) to select it; selected zone gets a brighter outline + a small pulsing corner marker so it's unambiguous which zone the right panel is editing.
- Support click-drag across keys as an entry point into **per-key mode** (see §4) without a separate screen.

**Zone chips**
- Replace stock's 4 identical toggle+swatch rows with compact chips (`Zone 1`, `Zone 2`…) that each carry a live color dot. Tap to select, long-press/right-click to rename (useful since not everyone's zones map to "1-4" mentally — let people call it "WASD" or "Numpad").
- A chip's toggle (on/off) lives on the chip itself as a small dot state, not a separate switch — reduces the row from 2 controls per zone to 1.

**Effect grid** (replaces stock's binary Static/Dynamic-only choice)
- Icon + label cards: Static, Breathing, Wave, Rainbow Cycle, Reactive (per-keypress), Temp-linked (ties hue to CPU/GPU temp — a feature no OEM tool ships, good differentiator).
- Only show Speed / Direction sliders when the selected effect uses them (Wave shows direction, Static shows neither) — stock always shows a brightness slider whether or not it's relevant, this keeps the panel from feeling cluttered.

**Color picker**
- 6 preset swatches (brand-relevant: cyan, blue, violet, red, amber, white) + a custom swatch that opens a compact HSV picker with a hex input for people who know exactly what they want.

**Sync toggles** (new, not in stock)
- "Sync to performance mode" — ties zone colors to Eco/Balanced/Performance/Turbo automatically.
- "Dim on battery" — auto-drops brightness under a threshold on unplug.
- Both explained with a one-line description under the toggle, not just a bare checkbox label.

**Status bar** (new, not in stock)
- Persistent one-line summary at the bottom: what's currently applied, so the state of the whole panel is readable at a glance without a tour through all four zones.

## 4. Per-key mode

- Accessible via a small `4-Zone / Per-Key` segmented switch above the keyboard preview (only shown on hardware that supports it — detect at runtime, don't show a mode that will silently fail).
- Per-key mode reuses the exact same right-hand effect panel — selecting one key or a drag-selected region behaves identically to selecting a zone. No separate screen, no separate mental model.

## 5. Interaction & motion

- Zone/key selection: 120ms ease-out highlight, no bouncy overshoot — this is a utility, not a game menu.
- Effect card selection: border color transitions to `--accent`, icon gets a subtle glow — mirrors the keyboard preview's own glow language.
- Slider thumbs use the same cyan glow as selected keys, so the whole panel reads as one connected system rather than a login form.
- Respect reduced-motion: static highlight swap instead of transition when the OS setting is on.

## 6. Copy

- Zone chip default names: "Zone 1–4" until renamed, never "Group A" or internal IDs.
- Sync toggle descriptions written from what the user experiences ("Turbo → red pulse"), not how it's implemented ("writes to fan-mode WMI event").
- Empty state for Profile Manager with zero saved profiles: "No saved profiles yet — save your current setup to switch between them later," with the Save action right there, not just a description.

## 7. Technical notes for implementation

- Stock PredatorSense and G-Helper both talk to zone/per-key RGB through WMI/EC calls already reverse-engineered in PreySense's codebase — this spec is a presentation-layer rebuild, no new hardware protocol work needed.
- If staying in WinForms: owner-draw the keyboard grid and zone chips (`Paint` override) rather than stock Buttons, to get the glow and animation; use a `System.Windows.Forms.Timer` at ~30fps for the live effect preview, capped/paused when the window isn't focused to avoid idle CPU/GPU use.
- If moving to WPF/WinUI3: the keyboard preview maps naturally to an `ItemsControl` over key geometry data with a `Storyboard` per effect type.
- Detect zone count and per-key support at startup from the existing hardware ID table G-Helper maintains; hide per-key toggle entirely on 4-zone-only models rather than showing a control that does nothing.

## 8. Acceptance checklist

- [ ] Keyboard preview animates the actual selected effect at actual speed (not static)
- [ ] Selecting a zone updates the right panel without navigating away
- [ ] Effect-specific controls (speed/direction) only appear when relevant to the selected effect
- [ ] Per-key mode reachable without a separate window, hidden on unsupported hardware
- [ ] Profiles show a color preview, support rename/duplicate/delete/export
- [ ] Status bar reflects current applied state at all times
- [ ] Full keyboard navigation + visible focus rings on every control
- [ ] Reduced-motion setting respected