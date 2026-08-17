# Bluebird Writer

A minimal, offline-first markdown editor for the Bluebird Suite (directory
name `bluebird-markdown/` predates the rename). Notes are
plain `.md` files in a folder you choose — no account, no backend, no lock-in.
Write offline, then import files into Bluebird Documentation whenever you want
them in a team workspace.

**Stack:** Vite + React 19 + Tauri 2 (same pattern as `bluebird-focus`).
Runs on Linux and Windows.

## Features

- Pick any folder; every `.md`/`.markdown` file in it (subfolders included)
  shows in the sidebar — searchable by title, and organized into collapsible
  sections once you sync: local **Notes**, **Bluebird · Personal**, and one
  section per team workspace
- Manage notes from the sidebar (right-click or the `⋯` button): rename,
  duplicate, show in folder, and delete — deletes go to the system trash
  after a confirmation, never a hard delete
- CodeMirror editor with inline markdown styling; Write / Split / Preview modes
- Autosave ~1s after you stop typing (`Ctrl+S` to force), plus save-on-blur
- Create new notes from the sidebar
- Built-in searchable Markdown guide (`Ctrl+G`) that opens beside the editor
- Pull your Bluebird Documentation docs into the workspace as Markdown (cloud
  button). Two kinds of connections, matching the two document stores:
  a personal key (`bb_…`, Account → API keys) for your own Spaces/Pages, and
  one workspace key per team workspace (`bbw_…`, Workspace Settings → API
  keys) — the key's workspace is auto-detected on connect. Use **read-scope**
  keys. Pick what to sync with search, source (personal/workspace) and
  Space/Page filters, plus per-source select-all. Personal notes land in
  `Bluebird/`, team notes in
  `Bluebird/Workspaces/<label>/`, tracked in `.bbw-sync.json`. Pulling is
  review-based: after comparing, every differing note shows a diff and must be
  approved individually — unapproved notes are never touched. The reverse
  direction (local → Bluebird) lives in the Bluebird Documentation web app
  with the same per-document approval flow — "Pull from Writer" in the header
  menu for personal docs, and per-workspace in Workspace Settings for team
  docs — so this app never needs a write-scoped key.
- Dark, light, and paper themes (paper: parchment surfaces, ink accent, serif
  prose, subtle grain), suite design language, bundled fonts (fully offline)
- Remembers your folder, last open note, theme, view mode, and guide state

Shortcuts: `Ctrl+S` save · `Ctrl+E` cycle view mode · `Ctrl+B` toggle sidebar ·
`Ctrl+G` toggle the Markdown guide.

## Development

```bash
npm install
npm run dev        # browser demo on http://localhost:5175 (in-memory files)
npm run tauri:dev  # real desktop app (use tauri:dev:linux on Linux/X11)
```

The browser build runs against an in-memory demo workspace — handy for UI work
without the Rust toolchain. Real file access only exists in the Tauri shell
(four Rust commands in `src-tauri/src/lib.rs`).

### One-time toolchain setup (Linux)

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
```

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Release builds

Linux (AppImage, mirrors `bluebird-focus`):

```bash
source ~/.cargo/env && NO_STRIP=1 npm run tauri:build -- --bundles appimage
```

Windows: install Rust (rustup) and the Visual Studio C++ Build Tools, then run
`npm run tauri:build` on a Windows machine — it produces an NSIS installer.
WebView2 ships with Windows 11 and the installer bootstraps it on older
systems. Cross-compiling from Linux is not supported by Tauri; use a Windows
box or CI.

## Distribution

Same pattern as `bluebird-focus` — GitHub Releases on
[YomenT/bluebird-writer](https://github.com/YomenT/bluebird-writer):

```bash
# 1. Build the AppImage (Linux)
source ~/.cargo/env && NO_STRIP=1 npm run tauri:build -- --bundles appimage

# 2. Bundle it with the installer into a release tarball
./package-release.sh   # → bluebird-writer_<version>_linux.tar.gz
```

Upload the tarball to a GitHub Release. Users extract it and run
`./install.sh`, which installs to `~/.local/bin` with a desktop entry and
icon — no root needed. Updating is re-running the installer from a newer
tarball.

Alternatively, pushing a `v*` tag runs `.github/workflows/release.yml`, which
builds the Linux bundles **and** the Windows NSIS installer on CI and attaches
everything to a draft release — publish after review. Remember to bump the
version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`install.sh`, and `package-release.sh` together.

The app is linked from the Bluebird Suite menu in the Bluebird Documentation
header.

## Deliberately out of scope (for now)

Kept intentionally small: no tabs, no plugins, no mobile build. Sync is
pull-only in both directions by design — Writer never holds write credentials
for Bluebird Documentation.
