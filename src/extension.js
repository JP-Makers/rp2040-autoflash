// RP2040 Auto Flash Extension — src/extension.js
// Implements the 1200bps DTR trick to auto-reset RP2040 into bootloader mode,
// then copies the UF2 file to the RPI-RP2 drive — just like Arduino IDE does.

'use strict';

const vscode = require('vscode');
const { resetRP2040, listRP2040Ports } = require('./reset');
const { findRP2Drive, copyUF2 }        = require('./flash');
const { log, showOutput }              = require('./output');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  showOutput(); // create output channel early

  // ── Command: Auto Flash UF2 ────────────────────────────────────────────────
  const flashCmd = vscode.commands.registerCommand(
    'rp2040-autoflash.flash',
    async (uri) => {
      try {
        const uf2Path = await resolveUF2Path(uri);
        if (!uf2Path) return;

        const port = await resolvePort();
        if (!port) return;

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'RP2040 Auto Flash',
            cancellable: false,
          },
          async (progress) => {
            // Step 1 — reset into bootloader
            progress.report({ message: '⚡ Resetting RP2040 via 1200bps trick…', increment: 0 });
            log(`Resetting on port: ${port}`);
            await resetRP2040(port);
            log('Reset pulse sent.');

            // Step 2 — wait for RPI-RP2 drive
            const waitMs = vscode.workspace
              .getConfiguration('rp2040-autoflash')
              .get('bootloaderWaitMs', 3000);

            progress.report({ message: `⏳ Waiting for RPI-RP2 drive (${waitMs / 1000}s)…`, increment: 30 });
            log(`Waiting ${waitMs}ms for bootloader drive…`);
            await delay(waitMs);

            // Step 3 — find the drive
            progress.report({ message: '🔍 Locating RPI-RP2 drive…', increment: 30 });
            const cfg   = vscode.workspace.getConfiguration('rp2040-autoflash');
            const auto  = cfg.get('autoDetectDrive', true);
            const manual = cfg.get('drivePath', '');

            const drivePath = auto ? await findRP2Drive() : (manual || await findRP2Drive());

            if (!drivePath) {
              vscode.window.showErrorMessage(
                'RP2040 Auto Flash: Could not find RPI-RP2 drive. ' +
                'Try increasing "bootloaderWaitMs" in settings, or set the drive path manually.'
              );
              log('ERROR: RPI-RP2 drive not found.');
              return;
            }

            log(`Found drive: ${drivePath}`);

            // Step 4 — copy UF2
            progress.report({ message: `📋 Copying UF2 to ${drivePath}…`, increment: 30 });
            await copyUF2(uf2Path, drivePath);

            progress.report({ message: '✅ Done!', increment: 10 });
            log('Flash complete!');
            vscode.window.showInformationMessage('RP2040 flashed successfully! 🎉');
          }
        );
      } catch (err) {
        log(`ERROR: ${err.message}`);
        vscode.window.showErrorMessage(`RP2040 Auto Flash failed: ${err.message}`);
      }
    }
  );

  // ── Command: Reset Only ────────────────────────────────────────────────────
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

  // ── Command: Pick Port ─────────────────────────────────────────────────────
  const pickPortCmd = vscode.commands.registerCommand(
    'rp2040-autoflash.pickPort',
    async () => {
      const port = await pickPortInteractive();
      if (port) {
        await vscode.workspace
          .getConfiguration('rp2040-autoflash')
          .update('serialPort', port, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`RP2040 port set to: ${port}`);
      }
    }
  );

  // ── Command: Pick UF2 ─────────────────────────────────────────────────────
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

  context.subscriptions.push(flashCmd, resetCmd, pickPortCmd, pickUF2Cmd);
  log('RP2040 Auto Flash extension activated.');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveUF2Path(uri) {
  // 1. File right-clicked in explorer
  if (uri && uri.fsPath) return uri.fsPath;

  // 2. Configured path
  const cfg = vscode.workspace.getConfiguration('rp2040-autoflash').get('uf2Path', '');
  if (cfg) return cfg;

  // 3. Active editor is a .uf2 (unlikely but possible)
  const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
  if (active && active.endsWith('.uf2')) return active;

  // 4. Ask user
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'UF2 Files': ['uf2'] },
    title: 'Select UF2 file to flash to RP2040',
  });
  return uris?.[0]?.fsPath ?? null;
}

async function resolvePort() {
  const cfg = vscode.workspace.getConfiguration('rp2040-autoflash').get('serialPort', '');
  if (cfg) return cfg;
  return pickPortInteractive();
}

async function pickPortInteractive() {
  log('Scanning for serial ports…');
  const ports = await listRP2040Ports();

  if (ports.length === 0) {
    vscode.window.showErrorMessage(
      'No serial ports found. Make sure the RP2040 is connected and has a USB serial CDC interface running.'
    );
    return null;
  }

  const items = ports.map((p) => ({
    label: p.path,
    description: p.manufacturer || p.pnpId || '',
    detail: p.serialNumber ? `S/N: ${p.serialNumber}` : undefined,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select RP2040 serial port',
    title: 'RP2040 Auto Flash — Select Port',
  });

  return picked?.label ?? null;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function deactivate() {}

module.exports = { activate, deactivate };
