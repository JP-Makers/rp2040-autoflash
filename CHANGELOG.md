# What's New?

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