// src/reset.js
// 1200bps DTR reset trick using Node.js child_process + platform tools.
// No native npm modules needed — avoids serialport binary issues in VSIX.

'use strict';

const { execSync, exec } = require('child_process');
const { log } = require('./output');

/**
 * Reset RP2040 into bootloader using the 1200bps trick.
 * Uses PowerShell (Windows) or Python3 (Mac/Linux) to open the serial port.
 * @param {string} portPath - e.g. "COM3" or "/dev/ttyACM0"
 */
async function resetRP2040(portPath) {
  const platform = process.platform;

  if (platform === 'win32') {
    return resetWindows(portPath);
  } else {
    return resetUnix(portPath);
  }
}

/** Windows: use PowerShell to send the 1200bps pulse */
async function resetWindows(portPath) {
  // PowerShell script: open port at 9600, assert DTR, wait, clear DTR, set 1200, close
  const ps = `
$port = New-Object System.IO.Ports.SerialPort '${portPath}', 9600
$port.Open()
$port.DtrEnable = $true
Start-Sleep -Milliseconds 100
$port.DtrEnable = $false
$port.BaudRate = 1200
Start-Sleep -Milliseconds 50
$port.Close()
Write-Host 'Reset pulse sent.'
`.trim();

  log(`Sending 1200bps reset via PowerShell on ${portPath}…`);

  return new Promise((resolve, reject) => {
    exec(
      `powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
      { timeout: 5000 },
      (err, stdout, stderr) => {
        if (stdout) log(stdout.trim());
        if (stderr) log(`PS stderr: ${stderr.trim()}`);
        if (err && !stdout.includes('Reset pulse')) {
          // Try fallback Python approach
          log('PowerShell approach failed, trying Python fallback…');
          return resetPython(portPath).then(resolve).catch(reject);
        }
        resolve();
      }
    );
  });
}

/** Mac/Linux: use Python3 (always available on these platforms) */
async function resetUnix(portPath) {
  return resetPython(portPath);
}

/** Python3 fallback — works on all platforms if Python is available */
async function resetPython(portPath) {
  const pyScript = `
import serial, time
s = serial.Serial()
s.port = '${portPath}'
s.open()
s.baudrate = 9600
s.dtr = True
time.sleep(0.1)
s.dtr = False
s.baudrate = 1200
time.sleep(0.05)
s.close()
print('Reset pulse sent.')
`.trim();

  log(`Sending 1200bps reset via Python on ${portPath}…`);

  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32'
      ? `python -c "${pyScript.replace(/\n/g, '; ').replace(/"/g, '\\"')}"`
      : `python3 -c '${pyScript.replace(/\n/g, '; ')}'`;

    exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
      if (stdout) log(stdout.trim());
      if (err) {
        log(`Python error: ${stderr || err.message}`);
        return reject(new Error(
          `Could not reset RP2040.\n\n` +
          `Make sure Python 3 with 'pyserial' is installed:\n` +
          `  pip install pyserial\n\n` +
          `Error: ${err.message}`
        ));
      }
      resolve();
    });
  });
}

/**
 * List serial ports using platform tools — no native npm needed.
 * @returns {Promise<Array<{path: string, description: string}>>}
 */
async function listRP2040Ports() {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      return listPortsWindows();
    } else if (platform === 'darwin') {
      return listPortsMac();
    } else {
      return listPortsLinux();
    }
  } catch (e) {
    log(`Port listing error: ${e.message}`);
    return [];
  }
}

function listPortsWindows() {
  const out = execSync(
    'powershell -NoProfile -Command "Get-PnpDevice -Class Ports -Status OK | Select-Object FriendlyName, InstanceId | ConvertTo-Json"',
    { timeout: 5000, encoding: 'utf8' }
  );

  let devices = [];
  try {
    const parsed = JSON.parse(out);
    devices = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) {}

  const ports = devices
    .map((d) => {
      const match = d.FriendlyName?.match(/\(COM\d+\)/);
      const comPort = match ? match[0].replace(/[()]/g, '') : null;
      return comPort ? { path: comPort, description: d.FriendlyName || '' } : null;
    })
    .filter(Boolean);

  // Also try simple mode_con fallback
  if (ports.length === 0) {
    try {
      const out2 = execSync('mode', { encoding: 'utf8', timeout: 3000 });
      const matches = out2.match(/COM\d+/g) || [];
      return [...new Set(matches)].map((p) => ({ path: p, description: '' }));
    } catch (_) {}
  }

  // Sort: RP2040-related ports first
  return ports.sort((a, b) => {
    const aRP = a.description.toLowerCase().includes('pico') || a.description.toLowerCase().includes('rp2');
    const bRP = b.description.toLowerCase().includes('pico') || b.description.toLowerCase().includes('rp2');
    return aRP === bRP ? 0 : aRP ? -1 : 1;
  });
}

function listPortsMac() {
  const out = execSync('ls /dev/tty.* /dev/cu.* 2>/dev/null || true', {
    encoding: 'utf8', timeout: 3000
  });
  return out.trim().split('\n')
    .filter((p) => p && (p.includes('usbmodem') || p.includes('usbserial') || p.includes('ACM')))
    .map((p) => ({ path: p.trim(), description: '' }));
}

function listPortsLinux() {
  const out = execSync('ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null || true', {
    encoding: 'utf8', timeout: 3000
  });
  return out.trim().split('\n')
    .filter(Boolean)
    .map((p) => ({ path: p.trim(), description: '' }));
}

module.exports = { resetRP2040, listRP2040Ports };
