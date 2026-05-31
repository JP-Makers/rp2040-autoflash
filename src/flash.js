// src/flash.js
// Finds the RPI-RP2 USB mass-storage drive and copies the UF2 file to it.
// Supports Windows, macOS, and Linux.

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { log }      = require('./output');

const DRIVE_NAME = 'RPI-RP2';

/**
 * Find the mounted RPI-RP2 bootloader drive.
 * Returns the drive/mount path, or null if not found.
 * @returns {Promise<string|null>}
 */
async function findRP2Drive() {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      return findDriveWindows();
    } else if (platform === 'darwin') {
      return findDriveMac();
    } else {
      return findDriveLinux();
    }
  } catch (err) {
    log(`Drive detection error: ${err.message}`);
    return null;
  }
}

/** Windows: scan drive letters A-Z for INFO_UF2.TXT or volume label RPI-RP2 */
function findDriveWindows() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  for (const letter of letters) {
    const drive = `${letter}:\\`;
    try {
      // Check for INFO_UF2.TXT which is always present on a UF2 bootloader drive
      const infoFile = path.join(drive, 'INFO_UF2.TXT');
      if (fs.existsSync(infoFile)) {
        const content = fs.readFileSync(infoFile, 'utf8');
        if (content.includes('RP2')) {
          log(`Found RPI-RP2 drive at ${drive}`);
          return drive;
        }
      }
    } catch (_) {
      // Drive not accessible — skip
    }
  }

  // Fallback: try wmic
  try {
    const out = execSync('wmic logicaldisk get DeviceID,VolumeName', { timeout: 3000 }).toString();
    const lines = out.split('\n');
    for (const line of lines) {
      if (line.includes(DRIVE_NAME)) {
        const match = line.match(/([A-Z]:)/);
        if (match) {
          const drive = match[1] + '\\';
          log(`Found RPI-RP2 via wmic at ${drive}`);
          return drive;
        }
      }
    }
  } catch (_) {}

  return null;
}

/** macOS: check /Volumes/RPI-RP2 */
function findDriveMac() {
  const mountPath = `/Volumes/${DRIVE_NAME}`;
  if (fs.existsSync(mountPath)) {
    log(`Found RPI-RP2 drive at ${mountPath}`);
    return mountPath;
  }

  // Also try lowercase / variations
  try {
    const volumes = fs.readdirSync('/Volumes');
    const match = volumes.find((v) => v.toUpperCase() === DRIVE_NAME);
    if (match) {
      const p = `/Volumes/${match}`;
      log(`Found RPI-RP2 drive at ${p}`);
      return p;
    }
  } catch (_) {}

  return null;
}

/** Linux: check common mount points */
function findDriveLinux() {
  // Common locations
  const candidates = [
    `/media/${process.env.USER || 'user'}/${DRIVE_NAME}`,
    `/media/${DRIVE_NAME}`,
    `/mnt/${DRIVE_NAME}`,
    `/run/media/${process.env.USER || 'user'}/${DRIVE_NAME}`,
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      log(`Found RPI-RP2 drive at ${p}`);
      return p;
    }
  }

  // Parse /proc/mounts as a fallback
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    for (const line of mounts.split('\n')) {
      if (line.toUpperCase().includes(DRIVE_NAME)) {
        const mountPoint = line.split(' ')[1];
        if (mountPoint && fs.existsSync(mountPoint)) {
          log(`Found RPI-RP2 in /proc/mounts at ${mountPoint}`);
          return mountPoint;
        }
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Copy a UF2 file to the bootloader drive.
 * The RP2040 automatically flashes and reboots when the file is fully written.
 * @param {string} uf2Path  - Full path to the .uf2 file
 * @param {string} drivePath - Mount path of RPI-RP2
 */
async function copyUF2(uf2Path, drivePath) {
  const fileName = path.basename(uf2Path);
  const dest     = path.join(drivePath, fileName);

  log(`Copying: ${uf2Path}  →  ${dest}`);

  // Stat source
  const stat = fs.statSync(uf2Path);
  log(`UF2 file size: ${(stat.size / 1024).toFixed(1)} KB`);

  return new Promise((resolve, reject) => {
    const src  = fs.createReadStream(uf2Path);
    const out  = fs.createWriteStream(dest);

    src.on('error', (e) => reject(new Error(`Read error: ${e.message}`)));
    out.on('error', (e) => reject(new Error(`Write error: ${e.message}`)));
    out.on('close', () => {
      log('UF2 copy complete. RP2040 will now flash and reboot automatically.');
      resolve();
    });

    src.pipe(out);
  });
}

module.exports = { findRP2Drive, copyUF2 };
