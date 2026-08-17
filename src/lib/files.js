// Storage layer. In the desktop app this talks to the real filesystem through
// the Rust commands in src-tauri; in a plain browser it falls back to an
// in-memory demo workspace so the UI can be tried without installing anything.

export const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const DEMO_DIR = '/demo-notes'

async function invoke(cmd, args) {
  const core = await import('@tauri-apps/api/core')
  return core.invoke(cmd, args)
}

// Normalizes a backend entry ({ path, rel }) into what the UI renders.
function toEntry(raw) {
  const rel = raw.rel.replace(/\\/g, '/')
  const name = rel.split('/').pop()
  const dir = rel.includes('/') ? rel.slice(0, rel.length - name.length - 1) : ''
  return {
    path: raw.path,
    rel,
    name,
    dir,
    title: name.replace(/\.(md|markdown)$/i, ''),
  }
}

export async function pickFolder() {
  if (IS_TAURI) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    return open({ directory: true, title: 'Choose a notes folder' })
  }
  return DEMO_DIR
}

export async function listFiles(dir) {
  if (IS_TAURI) {
    const entries = await invoke('list_markdown_files', { dir })
    return entries.map(toEntry)
  }
  // Match the Rust command: only markdown files surface in the sidebar
  // (keeps e.g. the sync manifest invisible).
  return [...demoStore.keys()]
    .filter((rel) => /\.(md|markdown)$/i.test(rel))
    .sort((a, b) => a.localeCompare(b))
    .map((rel) => toEntry({ path: `${DEMO_DIR}/${rel}`, rel }))
}

export async function readFile(path) {
  if (IS_TAURI) return invoke('read_text_file', { path })
  const rel = demoRel(path)
  if (!demoStore.has(rel)) throw new Error(`No such note: ${path}`)
  return demoStore.get(rel)
}

export async function writeFile(path, content) {
  if (IS_TAURI) return invoke('write_text_file', { path, content })
  demoStore.set(demoRel(path), content)
}

export async function createFile(dir, name) {
  if (IS_TAURI) return invoke('create_markdown_file', { dir, name })
  const clean = name.trim().replace(/[\\/]/g, '-')
  if (!clean) throw new Error('Give the note a name first.')
  const rel = /\.(md|markdown)$/i.test(clean) ? clean : `${clean}.md`
  if (demoStore.has(rel)) throw new Error('A note with that name already exists.')
  demoStore.set(rel, `# ${rel.replace(/\.(md|markdown)$/i, '')}\n\n`)
  return `${dir}/${rel}`
}

export async function deleteFile(path) {
  if (IS_TAURI) return invoke('delete_file', { path })
  const rel = demoRel(path)
  if (!demoStore.has(rel)) throw new Error(`No such note: ${path}`)
  demoStore.delete(rel)
}

export async function renameFile(path, name) {
  if (IS_TAURI) return invoke('rename_markdown_file', { path, name })
  const rel = demoRel(path)
  if (!demoStore.has(rel)) throw new Error(`No such note: ${path}`)
  const clean = name.trim().replace(/[\\/]/g, '-')
  if (!clean) throw new Error('Give the note a name first.')
  const file = /\.(md|markdown)$/i.test(clean) ? clean : `${clean}.md`
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : ''
  const newRel = dir + file
  if (newRel === rel) return path
  if (demoStore.has(newRel)) throw new Error('A note with that name already exists.')
  demoStore.set(newRel, demoStore.get(rel))
  demoStore.delete(rel)
  return `${DEMO_DIR}/${newRel}`
}

// Open the system file manager with the note highlighted. Desktop only.
export async function revealFile(path) {
  if (!IS_TAURI) return
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  return revealItemInDir(path)
}

export async function confirmDialog(message, { title, okLabel } = {}) {
  if (IS_TAURI) {
    const { ask } = await import('@tauri-apps/plugin-dialog')
    return ask(message, { title, kind: 'warning', okLabel, cancelLabel: 'Cancel' })
  }
  return window.confirm(message)
}

export async function alertDialog(message, { title } = {}) {
  if (IS_TAURI) {
    const { message: show } = await import('@tauri-apps/plugin-dialog')
    return show(message, { title, kind: 'error' })
  }
  window.alert(message)
}

export async function openExternal(url) {
  if (IS_TAURI) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    return openUrl(url)
  }
  window.open(url, '_blank', 'noopener')
}

/* ─── Browser demo workspace ─────────────────────────────────────── */

const demoRel = (path) => path.slice(DEMO_DIR.length + 1)

const WELCOME = `# Welcome to Bluebird Writer

A quiet, fast place to write. Your notes are plain \`.md\` files in a folder you
choose — nothing hidden, nothing locked in.

## The basics

- **Write** on the left, or press \`Ctrl+E\` to cycle Write → Split → Preview
- Notes **save themselves** about a second after you stop typing (\`Ctrl+S\` if impatient)
- \`Ctrl+B\` tucks the sidebar away

## Markdown, the short version

Type \`#\` for a heading, \`**bold**\` for **bold**, \`*italic*\` for *italic*.

> Blockquotes look like this.

1. Ordered lists
2. Continue themselves when you press Enter

- [ ] Task lists render as checkboxes in the preview
- [x] Like this

\`\`\`js
const code = 'fenced blocks keep their formatting'
\`\`\`

| Tables | Work too |
| ------ | -------- |
| Left   | Right    |

---

Made to pair with **Bluebird Documentation** — import any of these files there
when you want them in your team workspace.
`

const IDEAS = `# Ideas

A scratchpad. Everything here is just a markdown file on disk.

- Draft release notes here, then import them into Bluebird Documentation
- Keep meeting notes per project in subfolders
`

const SHORTCUTS = `# Shortcuts

| Keys | Action |
| ---- | ------ |
| Ctrl+S | Save now |
| Ctrl+E | Cycle Write / Split / Preview |
| Ctrl+B | Toggle sidebar |
`

const demoStore = new Map([
  ['welcome.md', WELCOME],
  ['ideas.md', IDEAS],
  ['guides/shortcuts.md', SHORTCUTS],
])
