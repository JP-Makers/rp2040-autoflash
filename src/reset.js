// src/reset.js
// 1200bps reset trick for RP2040 — Windows + Mac/Linux
// Fix: Don't change BaudRate after opening — some USB-CDC drivers throw
// "device does not exist" when baud is changed while DTR is being toggled.
// The actual trigger is: open at 1200 baud → assert DTR → close.
// Arduino IDE does the same: it opens a NEW port object at 1200, not update().

'use strict';

const { exec, execSync } = require('child_process');
const { log } = require('./output');

/**
 * Reset RP2040 into bootloader via 1200bps trick.
 * Tries three methods in order until one succeeds.
 */
async function resetRP2040(portPath) {
  log(`Attempting reset on ${portPath}…`);

  // Method 1: PowerShell — open directly at 1200 baud (no baud change)
  if (process.platform === 'win32') {
    try {
      await resetPowerShell(portPath);
      return;
    } catch (e) {
      log(`PowerShell method failed: ${e.message}`);
      log('Trying Python fallback…');
    }

    // Method 2: Python pyserial
    try {
      await resetPython(portPath);
      return;
    } catch (e) {
      log(`Python method failed: ${e.message}`);
      log('Trying .NET direct fallback…');
    }

    // Method 3: .NET via PowerShell (constructor at 1200 directly)
    try {
      await resetDotNet(portPath);
      return;
    } catch (e) {
      throw new Error(
        `All reset methods failed on ${portPath}.\n\n` +
        `Make sure:\n` +
        `1. Your firmware has USB serial (stdio_usb_init)\n` +
        `2. No other app (Serial Monitor, PuTTY) is using ${portPath}\n` +
        `3. Python pyserial is installed: pip install pyserial\n\n` +
        `Last error: ${e.message}`
      );
    }
  } else {
    // Mac / Linux — Python3 is reliable
    await resetPython(portPath);
  }
}

// ── Method 1: PowerShell — open at 1200 baud directly, toggle DTR, close ────
// KEY FIX: We never call $port.BaudRate = 1200 after open.
// Instead we construct the SerialPort object with 1200 from the start.
async function resetPowerShell(portPath) {
  const script = [
    `$p = New-Object System.IO.Ports.SerialPort('${portPath}', 1200, 'None', 8, 'One')`,
    `$p.DtrEnable = $false`,
    `$p.Open()`,
    `$p.DtrEnable = $true`,
    `Start-Sleep -Milliseconds 50`,
    `$p.DtrEnable = $false`,
    `Start-Sleep -Milliseconds 50`,
    `$p.Close()`,
    `$p.Dispose()`,
    `Write-Host 'reset-ok'`
  ].join('; ');

  log('Method 1: PowerShell open-at-1200…');
  return new Promise((resolve, reject) => {
    exec(
      `powershell -NoProfile -NonInteractive -Command "${script}"`,
      { timeout: 6000 },
      (err, stdout, stderr) => {
        const out = stdout.trim();
        if (stderr && !out.includes('reset-ok')) {
          log(`PS stderr: ${stderr.trim()}`);
        }
        if (out.includes('reset-ok')) {
          log('PowerShell reset OK.');
          resolve();
        } else {
          reject(new Error(stderr?.trim() || err?.message || 'No confirmation'));
        }
      }
    );
  });
}

// ── Method 2: Python pyserial ─────────────────────────────────────────────────
async function resetPython(portPath) {
  const py = `
import serial, time
try:
    s = serial.Serial('${portPath}', baudrate=1200, bytesize=8, parity='N', stopbits=1, timeout=1)
    s.dtr = False
    s.dtr = True
    time.sleep(0.05)
    s.dtr = False
    time.sleep(0.05)
    s.close()
    print('reset-ok')
except Exception as e:
    print('ERR:' + str(e))
`.trim().replace(/\n/g, '\n');

  const cmd = process.platform === 'win32'
    ? `python -c "${py.replace(/\n/g,'\\n').replace(/"/g,'\\"')}"`
    : `python3 -c '${py}'`;

  log('Method 2: Python pyserial reset…');
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 6000 }, (err, stdout, stderr) => {
      const out = (stdout || '').trim();
      if (out.includes('reset-ok')) {
        log('Python reset OK.');
        resolve();
      } else if (out.startsWith('ERR:')) {
        reject(new Error(out.replace('ERR:', '')));
      } else {
        reject(new Error(
          err?.message ||
          'pyserial not found — run: pip install pyserial'
        ));
      }
    });
  });
}

// ── Method 3: .NET SerialPort via inline C# compiled at runtime ───────────────
async function resetDotNet(portPath) {
  const cs = `
using System; using System.IO.Ports; using System.Threading;
class R {
  static void Main() {
    var p = new SerialPort("${portPath}", 1200, Parity.None, 8, StopBits.One);
    p.DtrEnable = false;
    p.Open();
    p.DtrEnable = true;
    Thread.Sleep(50);
    p.DtrEnable = false;
    Thread.Sleep(50);
    p.Close();
    Console.WriteLine("reset-ok");
  }
}`.trim();

  const tmpCs  = require('os').tmpdir() + '\\rp2040reset.cs';
  const tmpExe = require('os').tmpdir() + '\\rp2040reset.exe';
  require('fs').writeFileSync(tmpCs, cs);

  log('Method 3: .NET compiled reset…');
  return new Promise((resolve, reject) => {
    // Try csc (C# compiler, part of .NET Framework on all Windows)
    exec(
      `csc /out:"${tmpExe}" "${tmpCs}" && "${tmpExe}"`,
      { timeout: 10000 },
      (err, stdout, stderr) => {
        if ((stdout || '').includes('reset-ok')) {
          log('.NET reset OK.');
          resolve();
        } else {
          reject(new Error(stderr?.trim() || err?.message || 'csc not available'));
        }
      }
    );
  });
}

// ── Port listing ──────────────────────────────────────────────────────────────
async function listRP2040Ports() {
  const p = process.platform;
  try {
    if (p === 'win32')  return listPortsWindows();
    if (p === 'darwin') return listPortsMac();
    return listPortsLinux();
  } catch (e) { log(`Port list error: ${e.message}`); return []; }
}

function listPortsWindows() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-PnpDevice -Class Ports -Status OK | Select-Object FriendlyName | ConvertTo-Json"',
      { timeout: 5000, encoding: 'utf8' }
    );
    let devices = JSON.parse(out);
    if (!Array.isArray(devices)) devices = [devices];
    const ports = devices
      .map(d => {
        const m = d.FriendlyName?.match(/\(COM\d+\)/);
        return m ? { path: m[0].replace(/[()]/g, ''), description: d.FriendlyName } : null;
      })
      .filter(Boolean);

    // Sort: RP2040/Pico first
    return ports.sort((a, b) => {
      const aRP = /pico|rp2/i.test(a.description);
      const bRP = /pico|rp2/i.test(b.description);
      return aRP === bRP ? 0 : aRP ? -1 : 1;
    });
  } catch (_) {
    // Fallback: mode command
    try {
      const out = execSync('mode', { encoding: 'utf8', timeout: 3000 });
      return [...new Set(out.match(/COM\d+/g) || [])].map(p => ({ path: p, description: '' }));
    } catch (_) { return []; }
  }
}

function listPortsMac() {
  try {
    const out = execSync('ls /dev/tty.* /dev/cu.* 2>/dev/null || true', { encoding: 'utf8', timeout: 3000 });
    return out.trim().split('\n')
      .filter(p => p && /usbmodem|usbserial|ACM/i.test(p))
      .map(p => ({ path: p.trim(), description: '' }));
  } catch (_) { return []; }
}

function listPortsLinux() {
  try {
    const out = execSync('ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null || true', { encoding: 'utf8', timeout: 3000 });
    return out.trim().split('\n').filter(Boolean).map(p => ({ path: p.trim(), description: '' }));
  } catch (_) { return []; }
}

module.exports = { resetRP2040, listRP2040Ports };
