const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const BACKEND_DIR = path.join(__dirname, '..', '..', 'locus-backend');

// ── Python executable ────────────────────────────────────────────────────────
// Always prefer the project's own venv so all backend deps are available
// without the user needing to activate an environment first.

function getVenvPython() {
  const venvPy = process.platform === 'win32'
    ? path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe')
    : path.join(BACKEND_DIR, 'venv', 'bin', 'python3')
  return fs.existsSync(venvPy) ? venvPy : null
}

// ── .env file loader ─────────────────────────────────────────────────────────
// Reads KEY=VALUE pairs from locus-backend/.env so the user can drop their
// API keys there and have them picked up automatically (without editing code).

function loadDotEnv() {
  const envFile = path.join(BACKEND_DIR, '.env')
  if (!fs.existsSync(envFile)) return {}
  const vars = {}
  for (const raw of fs.readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) vars[key] = val
  }
  return vars
}

// ── App settings (stored in userData) ───────────────────────────────────────
// Holds user-entered API keys and optional Python override path.
// Stored at: <userData>/locus-settings.json

const settingsPath = () => path.join(app.getPath('userData'), 'locus-settings.json')

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeSettings(data) {
  fs.writeFileSync(settingsPath(), JSON.stringify(data, null, 2))
}

// ── Build subprocess env ─────────────────────────────────────────────────────
// Merges (in increasing priority): current process env → .env file → stored settings.
// This means stored settings always win over the .env file, which wins over the OS env.

function buildPythonEnv() {
  const dotEnv  = loadDotEnv()
  const stored  = readSettings()
  const apiVars = {}
  if (stored.ANTHROPIC_API_KEY) apiVars.ANTHROPIC_API_KEY = stored.ANTHROPIC_API_KEY
  if (stored.HF_TOKEN)          apiVars.HF_TOKEN           = stored.HF_TOKEN
  if (stored.HF_TOKEN)          apiVars.HUGGINGFACE_HUB_TOKEN = stored.HF_TOKEN
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    ...dotEnv,
    ...apiVars,
  }
}

// ── Saved-codebase store ─────────────────────────────────────────────────────
// One JSON file per codebase in userData/saves/ plus a lightweight index.json
// that backs the "recent visualizations" list on the home screen.

const savesDir  = () => path.join(app.getPath('userData'), 'saves')
const indexPath = () => path.join(savesDir(), 'index.json')
const savePath  = (id) => path.join(savesDir(), `${id}.json`)

function saveIdFor(projectPath) {
  return crypto.createHash('sha1').update(String(projectPath)).digest('hex').slice(0, 12)
}

function readIndex() {
  try {
    const list = JSON.parse(fs.readFileSync(indexPath(), 'utf-8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeIndex(list) {
  fs.mkdirSync(savesDir(), { recursive: true })
  fs.writeFileSync(indexPath(), JSON.stringify(list, null, 2))
}

// ── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Folder dialog ────────────────────────────────────────────────────────────

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Project Folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

// ── Analysis ─────────────────────────────────────────────────────────────────

const PROGRESS_MARKER = '##LOCUS_PROGRESS## '

ipcMain.handle('analyze-project', async (event, projectPath, options = {}) => {
  return new Promise((resolve, reject) => {
    const pythonExe  = getVenvPython() || 'python'
    const outputPath = path.join(BACKEND_DIR, 'output', 'graph.json')
    const args = ['analyze.py', projectPath]
    if (options.cluster)   args.push('--cluster')
    if (options.lite)      args.push('--lite')
    if (options.noLabels)  args.push('--no-labels')
    if (options.apiKey)    args.push('--api-key', options.apiKey)

    const python = spawn(pythonExe, args, {
      cwd: BACKEND_DIR,
      env: buildPythonEnv(),
    })

    let stderr = ''
    python.stderr.on('data', (data) => { stderr += data.toString() })

    // Parse ##LOCUS_PROGRESS## {json} lines and forward them to the renderer
    let stdoutBuf = ''
    python.stdout.on('data', (data) => {
      stdoutBuf += data.toString()
      const lines = stdoutBuf.split(/\r?\n/)
      stdoutBuf = lines.pop()
      for (const line of lines) {
        const at = line.indexOf(PROGRESS_MARKER)
        if (at === -1) continue
        try {
          const payload = JSON.parse(line.slice(at + PROGRESS_MARKER.length))
          if (!event.sender.isDestroyed()) event.sender.send('analysis-progress', payload)
        } catch { /* malformed line — ignore */ }
      }
    })

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Analysis exited with code ${code}`))
        return
      }
      try {
        const raw = fs.readFileSync(outputPath, 'utf-8')
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error(`Failed to read graph output: ${e.message}`))
      }
    })

    python.on('error', (e) => {
      reject(new Error(`Could not start Python: ${e.message}`))
    })
  })
})

// ── Open file in editor ──────────────────────────────────────────────────────

ipcMain.handle('open-file', async (_event, filepath, line) => {
  const { exec } = require('child_process')
  const target = line ? `${filepath}:${line}` : filepath
  return new Promise((resolve) => {
    exec(`code --goto "${target}"`, (err) => {
      if (err) shell.openPath(filepath)
      resolve()
    })
  })
})

// ── Load graph JSON ──────────────────────────────────────────────────────────

ipcMain.handle('load-graph-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON Graph', extensions: ['json'] }],
    title: 'Load Graph JSON',
  })
  if (result.canceled) return null
  const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
  return JSON.parse(raw)
})

// ── App settings IPC ─────────────────────────────────────────────────────────

ipcMain.handle('get-settings', async () => {
  const s = readSettings()
  // Return whether each key is set (not the actual value, for display)
  return {
    hasAnthropicKey: !!s.ANTHROPIC_API_KEY,
    hasHfToken:      !!s.HF_TOKEN,
    // Also return the venv status so the UI can warn if it's missing
    hasVenv:         !!getVenvPython(),
  }
})

ipcMain.handle('save-settings', async (_event, data) => {
  const current = readSettings()
  const next = { ...current }
  // Only overwrite fields that were explicitly sent (empty string = clear the key)
  if ('ANTHROPIC_API_KEY' in data) next.ANTHROPIC_API_KEY = data.ANTHROPIC_API_KEY || undefined
  if ('HF_TOKEN' in data)          next.HF_TOKEN          = data.HF_TOKEN          || undefined
  // Remove undefined keys so the file stays clean
  for (const k of Object.keys(next)) {
    if (next[k] === undefined || next[k] === '') delete next[k]
  }
  writeSettings(next)
  return { hasAnthropicKey: !!next.ANTHROPIC_API_KEY, hasHfToken: !!next.HF_TOKEN, hasVenv: !!getVenvPython() }
})

// ── Saved-codebase IPC ───────────────────────────────────────────────────────

ipcMain.handle('list-saves', async () => {
  return readIndex().sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0))
})

ipcMain.handle('save-codebase', async (_event, payload) => {
  const id  = payload.id || saveIdFor(payload.projectPath)
  const now = Date.now()
  const save = {
    ...payload,
    id,
    createdAt:  payload.createdAt || now,
    lastOpened: now,
  }
  fs.mkdirSync(savesDir(), { recursive: true })
  fs.writeFileSync(savePath(id), JSON.stringify(save))

  const meta = {
    id,
    name:           save.name,
    projectPath:    save.projectPath,
    createdAt:      save.createdAt,
    lastOpened:     now,
    nodeCount:      save.stats?.nodes ?? 0,
    edgeCount:      save.stats?.edges ?? 0,
    clusterCount:   save.stats?.clusters ?? 0,
    languages:      save.stats?.languages ?? null,
    clusterEnabled: !!save.clusterEnabled,
  }
  const index = readIndex().filter((s) => s.id !== id)
  index.unshift(meta)
  writeIndex(index)
  return meta
})

ipcMain.handle('load-save', async (_event, id) => {
  const file = savePath(id)
  const save = JSON.parse(fs.readFileSync(file, 'utf-8'))
  save.lastOpened = Date.now()
  fs.writeFileSync(file, JSON.stringify(save))
  writeIndex(readIndex().map((s) => (s.id === id ? { ...s, lastOpened: save.lastOpened } : s)))
  return save
})

ipcMain.handle('delete-save', async (_event, id) => {
  try { fs.unlinkSync(savePath(id)) } catch { /* already gone */ }
  writeIndex(readIndex().filter((s) => s.id !== id))
  return true
})
