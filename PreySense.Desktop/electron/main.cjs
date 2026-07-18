const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

let mainWindow = null
let hostProcess = null
let tray = null
let requestId = 0
const pendingRequests = new Map()
let responseBuffer = ''
let isQuitting = false
let osdWindow = null
let osdTimer = null

// ── Admin Elevation ────────────────────────────────────────────────
function isAdmin() {
  try {
    require('child_process').execSync('net session', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ── Single Instance ────────────────────────────────────────────────
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ── Admin Elevation ────────────────────────────────────────────────
if (!process.argv.includes('--elevated')) {
  let elevated = false
  try {
    require('child_process').execSync('net session', { stdio: 'ignore' })
    elevated = true
  } catch {
    // not admin
  }
  if (!elevated) {
    const { exec } = require('child_process')
    const exePath = process.execPath
    const spawnArgs = process.argv.slice(1).filter(a => !a.startsWith('--type='))
    spawnArgs.push('--elevated')
    const argStr = spawnArgs.map(a => /["\s]/.test(a) ? `"${a}"` : a).join(' ')
    const psCmd = `Start-Process -FilePath "${exePath}" -Verb RunAs -ArgumentList '${argStr}'`
    exec(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`)
    app.quit()
  }
}

// ── Host Process ───────────────────────────────────────────────────
function getHostPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'PreySense.Host.exe')
  }
  return path.join(__dirname, '..', '..', 'PreySense.Host', 'bin', 'Release', 'net10.0-windows', 'win-x64', 'publish', 'PreySense.Host.exe')
}

function startHost() {
  const hostPath = getHostPath()
  if (!fs.existsSync(hostPath)) {
    console.warn('PreySense.Host.exe not found at', hostPath)
    return
  }

  hostProcess = spawn(hostPath, ['--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })

  hostProcess.stdout.on('data', (data) => {
    diagLog(`Raw stdout data received (${data.length} bytes)`)
    responseBuffer += data.toString()
    const lines = responseBuffer.split('\n')
    responseBuffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      diagLog(`Parsing line: ${line.substring(0, 200)}`)
      try {
        const msg = JSON.parse(line)
        // Unsolicited event from host
        if (msg.type === 'event') {
          diagLog(`DETECTED EVENT: type=event name=${msg.name}`)
          handleHostEvent(msg.name, msg.data)
          continue
        }
        // Response to a pending request
        const id = String(msg.id ?? '')
        diagLog(`Parsed response id=${id}`)
        const pending = pendingRequests.get(id)
        if (pending) {
          diagLog(`Matched pending request id=${id}`)
          if (msg.error) pending.reject(new Error(msg.error))
          else pending.resolve(msg.result)
          pendingRequests.delete(id)
        } else {
          diagLog(`No pending request for id=${id}`)
        }
      } catch (e) { diagLog(`JSON parse error: ${e.message}`); /* skip malformed JSON */ }
    }
  })

  hostProcess.stderr.on('data', (data) => {
    console.error('Host stderr:', data.toString())
  })

  hostProcess.on('exit', (code) => {
    console.log('Host process exited with code:', code)
    hostProcess = null
  })
}

function stopHost() {
  if (hostProcess) {
    hostProcess.kill()
    hostProcess = null
  }
}

function sendToHost(method, params) {
  return new Promise((resolve, reject) => {
    if (!hostProcess || !hostProcess.stdin) {
      reject(new Error('Host not running'))
      return
    }
    const id = ++requestId
    const request = JSON.stringify({ method, params, id }) + '\n'
    pendingRequests.set(String(id), { resolve, reject })
    hostProcess.stdin.write(request)
  })
}

// ── Host Events ────────────────────────────────────────────────────
const diagLog = (msg) => {
  try {
    require('fs').appendFileSync(
      require('path').join(require('os').tmpdir(), 'preysense-hotkey.log'),
      `[${new Date().toISOString().slice(11,23)}] ELECTRON: ${msg}\n`
    )
  } catch {}
}

function handleHostEvent(name, data) {
  diagLog(`handleHostEvent called: name=${name} data=${JSON.stringify(data)}`)
  console.log('Host event:', name, JSON.stringify(data))
  // Forward to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    diagLog('Forwarding event to renderer via webContents.send')
    mainWindow.webContents.send('host:event', { name, data })
    diagLog('Forwarded to renderer')
  } else {
    diagLog(`mainWindow not available (isDestroyed=${mainWindow?.isDestroyed()})`)
  }
  // Show OSD for mode changes
  if (name === 'modeChanged' && data) {
    diagLog('Calling showOsdOverlay')
    showOsdOverlay(data.modeName || 'Balanced', data.mode ?? 1)
    diagLog('showOsdOverlay returned')
  }
}

// ── OSD Overlay ────────────────────────────────────────────────────
function showOsdOverlay(modeName, mode) {
  diagLog(`showOsdOverlay(modeName=${modeName}, mode=${mode})`)
  const accentColors = {
    0x00: '#8b8f9a',
    0x01: '#5fa8b0',
    0x04: '#e8843a',
    0x05: '#e03a3a',
    0x06: '#40c057',
  }
  const accent = accentColors[mode] || '#5fa8b0'
  diagLog(`accent=${accent}`)

  const display = require('electron').screen.getPrimaryDisplay()
  const { width: screenW, height: screenH } = display.workAreaSize
  const ow = 240, oh = 52
  const x = Math.round((screenW - ow) / 2)
  const y = screenH - oh - 80
  diagLog(`display: ${screenW}x${screenH}, osd pos: ${x},${y}`)

  if (!osdWindow || osdWindow.isDestroyed()) {
    diagLog('Creating new BrowserWindow for OSD...')
    try {
      osdWindow = new BrowserWindow({
        width: ow,
        height: oh,
        x,
        y,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        focusable: false,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      })
      osdWindow.setIgnoreMouseEvents(true, { forward: true })
      diagLog('BrowserWindow created successfully')
    } catch (err) {
      diagLog(`BrowserWindow creation FAILED: ${err.message}`)
      return
    }
  } else {
    diagLog('Reusing existing OSD window')
    osdWindow.setBounds({ x, y, width: ow, height: oh })
  }

  const html = `<!DOCTYPE html><html><body style="margin:0;overflow:hidden;background:transparent;">
<div id="toast" style="
  display:flex;align-items:center;justify-content:center;gap:10px;
  width:${ow}px;height:${oh}px;
  background:rgba(18,18,22,0.92);
  border:1.5px solid ${accent}88;
  border-radius:26px;
  opacity:0;
  transition:opacity 0.15s ease;
  font-family:'Inter','Segoe UI',sans-serif;
  color:#e4e6ea;font-size:15px;font-weight:600;
  letter-spacing:0.02em;
  box-shadow:0 8px 32px rgba(0,0,0,0.5);
">
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <circle cx="9" cy="9" r="7.5" stroke="${accent}" stroke-width="1.3"/>
    <circle cx="9" cy="9" r="4" fill="${accent}"/>
  </svg>
  <span>${modeName}</span>
</div>
<script>
  const t = document.getElementById('toast');
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  let fadeTimer = null;
  window.addEventListener('message', e => {
    if (e.data === 'fade') {
      clearTimeout(fadeTimer);
      t.style.transition = 'opacity 0.2s ease';
      t.style.opacity = '0';
    }
  });
<\/script>
</body></html>`

  diagLog('Loading OSD HTML...')
  osdWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    .then(() => diagLog('OSD HTML loaded'))
    .catch(err => diagLog(`OSD HTML load error: ${err.message}`))
  osdWindow.showInactive()
  diagLog('OSD shown (showInactive)')

  // Hide after 1.6s with fade
  clearTimeout(osdTimer)
  osdTimer = setTimeout(() => {
    diagLog('OSD fade timeout fired')
    if (osdWindow && !osdWindow.isDestroyed()) {
      try { osdWindow.webContents.send('fade-osd'); diagLog('fade-osd message sent') } catch (e) { diagLog(`fade-osd send error: ${e.message}`) }
      setTimeout(() => {
        if (osdWindow && !osdWindow.isDestroyed()) {
          osdWindow.hide()
          diagLog('OSD hidden')
        }
      }, 220)
    } else {
      diagLog('OSD window destroyed before fade')
    }
  }, 1600)
}

function cleanupOsd() {
  clearTimeout(osdTimer)
  if (osdWindow && !osdWindow.isDestroyed()) osdWindow.destroy()
  osdWindow = null
}

// ── Tray ───────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('PreySense')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show PreySense',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ── Window ─────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: true,
    frame: true,
    title: 'PreySense',
    backgroundColor: '#15171b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── IPC Handlers ───────────────────────────────────────────────────
function registerIpcHandlers() {
  ipcMain.handle('hw:send', async (_event, method, params) => {
    return sendToHost(method, params)
  })

  ipcMain.handle('hw:telemetry', async () => {
    return sendToHost('ReadTelemetry')
  })

  ipcMain.handle('hw:device-info', async () => {
    return sendToHost('GetDeviceInfo')
  })

  ipcMain.on('app:quit', () => {
    isQuitting = true
    app.quit()
  })
}

// ── App Lifecycle ──────────────────────────────────────────────────
app.whenReady().then(() => {
  startHost()
  registerIpcHandlers()
  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('before-quit', () => {
  cleanupOsd()
  stopHost()
})
