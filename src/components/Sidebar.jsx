import { useEffect, useMemo, useState } from 'react'
import { IS_TAURI } from '../lib/files'
import '../css/Sidebar.css'

const MENU_WIDTH = 168
const MENU_HEIGHT = 150 // tallest case; used only to clamp against the viewport
const COLLAPSED_STORAGE = 'bbw:collapsedSections'

// Sort pulled documents into sections by their sync-layout home. Everything
// outside Bluebird/ is a plain local note.
function groupFiles(files) {
  const local = []
  const personal = []
  const workspaces = new Map()
  for (const f of files) {
    if (f.rel.startsWith('Bluebird/Workspaces/')) {
      const rest = f.rel.slice('Bluebird/Workspaces/'.length)
      const slash = rest.indexOf('/')
      if (slash === -1) {
        personal.push(f) // stray file directly in Workspaces/
        continue
      }
      const label = rest.slice(0, slash)
      if (!workspaces.has(label)) workspaces.set(label, [])
      workspaces.get(label).push(f)
    } else if (f.rel.startsWith('Bluebird/')) {
      personal.push(f)
    } else {
      local.push(f)
    }
  }
  return { local, personal, workspaces }
}

// Subtitle shown under a note: its folder relative to the section root.
function dirWithin(f, base) {
  if (!f.dir) return ''
  if (!base) return f.dir
  return f.dir === base ? '' : f.dir.startsWith(`${base}/`) ? f.dir.slice(base.length + 1) : f.dir
}

function loadCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE)) || [])
  } catch {
    return new Set()
  }
}

export default function Sidebar({
  folderName,
  files,
  activePath,
  onSelect,
  onCreate,
  onChangeFolder,
  onRename,
  onDuplicate,
  onDelete,
  onReveal,
}) {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(null) // { file, x, y }
  const [renaming, setRenaming] = useState(null) // path of the file being renamed
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState('')
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [search, setSearch] = useState('')

  // Title search: filter before grouping so section counts reflect matches.
  // Also matches the folder path, so "guides/" finds notes filed there.
  const query = search.trim().toLowerCase()
  const visibleFiles = useMemo(
    () => (query ? files.filter((f) => f.rel.toLowerCase().includes(query)) : files),
    [files, query]
  )

  const groups = useMemo(() => groupFiles(visibleFiles), [visibleFiles])
  // No pulled docs → no headers, just the plain flat list.
  const grouped = groups.personal.length > 0 || groups.workspaces.size > 0

  const toggleSection = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(COLLAPSED_STORAGE, JSON.stringify([...next]))
      return next
    })
  }

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e) => e.key === 'Escape' && setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const submit = async () => {
    const name = draft.trim()
    if (!name) {
      setCreating(false)
      setError('')
      return
    }
    try {
      await onCreate(name)
      setDraft('')
      setError('')
      setCreating(false)
    } catch (err) {
      setError(String(err?.message || err))
    }
  }

  const openMenuAt = (file, x, y) => {
    setMenu({
      file,
      x: Math.min(x, window.innerWidth - MENU_WIDTH - 8),
      y: Math.min(y, window.innerHeight - MENU_HEIGHT - 8),
    })
  }

  const startRename = (file) => {
    setMenu(null)
    setRenaming(file.path)
    setRenameDraft(file.title)
    setRenameError('')
  }

  const stopRename = () => {
    setRenaming(null)
    setRenameDraft('')
    setRenameError('')
  }

  const submitRename = async () => {
    const file = files.find((f) => f.path === renaming)
    const name = renameDraft.trim()
    if (!file || !name || name === file.title) {
      stopRename()
      return
    }
    try {
      await onRename(file, name)
      stopRename()
    } catch (err) {
      setRenameError(String(err?.message || err))
    }
  }

  const sectionIcon = (kind) => {
    if (kind === 'cloud') {
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 19a4.5 4.5 0 0 0 .42-8.98 6 6 0 0 0-11.7 1.62A4 4 0 0 0 6.5 19z" />
        </svg>
      )
    }
    if (kind === 'team') {
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="10" cy="7" r="3.5" />
          <path d="M21 21v-2a4 4 0 0 0-3-3.87M15.5 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    }
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3v5a1 1 0 0 0 1 1h5" />
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
      </svg>
    )
  }

  const renderRow = (f, dirBase) =>
    renaming === f.path ? (
      <div key={f.path} className="Sidebar__create Sidebar__create--rename">
        <input
          className="Sidebar__create-input"
          value={renameDraft}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setRenameDraft(e.target.value)
            setRenameError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitRename()
            if (e.key === 'Escape') stopRename()
          }}
          onBlur={() => {
            if (!renameDraft.trim() || renameDraft.trim() === files.find((x) => x.path === renaming)?.title) {
              stopRename()
            }
          }}
        />
        {renameError && <div className="Sidebar__create-error">{renameError}</div>}
      </div>
    ) : (
      <div
        key={f.path}
        className={`Sidebar__item${f.path === activePath ? ' Sidebar__item--active' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault()
          openMenuAt(f, e.clientX, e.clientY)
        }}
      >
        <button className="Sidebar__item-main" title={f.rel} onClick={() => onSelect(f.path)}>
          <span className="Sidebar__item-title">{f.title}</span>
          {dirWithin(f, dirBase) && <span className="Sidebar__item-dir">{dirWithin(f, dirBase)}</span>}
        </button>
        <button
          className="Sidebar__item-dots"
          title="Note actions"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            openMenuAt(f, rect.right - MENU_WIDTH, rect.bottom + 4)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      </div>
    )

  const renderSection = (id, name, icon, sectionFiles, dirBase) => {
    if (!sectionFiles.length) return null
    // While searching, collapsed sections open up so matches are never hidden.
    const isCollapsed = collapsed.has(id) && !query
    return (
      <div key={id} className="Sidebar__section">
        <button
          className="Sidebar__section-head"
          aria-expanded={!isCollapsed}
          onClick={() => toggleSection(id)}
        >
          <svg
            className={`Sidebar__section-chevron${isCollapsed ? ' Sidebar__section-chevron--closed' : ''}`}
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          <span className={`Sidebar__section-icon Sidebar__section-icon--${icon}`}>{sectionIcon(icon)}</span>
          <span className="Sidebar__section-name">{name}</span>
          <span className="Sidebar__section-count">{sectionFiles.length}</span>
        </button>
        {!isCollapsed && sectionFiles.map((f) => renderRow(f, dirBase))}
      </div>
    )
  }

  return (
    <aside className="Sidebar">
      <div className="Sidebar__brand">
        <span className="Sidebar__brand-name">Bluebird</span>
        <span className="Sidebar__brand-app">Writer</span>
      </div>

      <button className="Sidebar__folder" onClick={onChangeFolder} title="Switch folder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
        <span className="Sidebar__folder-name">{folderName}</span>
        <svg className="Sidebar__folder-swap" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3 4 7l4 4" />
          <path d="M4 7h11a5 5 0 0 1 0 10h-1" />
        </svg>
      </button>

      {creating ? (
        <div className="Sidebar__create">
          <input
            className="Sidebar__create-input"
            placeholder="note name"
            value={draft}
            autoFocus
            onChange={(e) => {
              setDraft(e.target.value)
              setError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') {
                setCreating(false)
                setDraft('')
                setError('')
              }
            }}
            onBlur={() => {
              if (!draft.trim()) {
                setCreating(false)
                setError('')
              }
            }}
          />
          {error && <div className="Sidebar__create-error">{error}</div>}
        </div>
      ) : (
        <button className="Sidebar__new" onClick={() => setCreating(true)}>
          + New note
        </button>
      )}

      {files.length > 0 && (
        <div className="Sidebar__searchwrap">
          <svg className="Sidebar__search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="Sidebar__search"
            type="search"
            value={search}
            placeholder="Search notes…"
            aria-label="Search notes by title"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
          />
        </div>
      )}

      <nav className="Sidebar__list">
        {grouped ? (
          <>
            {renderSection('local', 'Notes', 'file', groups.local, '')}
            {renderSection('personal', 'Bluebird · Personal', 'cloud', groups.personal, 'Bluebird')}
            {[...groups.workspaces.keys()].sort((a, b) => a.localeCompare(b)).map((label) =>
              renderSection(
                `ws:${label}`,
                label,
                'team',
                groups.workspaces.get(label),
                `Bluebird/Workspaces/${label}`
              )
            )}
          </>
        ) : (
          visibleFiles.map((f) => renderRow(f, ''))
        )}
        {files.length === 0 && (
          <div className="Sidebar__empty">No markdown files here yet.</div>
        )}
        {files.length > 0 && query && visibleFiles.length === 0 && (
          <div className="Sidebar__empty">No notes match “{search.trim()}”.</div>
        )}
      </nav>

      <div className="Sidebar__foot">
        {files.length} {files.length === 1 ? 'note' : 'notes'}
      </div>

      {menu && (
        <div
          className="Sidebar__menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="Sidebar__menu-item" onClick={() => startRename(menu.file)}>
            Rename
          </button>
          <button
            className="Sidebar__menu-item"
            onClick={() => {
              onDuplicate(menu.file)
              setMenu(null)
            }}
          >
            Duplicate
          </button>
          {IS_TAURI && (
            <button
              className="Sidebar__menu-item"
              onClick={() => {
                onReveal(menu.file)
                setMenu(null)
              }}
            >
              Show in folder
            </button>
          )}
          <button
            className="Sidebar__menu-item Sidebar__menu-item--danger"
            onClick={() => {
              onDelete(menu.file)
              setMenu(null)
            }}
          >
            {IS_TAURI ? 'Move to trash' : 'Delete'}
          </button>
        </div>
      )}
    </aside>
  )
}
