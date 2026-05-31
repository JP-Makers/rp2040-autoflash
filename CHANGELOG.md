# What's New?

## 1.0.2

### Added
- **Auto-detect RP2040 port on startup** — scans all serial ports and automatically selects any device with Raspberry Pi USB Vendor ID (`2e8a`), or whose name contains `pico`, `rp2040`, or `raspberry`. No manual port selection needed on first launch.
- **Live port monitor** — polls connected ports every 3 seconds. Detects when an RP2040 is plugged in and auto-selects it. Detects when the board disconnects and clears the selection, then re-scans automatically.
- **Auto-detect UF2 from workspace** — on activation, scans the workspace for `*.uf2` files and preselects the most relevant one. Prefers files inside a `build/` folder (standard CMake/ninja output location).
- **UF2 file watcher** — watches `**/*.uf2` in the workspace. When a new UF2 is created or updated (e.g. after a CMake build), the extension triggers a flash automatically or shows a **"Flash Now"** notification button.
- **`autoFlashOnBuild` setting** — when set to `true`, flashing happens immediately after a new UF2 is detected without any prompt. Default: `false` (shows notification button instead).
- **Status bar updates live** — port item shows `⟳ Detecting…` while scanning and updates to the port name as soon as one is found.

### Changed
- `resolvePort()` now performs a fresh auto-detect scan before prompting the user, reducing manual selection steps.
- `resolveUF2()` calls `autoDetectUF2()` as a fallback before opening the file picker.
- Port is saved to `.vscode/settings.json` automatically after auto-detection (not just after manual selection).

---

## 1.0.1

### Added
- **Status bar COM port selector** — a `$(plug) COM3` item appears in the VS Code status bar (bottom right, near the Pico SDK 2.2.0 and Board: pico items). Click it to open the port QuickPick list. Turns orange when no port is selected.
- **Status bar Flash button** — a `$(zap) Flash` button sits next to the port selector. One click triggers the full flash sequence without opening the Command Palette.
- **Flash button states** — the button changes appearance during the flash cycle:
  - `$(sync~spin) Flashing…` with warning background while resetting and copying
  - `$(check) Flashed!` with success background for 2.5 seconds on completion
  - Returns to `$(zap) Flash` after success or on error
- **Manual port entry** — the port QuickPick list includes an `$(edit) Enter manually…` option for typing a port path directly (useful for non-standard paths).
- **Config watcher** — if the user edits `serialPort` in `settings.json` directly, the status bar updates immediately without reloading the window.

### Changed
- Status bar port item tooltip shows the current port name and a hint to click to change it.
- Selected port is now stored in module scope and restored from workspace config on activation.

---