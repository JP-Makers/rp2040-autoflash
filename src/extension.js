'use strict';

const vscode = require('vscode');
const { resetRP2040, listRP2040Ports } = require('./reset');
const { findRP2Drive, copyUF2 }        = require('./flash');
const { log, showOutput }              = require('./output');

let statusBarPort  = null;
let statusBarFlash = null;
let selectedPort   = '';
let selectedUF2    = '';
let autoFlashEnabled = true;
let portWatcher    = null;   // setInterval for auto-detect

function activate(context) {
  showOutput();

  // ── Status Bar: Port ───────────────────────────────────────────────────────
  statusBarPort = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 11);
  statusBarPort.command = 'rp2040-autoflash.pickPort';
  statusBarPort.tooltip  = 'RP2040 port — click to change';
  statusBarPort.show();

  // ── Status Bar: Flash ──────────────────────────────────────────────────────
  statusBarFlash = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  statusBarFlash.command = 'rp2040-autoflash.flash';
  statusBarFlash.text    = '$(zap) Flash';
  statusBarFlash.tooltip = 'RP2040: Auto Flash UF2';
  statusBarFlash.show();

  updatePortBar('');

  // ── Restore saved config ───────────────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration('rp2040-autoflash');
  const savedPort = cfg.get('serialPort', '');
  const savedUF2  = cfg.get('uf2Path', '');
  if (savedPort) { selectedPort = savedPort; updatePortBar(savedPort); }
  if (savedUF2)  { selectedUF2  = savedUF2; }

  // ── Auto-detect port on startup ────────────────────────────────────────────
  autoDetectPort(context);

  // ── Auto-detect UF2 in workspace ──────────────────────────────────────────
  autoDetectUF2();

  // ── Watch for new UF2 builds ──────────────────────────────────────────────
  const uf2Watcher = vscode.workspace.createFileSystemWatcher('**/*.uf2');
  uf2Watcher.onDidCreate((uri) => {
    log(`New UF2 detected: ${uri.fsPath}`);
    selectedUF2 = uri.fsPath;
    const cfg = vscode.workspace.getConfiguration('rp2040-autoflash');
    if (cfg.get('autoFlashOnBuild', true) && selectedPort) {
      log('autoFlashOnBuild enabled — triggering flash…');
      vscode.commands.executeCommand('rp2040-autoflash.flash');
    } else {
      vscode.window.showInformationMessage(
        `RP2040: New UF2 detected: ${require('path').basename(uri.fsPath)}`,
        'Flash Now'
      ).then((choice) => {
        if (choice === 'Flash Now') vscode.commands.executeCommand('rp2040-autoflash.flash');
      });
    }
  });
  uf2Watcher.onDidChange((uri) => {
    log(`UF2 changed: ${uri.fsPath}`);
    selectedUF2 = uri.fsPath;
    const cfg = vscode.workspace.getConfiguration('rp2040-autoflash');
    if (cfg.get('autoFlashOnBuild', true) && selectedPort) {
      log('UF2 updated — auto-flashing…');
      vscode.commands.executeCommand('rp2040-autoflash.flash');
    }
  });

  // ── Poll for RP2040 port appearing/disappearing every 3s ──────────────────
  portWatcher = setInterval(() => monitorPort(), 3000);

  // ── Commands ───────────────────────────────────────────────────────────────
  const flashCmd = vscode.commands.registerCommand('rp2040-autoflash.flash', doFlash);

  const resetCmd = vscode.commands.registerCommand('rp2040-autoflash.resetOnly', async () => {
    const port = await ensurePort();
    if (!port) return;
    try {
      log(`Sending 1200bps reset on ${port}…`);
      await resetRP2040(port);
      vscode.window.showInformationMessage(`RP2040 reset to bootloader on ${port}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Reset failed: ${e.message}`);
    }
  });

  const pickPortCmd = vscode.commands.registerCommand('rp2040-autoflash.pickPort', async () => {
    const port = await pickPortInteractive();
    if (port) {
      selectedPort = port;
      updatePortBar(port);
      await vscode.workspace.getConfiguration('rp2040-autoflash')
        .update('serialPort', port, vscode.ConfigurationTarget.Workspace);
    }
  });

  const pickUF2Cmd = vscode.commands.registerCommand('rp2040-autoflash.pickUF2', async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false, filters: { 'UF2 Files': ['uf2'] }, title: 'Select UF2 file'
    });
    if (uris?.[0]) {
      selectedUF2 = uris[0].fsPath;
      await vscode.workspace.getConfiguration('rp2040-autoflash')
        .update('uf2Path', selectedUF2, vscode.ConfigurationTarget.Workspace);
      vscode.window.showInformationMessage(`UF2 set: ${require('path').basename(selectedUF2)}`);
    }
  });

  const cfgWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('rp2040-autoflash.serialPort')) {
      const p = vscode.workspace.getConfiguration('rp2040-autoflash').get('serialPort', '');
      selectedPort = p; updatePortBar(p);
    }
  });

  context.subscriptions.push(
    flashCmd, resetCmd, pickPortCmd, pickUF2Cmd,
    statusBarPort, statusBarFlash, uf2Watcher, cfgWatcher,
    { dispose: () => clearInterval(portWatcher) }
  );

  log('RP2040 Auto Flash activated.');
}

// ── Core flash flow ───────────────────────────────────────────────────────────
async function doFlash(uri) {
  try {
    const uf2Path = await ensureUF2(uri);
    if (!uf2Path) return;

    const port = await ensurePort();
    if (!port) return;

    setFlashState('flashing');

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'RP2040 Auto Flash', cancellable: false },
      async (progress) => {
        progress.report({ message: `⚡ Resetting ${port} via 1200bps…`, increment: 0 });
        log(`Resetting on ${port}…`);
        await resetRP2040(port);

        const waitMs = vscode.workspace.getConfiguration('rp2040-autoflash').get('bootloaderWaitMs', 3000);
        progress.report({ message: `⏳ Waiting ${waitMs / 1000}s for RPI-RP2 drive…`, increment: 25 });
        await delay(waitMs);

        progress.report({ message: '🔍 Locating RPI-RP2 drive…', increment: 25 });
        const cfg      = vscode.workspace.getConfiguration('rp2040-autoflash');
        const drivePath = cfg.get('autoDetectDrive', true)
          ? await findRP2Drive()
          : (cfg.get('drivePath', '') || await findRP2Drive());

        if (!drivePath) throw new Error(
          'RPI-RP2 drive not found. Try increasing bootloaderWaitMs or set drivePath manually.'
        );

        log(`Drive: ${drivePath}`);
        progress.report({ message: `📋 Copying ${require('path').basename(uf2Path)}…`, increment: 25 });
        await copyUF2(uf2Path, drivePath);

        progress.report({ message: '✅ Done!', increment: 25 });
        log('Flash complete!');
      }
    );

    setFlashState('success');
    vscode.window.showInformationMessage('RP2040 flashed successfully! 🎉');
    await delay(2500);
    setFlashState('idle');

  } catch (err) {
    setFlashState('idle');
    log(`ERROR: ${err.message}`);
    vscode.window.showErrorMessage(`RP2040 Flash failed: ${err.message}`);
  }
}

// ── Auto-detect helpers ───────────────────────────────────────────────────────

/** Scan ports and pick the RP2040 one automatically */
async function autoDetectPort(context) {
  log('Auto-detecting RP2040 port…');
  const ports = await listRP2040Ports();
  const rp = ports.find((p) => isLikelyRP2040(p));
  if (rp) {
    selectedPort = rp.path;
    updatePortBar(rp.path);
    log(`Auto-detected port: ${rp.path} (${rp.description})`);
    // Save to workspace settings
    await vscode.workspace.getConfiguration('rp2040-autoflash')
      .update('serialPort', rp.path, vscode.ConfigurationTarget.Workspace);
  } else if (ports.length === 1) {
    // Only one port — probably it
    selectedPort = ports[0].path;
    updatePortBar(ports[0].path);
    log(`Single port found, using: ${ports[0].path}`);
  } else {
    log(`No RP2040 port auto-detected (${ports.length} ports found).`);
  }
}

/** Find the newest/most relevant UF2 in the workspace */
async function autoDetectUF2() {
  // Check saved config first
  const cfg = vscode.workspace.getConfiguration('rp2040-autoflash').get('uf2Path', '');
  if (cfg) { selectedUF2 = cfg; log(`UF2 from config: ${cfg}`); return; }

  const uris = await vscode.workspace.findFiles('**/*.uf2', '**/node_modules/**', 10);
  if (uris.length === 0) { log('No UF2 files found in workspace.'); return; }

  // Prefer files in a "build" folder; pick the first match
  const buildUF2 = uris.find((u) => u.fsPath.includes('build'));
  const chosen   = buildUF2 || uris[0];
  selectedUF2    = chosen.fsPath;
  log(`Auto-detected UF2: ${selectedUF2}`);
}

/** Periodic port monitor — re-detect if port disappears or new RP2040 connects */
let lastPortCount = 0;
async function monitorPort() {
  try {
    const ports = await listRP2040Ports();
    const rpPorts = ports.filter(isLikelyRP2040);

    // New RP2040 appeared
    if (rpPorts.length > 0 && !selectedPort) {
      const rp = rpPorts[0];
      selectedPort = rp.path;
      updatePortBar(rp.path);
      log(`RP2040 connected: ${rp.path}`);
      await vscode.workspace.getConfiguration('rp2040-autoflash')
        .update('serialPort', rp.path, vscode.ConfigurationTarget.Workspace);
    }

    // Port count changed (device disconnected/reconnected)
    if (ports.length !== lastPortCount) {
      lastPortCount = ports.length;
      // If our selected port is gone, clear it
      if (selectedPort && !ports.find((p) => p.path === selectedPort)) {
        log(`Port ${selectedPort} disconnected.`);
        selectedPort = '';
        updatePortBar('');
        // Try to find new RP2040
        const rp = ports.find(isLikelyRP2040);
        if (rp) { selectedPort = rp.path; updatePortBar(rp.path); log(`Switched to: ${rp.path}`); }
      }
    }
  } catch (_) {}
}

function isLikelyRP2040(p) {
  const desc = (p.description || '').toLowerCase();
  const vid  = (p.vendorId || '').toLowerCase();
  return vid === '2e8a'
    || desc.includes('pico')
    || desc.includes('rp2040')
    || desc.includes('rp2')
    || desc.includes('raspberry');
}

// ── Ensure port / UF2 ─────────────────────────────────────────────────────────

async function ensurePort() {
  if (selectedPort) return selectedPort;
  // Try one more auto-detect
  const ports = await listRP2040Ports();
  const rp = ports.find(isLikelyRP2040) || (ports.length === 1 ? ports[0] : null);
  if (rp) { selectedPort = rp.path; updatePortBar(rp.path); return rp.path; }
  // Ask user
  return pickPortInteractive();
}

async function ensureUF2(uri) {
  if (uri?.fsPath) return uri.fsPath;
  if (selectedUF2) return selectedUF2;
  await autoDetectUF2();
  if (selectedUF2) return selectedUF2;
  // Ask user
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false, filters: { 'UF2 Files': ['uf2'] }, title: 'Select UF2 to flash'
  });
  if (uris?.[0]) { selectedUF2 = uris[0].fsPath; return selectedUF2; }
  return null;
}

async function pickPortInteractive() {
  const ports = await listRP2040Ports();
  if (ports.length === 0) {
    vscode.window.showErrorMessage('No serial ports found. Connect RP2040 and make sure firmware has USB serial.');
    return null;
  }
  const items = [
    ...ports.map((p) => ({
      label: `$(plug) ${p.path}`,
      description: p.description || '',
      detail: isLikelyRP2040(p) ? '$(star-full) Likely RP2040' : '',
      portPath: p.path,
    })),
    { label: '$(edit) Enter manually…', description: '', detail: '', portPath: '__manual__' },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select RP2040 serial port',
    title: 'RP2040 Auto Flash — Select Port',
  });
  if (!picked) return null;
  if (picked.portPath === '__manual__') {
    const m = await vscode.window.showInputBox({
      prompt: 'Enter port path',
      placeHolder: 'e.g. COM3  or  /dev/ttyACM0',
    });
    return m?.trim() || null;
  }
  selectedPort = picked.portPath;
  updatePortBar(picked.portPath);
  await vscode.workspace.getConfiguration('rp2040-autoflash')
    .update('serialPort', picked.portPath, vscode.ConfigurationTarget.Workspace);
  return picked.portPath;
}

// ── Status bar helpers ────────────────────────────────────────────────────────

function updatePortBar(port) {
  if (!statusBarPort) return;
  if (port) {
    statusBarPort.text = `$(plug) ${port}`;
    statusBarPort.tooltip = `RP2040 port: ${port} — click to change`;
    statusBarPort.backgroundColor = undefined;
  } else {
    statusBarPort.text = '$(plug) Detecting…';
    statusBarPort.tooltip = 'RP2040: No port detected — click to select manually';
    statusBarPort.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

function setFlashState(state) {
  if (!statusBarFlash) return;
  if (state === 'flashing') {
    statusBarFlash.text = '$(sync~spin) Flashing…';
    statusBarFlash.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else if (state === 'success') {
    statusBarFlash.text = '$(check) Flashed!';
    statusBarFlash.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
  } else {
    statusBarFlash.text = '$(zap) Flash';
    statusBarFlash.backgroundColor = undefined;
  }
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function deactivate() { clearInterval(portWatcher); }

module.exports = { activate, deactivate };
