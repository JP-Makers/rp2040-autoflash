# RP2040 Auto Flash — VS Code Extension

Auto-flash your Raspberry Pi Pico / RP2040 UF2 files from VS Code **without pressing BOOTSEL** — exactly like Arduino IDE does.

## How It Works

This extension replicates the **1200bps DTR magic trick** used by the Arduino-Pico core (`uf2conv.py`):

1. Opens your RP2040's serial COM port at 9600 baud
2. Asserts **DTR** (Data Terminal Ready)
3. Waits ~100ms
4. Clears DTR
5. Switches to **1200 baud** and closes the port
6. The RP2040 firmware detects this sequence and reboots into **USB bootloader mode**
7. Extension waits for the **RPI-RP2** USB drive to appear
8. Copies your `.uf2` file to the drive → RP2040 flashes itself and reboots ✅

> ⚠️ This trick requires that your RP2040 firmware exposes a **USB CDC serial interface**. If your firmware has no USB serial, the board must be reset manually the first time (hold BOOTSEL while plugging in), then flash via this extension — from that point on auto-reset works as long as your firmware includes USB serial.

---

## Installation

### From VSIX (manual install)

```bash
# 1. Clone / download this extension folder
# 2. Install dependencies
npm install

# 3. Package it
npm run package
# → produces rp2040-autoflash-1.0.0.vsix

# 4. Install in VS Code
code --install-extension rp2040-autoflash-1.0.0.vsix
```

### From VS Code

`Ctrl+Shift+P` → **Extensions: Install from VSIX…** → select the `.vsix` file.

---

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and search for **RP2040**:

| Command | Description |
|---|---|
| `RP2040: Auto Flash UF2` | Reset board + copy UF2 — full one-click flash |
| `RP2040: Reset to Bootloader` | Send the 1200bps pulse only (no file copy) |
| `RP2040: Select Serial Port` | Choose and save the COM port for this workspace |
| `RP2040: Select UF2 File` | Choose and save the UF2 path for this workspace |

### Right-click shortcut

Right-click any `.uf2` file in the **Explorer** sidebar → **RP2040: Auto Flash UF2**

---

## Settings

Open **Settings** (`Ctrl+,`) and search for `rp2040`:

| Setting | Default | Description |
|---|---|---|
| `rp2040-autoflash.serialPort` | _(empty)_ | COM port (e.g. `COM3`, `/dev/ttyACM0`). Empty = pick each time |
| `rp2040-autoflash.uf2Path` | _(empty)_ | Path to UF2 file. Empty = pick each time |
| `rp2040-autoflash.bootloaderWaitMs` | `3000` | Milliseconds to wait for RPI-RP2 drive to appear after reset |
| `rp2040-autoflash.autoDetectDrive` | `true` | Auto-detect the RPI-RP2 USB drive |
| `rp2040-autoflash.drivePath` | _(empty)_ | Manual drive path (e.g. `D:\` or `/media/user/RPI-RP2`) |

### workspace `.vscode/settings.json` example

```json
{
  "rp2040-autoflash.serialPort": "/dev/ttyACM0",
  "rp2040-autoflash.uf2Path": "${workspaceFolder}/build/firmware.uf2",
  "rp2040-autoflash.bootloaderWaitMs": 3000
}
```

---

## Supported Platforms

| Platform | Status |
|---|---|
| Windows 10/11 | ✅ Full support |
| macOS | ✅ Full support |
| Linux (Ubuntu, Debian, Fedora) | ✅ Full support |

### Linux: udev rule (avoid `sudo`)

Add this rule so VS Code can access serial ports without root:

```bash
echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="2e8a", MODE="0666"' | sudo tee /etc/udev/rules.d/99-rp2040.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

---

## Workflow with Pico SDK / CMake

```bash
# Build your firmware (CMake)
cd build && cmake .. && make -j4

# The extension will find build/firmware.uf2 automatically if you set uf2Path
# Or right-click firmware.uf2 in VS Code Explorer → RP2040: Auto Flash UF2
```

### Combine with a VS Code Task (`.vscode/tasks.json`)

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Build & Flash RP2040",
      "type": "shell",
      "command": "cd build && make -j4",
      "group": { "kind": "build", "isDefault": true },
      "presentation": { "reveal": "always" },
      "dependsOn": [],
      "postBuild": {
        "command": "rp2040-autoflash.flash"
      }
    }
  ]
}
```

---

## Troubleshooting

**"No serial ports found"**
- Make sure your RP2040 firmware includes a USB CDC serial interface (`stdio_usb_init()` in C SDK, or `import usb_cdc` in CircuitPython).
- On Linux, add your user to the `dialout` group: `sudo usermod -aG dialout $USER` then log out/in.

**"Could not find RPI-RP2 drive"**
- Increase `bootloaderWaitMs` to `5000` or more.
- On Windows, check Device Manager — the drive should appear as a removable disk.
- Set `drivePath` manually if auto-detect fails.

**Reset works but board stays in bootloader**
- The UF2 file may be corrupt or built for a different board. Verify with `picotool info firmware.uf2`.

---

[![VSCODE](https://img.shields.io/badge/Download-%20VSIX-5C2D91?style=for-the-badge&logo=visualstudiocode&logoColor=white
)](https://github.com/JP-Makers/rp2040-autoflash)

