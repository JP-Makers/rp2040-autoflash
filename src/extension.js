// RP2040 Auto Flash Extension — src/extension.js
'use strict';

const vscode = require('vscode');
const { resetRP2040, listRP2040Ports } = require('./reset');
const { findRP2Drive, copyUF2 }        = require('./flash');
const { log, showOutput }              = require('./output');

let statusBarPort = null;   // status bar item for COM port
let statusBarFlash = null;  // status bar item for flash button
let selectedPort = '';      // currently selected port

function activate(context) {
  showOutput();

  // ── Status Bar: COM Port Selector ─────────────────────────────────────────
  // Placed at priority 10 so it appears near the Pico SDK items on the right
  statusBarPort = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    10
  );
  statusBarPort.command = 'rp2040-autoflash.pickPort';
  statusBarPort.tooltip = 'RP2040: Click to select COM port';
  updatePortStatusBar('');
  statusBarPort.show();

  // ── Status Bar: Flash Button ──────────────────────────────────────────────
  statusBarFlash = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    9
  );
  statusBarFlash.command = 'rp2040-autoflash.flash';
  statusBarFlash.text = '$(zap) Flash';
  statusBarFlash.tooltip = 'RP2040: Auto Flash UF2 (1200bps reset)';
  statusBarFlash.backgroundColor = undefined;
  statusBarFlash.show();

  // Restore saved port from workspace config
  const savedPort = vscode.workspace
    .getConfiguration('rp2040-autoflash')
    .get('serialPort', '');
  if (savedPort) {
    selectedPort = savedPort;
    updatePortStatusBar(savedPort);
  }

  // ── Command: Pick Port ────────────────────────────────────────────────────
  const pickPortCmd = vscode.commands.registerCommand(
    'rp2040-autoflash.pickPort',
    async () => {
      const port = await pickPortInteractive();
      if (port) {
        selectedPort = port;
        updatePortStatusBar(port);
        await vscode.workspace
          .getConfiguration('rp2040-autoflash')
          .update('serialPort', port, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`RP2040 port set to: ${port}`);
        log(`Port selected: ${port}`);
      }
    }
  );

  // ── Command: Auto Flash UF2 ───────────────────────────────────────────────
  const flashCmd = vscode.commands.registerCommand(
    'rp2040-autoflash.flash',
    async (uri) => {
      try {
        const uf2Path = await resolveUF2Path(uri);
        if (!uf2Path) return;

        const port = await resolvePort();
        if (!port) return;

        // Flash button turns orange while flashing
        statusBarFlash.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarFlash.text = '$(sync~spin) Flashing…';

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'RP2040 Auto Flash',
              cancellable: false,
            },
            async (progress) => {
              progress.report({ message: '⚡ Resetting via 1200bps trick…', increment: 0 });
              log(`Resetting on port: ${port}`);
              await resetRP2040(port);
              log('Reset pulse sent.');

              const waitMs = vscode.workspace
                .getConfiguration('rp2040-autoflash')
                .get('bootloaderWaitMs', 3000);

              progress.report({ message: `⏳ Waiting for RPI-RP2 drive (${waitMs / 1000}s)…`, increment: 30 });
              await delay(waitMs);

              progress.report({ message: '🔍 Locating RPI-RP2 drive…', increment: 30 });
              const cfg    = vscode.workspace.getConfiguration('rp2040-autoflash');
              const auto   = cfg.get('autoDetectDrive', true);
              const manual = cfg.get('drivePath', '');
              const drivePath = auto ? await findRP2Drive() : (manual || await findRP2Drive());

              if (!drivePath) {
                throw new Error(
                  'RPI-RP2 drive not found. Try increasing "bootloaderWaitMs" in settings, or set the drive path manually.'
                );
              }

              log(`Found drive: ${drivePath}`);
              progress.report({ message: `📋 Copying UF2 to ${drivePath}…`, increment: 30 });
              await copyUF2(uf2Path, drivePath);

              progress.report({ message: '✅ Done!', increment: 10 });
              log('Flash complete!');
            }
          );

          // Success: button turns green briefly then back to normal
          statusBarFlash.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
          statusBarFlash.text = '$(check) Flashed!';
          vscode.window.showInformationMessage('RP2040 flashed successfully! 🎉');
          await delay(2500);

        } finally {
          statusBarFlash.backgroundColor = undefined;
          statusBarFlash.text = '$(zap) Flash';
        }

      } catch (err) {
        statusBarFlash.backgroundColor = undefined;
        statusBarFlash.text = '$(zap) Flash';
        log(`ERROR: ${err.message}`);
        vscode.window.showErrorMessage(`RP2040 Flash failed: ${err.message}`);
      }
    }
  );

  // ── Command: Reset Only ───────────────────────────────────────────────────
  const resetCmd = vscode.commands.registerCommand(
    'rp2040-autoflash.resetOnly',
    async () => {
      try {
        const port = await resolvePort();
        if (!port) return;
        log(`Sending 1200bps reset on ${port}…`);
        await resetRP2040(port);
        vscode.window.showInformationMessage(`RP2040 reset to bootloader on ${port}`);
      } catch (err) {
        log(`ERROR: ${err.message}`);
        vscode.window.showErrorMessage(`Reset failed: ${err.message}`);
      }
    }
  );

  // ── Command: Pick UF2 ────────────────────────────────────────────────────
  const pickUF2Cmd = vscode.commands.registerCommand(
    'rp2040-autoflash.pickUF2',
    async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'UF2 Files': ['uf2'] },
        title: 'Select UF2 file to flash',
      });
      if (uris && uris[0]) {
        const p = uris[0].fsPath;
        await vscode.workspace
          .getConfiguration('rp2040-autoflash')
          .update('uf2Path', p, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`UF2 path set to: ${p}`);
      }
    }
  );

  // Watch config changes (if user edits settings.json directly)
  const cfgWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('rp2040-autoflash.serialPort')) {
      const port = vscode.workspace
        .getConfiguration('rp2040-autoflash')
        .get('serialPort', '');
      selectedPort = port;
      updatePortStatusBar(port);
    }
  });

  context.subscriptions.push(
    flashCmd, resetCmd, pickPortCmd, pickUF2Cmd,
    statusBarPort, statusBarFlash, cfgWatcher
  );

  log('RP2040 Auto Flash extension activated.');
}

// ── Status Bar Helpers ────────────────────────────────────────────────────────

function updatePortStatusBar(port) {
  if (!statusBarPort) return;
  if (port) {
    statusBarPort.text = `$(plug) ${port}`;
    statusBarPort.tooltip = `RP2040 port: ${port} — Click to change`;
    statusBarPort.backgroundColor = undefined;
  } else {
    statusBarPort.text = '$(plug) No Port';
    statusBarPort.tooltip = 'RP2040: Click to select COM port';
    statusBarPort.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveUF2Path(uri) {
  if (uri && uri.fsPath) return uri.fsPath;
  const cfg = vscode.workspace.getConfiguration('rp2040-autoflash').get('uf2Path', '');
  if (cfg) return cfg;
  const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
  if (active && active.endsWith('.uf2')) return active;
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'UF2 Files': ['uf2'] },
    title: 'Select UF2 file to flash to RP2040',
  });
  return uris?.[0]?.fsPath ?? null;
}

async function resolvePort() {
  if (selectedPort) return selectedPort;
  const cfg = vscode.workspace.getConfiguration('rp2040-autoflash').get('serialPort', '');
  if (cfg) { selectedPort = cfg; return cfg; }
  return pickPortInteractive();
}

async function pickPortInteractive() {
  log('Scanning for serial ports…');
  const ports = await listRP2040Ports();

  if (ports.length === 0) {
    vscode.window.showErrorMessage(
      'No serial ports found. Make sure the RP2040 is connected and running firmware with USB serial (stdio_usb_init).'
    );
    return null;
  }

  const items = ports.map((p) => ({
    label: `$(plug) ${p.path}`,
    description: p.description || '',
    portPath: p.path,
  }));

  // Add "Enter manually" option
  items.push({ label: '$(edit) Enter port manually…', description: '', portPath: '__manual__' });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select RP2040 serial port',
    title: 'RP2040 Auto Flash — Select COM Port',
  });

  if (!picked) return null;

  if (picked.portPath === '__manual__') {
    const manual = await vscode.window.showInputBox({
      prompt: 'Enter serial port path',
      placeHolder: 'e.g. COM3  or  /dev/ttyACM0',
      title: 'RP2040: Manual Port Entry',
    });
    return manual?.trim() || null;
  }

  return picked.portPath;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function deactivate() {}

module.exports = { activate, deactivate };
