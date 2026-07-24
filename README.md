# Credits & Acknowledgements

## Origin

This project is a fork of **[PreySense](https://github.com/hammadzaigham/PreySense)** by
**[hammadzaigham](https://github.com/hammadzaigham)**, which is itself adapted from
**[G-Helper](https://github.com/seerge/g-helper)** by seerge, retargeted for Acer Predator
laptops.

Full credit for the original reverse-engineering work — the Acer WMI/AcerService protocol
research, the base performance-mode, fan, GPU, and battery control logic — goes to
hammadzaigham and, further upstream, to seerge and the G-Helper contributors. This project
would not exist without that groundwork. If you find this fork useful, please star and
support the original repositories.

- Original fork: https://github.com/hammadzaigham/PreySense
- Upstream project: https://github.com/seerge/g-helper

This project is released under the same license as the upstream repository (see `LICENSE`).
No claim of original authorship is made over the reverse-engineered hardware protocol or the
base control logic — the contributions described below are additive, on top of that
foundation.

---

## What this fork adds, model-specific to the Acer Predator Helios Neo 16

The original PreySense provides a general-purpose lightweight utility across several Predator
models. This fork narrows focus specifically to the **Helios Neo 16 (PHN16S-71-98RF)** and
extends it into a full native desktop application with a redesigned interface and additional
functionality:

### Architecture
- **Headless core library** (`PreySense.Core`) — all hardware control logic (WMI, AcerService,
  NVAPI, fan, RGB, battery, power limits) extracted into a UI-independent class library, so it
  can be driven by more than one front end.
- **IPC host** (`PreySense.Host`) — a lightweight background service exposing that hardware
  layer over JSON-RPC (stdio/named pipe), decoupling hardware access from any specific UI
  framework.
- **Electron desktop app** (`PreySense.Desktop`) — a modern React/Tailwind interface running
  as a native Windows application, communicating with the hardware layer through the IPC host.
  The original WinForms app remains fully intact and continues to work independently.

### Fan control
- Direct **RPM-based sliders** for CPU and GPU fans (rather than a temperature/speed curve
  editor), with independent or linked control and live target-vs-actual RPM readouts.
- Auto / Max / Custom modes, matching stock Predator Sense's behavior model.

### Keyboard lighting
- Full effect set — Static, Breathe, Neon, Wave, Shifting, Zoom — plus independent
  **per-zone ("Area") control** across all 4 lighting zones, in addition to whole-keyboard
  ("Global") control, matching the structure of official Predator Sense's Pulsar Lighting
  interface.
- Color selection via an HSV color wheel, brightness slider, and synchronized RGB/hex numeric
  inputs, rather than a fixed swatch palette.
- A live animated keyboard preview reflecting the selected zone colors before they're applied.

### System monitoring
- Live CPU/GPU temperature, fan RPM, power draw, and battery/AC status on a persistent
  dashboard, sourced directly from the same hardware layer driving the controls.

### Hardware key integration
- Support for the laptop's dedicated **performance-mode key**, cycling modes with a brief,
  unobtrusive on-screen overlay.
- Support for the dedicated **Predator-logo key**, bringing the app to the foreground (or
  launching it if closed) independent of the mode key.

### Design
- A deliberately quiet, low-contrast interface, built to feel like a monitoring instrument
  rather than a typical loud "gamer" utility aesthetic — while retaining full functional parity
  with, and in several areas (RPM-direct fan control, zonal lighting preview, dedicated hardware
  key support) exceeding, the feature set of the stock Predator Sense application for this
  specific model.

---

## A note on comparisons

Stock Predator Sense is a mature, officially supported application maintained by Acer, and
remains the only vendor-guaranteed option. This fork is an independent, community-driven
project, not an official Acer product, and comes with no official support or warranty. Where
this document describes something as an improvement, it refers specifically to this fork's
design choices for the Helios Neo 16 (native RPM control, zonal preview, a lighter-weight
background footprint), not a general claim of superiority over Acer's software as a whole.

---

## Thanks

- **hammadzaigham** — for PreySense and the initial Predator-specific adaptation
- **seerge** and the **G-Helper** contributors — for the original reverse-engineering effort
  this entire lineage is built on
- Everyone who tested early builds of this fork and reported the issues that shaped it
