import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import Editor from './components/Editor'
import Preview from './components/Preview'
import Guide from './components/Guide'
import SyncPanel from './components/SyncPanel'
import Welcome from './components/Welcome'
import {
  IS_TAURI,
  pickFolder,
  listFiles,
  readFile,
  writeFile,
  createFile,
  deleteFile,
  renameFile,
  revealFile,
  confirmDialog,
  alertDialog,
} from './lib/files'
import { noteLocalRename, noteLocalDelete } from './lib/sync'
import './css/App.css'

const MODES = ['write', 'split', 'preview']
const MODE_LABELS = { write: 'Write', split: 'Split', preview: 'Preview' }
const THEMES = ['dark', 'light', 'paper']
const SAVE_LABELS = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: "Couldn't save",
}

function folderLabel(path) {
  if (!path) return ''
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function wordStats(text) {
  const trimmed = text.trim()
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    chars: text.length,
  }
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('bbw:theme')
    return THEMES.includes(saved) ? saved : 'dark'
  })
  const [mode, setMode] = useState(() => localStorage.getItem('bbw:mode') || 'write')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [guideOpen, setGuideOpen] = useState(() => localStorage.getItem('bbw:guide') === '1')
  const [syncOpen, setSyncOpen] = useState(false)
  const [editorEpoch, setEditorEpoch] = useState(0) // bumped to remount the editor after a pull rewrites the open note

  const [folder, setFolder] = useState(() => (IS_TAURI ? localStorage.getItem('bbw:folder') : null))
  const [files, setFiles] = useState([])
  const [activePath, setActivePath] = useState(null)
  const [initialContent, setInitialContent] = useState(null) // doc handed to the editor on open
  const [content, setContent] = useState('') // live text, drives preview + stats
  const [saveState, setSaveState] = useState('saved')

  // Refs mirror the live document so async saves never work from stale state.
  const activeRef = useRef(null)
  const contentRef = useRef('')
  const savedRef = useRef('')
  const saveTimer = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('bbw:theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('bbw:mode', mode)
  }, [mode])

  useEffect(() => {
    localStorage.setItem('bbw:guide', guideOpen ? '1' : '0')
  }, [guideOpen])

  const flushSave = useCallback(async () => {
    const path = activeRef.current
    if (!path || contentRef.current === savedRef.current) return
    const snapshot = contentRef.current
    setSaveState('saving')
    try {
      await writeFile(path, snapshot)
      savedRef.current = snapshot
      setSaveState(contentRef.current === snapshot ? 'saved' : 'unsaved')
    } catch (err) {
      console.error('Save failed:', err)
      setSaveState('error')
    }
  }, [])

  const handleEdit = useCallback(
    (text) => {
      contentRef.current = text
      setContent(text)
      setSaveState(text === savedRef.current ? 'saved' : 'unsaved')
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flushSave, 900)
    },
    [flushSave]
  )

  const saveNow = useCallback(() => {
    clearTimeout(saveTimer.current)
    return flushSave()
  }, [flushSave])

  const openFile = useCallback(
    async (path) => {
      if (path === activeRef.current) return
      await saveNow()
      activeRef.current = path
      setActivePath(path)
      setInitialContent(null)
      try {
        const text = await readFile(path)
        if (activeRef.current !== path) return // user switched again mid-read
        contentRef.current = text
        savedRef.current = text
        setContent(text)
        setInitialContent(text)
        setSaveState('saved')
        localStorage.setItem('bbw:lastFile', path)
      } catch (err) {
        console.error('Open failed:', err)
        activeRef.current = null
        setActivePath(null)
        setSaveState('error')
      }
    },
    [saveNow]
  )

  // Load the workspace whenever the folder changes (incl. start-up restore).
  useEffect(() => {
    if (!folder) return
    let cancelled = false
    ;(async () => {
      try {
        const list = await listFiles(folder)
        if (cancelled) return
        setFiles(list)
        const last = localStorage.getItem('bbw:lastFile')
        const target = list.find((f) => f.path === last) || list[0]
        if (target) openFile(target.path)
      } catch (err) {
        console.error('Could not open folder:', err)
        if (!cancelled) {
          setFolder(null)
          localStorage.removeItem('bbw:folder')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [folder, openFile])

  const chooseFolder = useCallback(async () => {
    const dir = await pickFolder()
    if (!dir || dir === folder) return
    await saveNow()
    activeRef.current = null
    setActivePath(null)
    setInitialContent(null)
    setContent('')
    setSaveState('saved')
    setFiles([])
    localStorage.removeItem('bbw:lastFile')
    if (IS_TAURI) localStorage.setItem('bbw:folder', dir)
    setFolder(dir)
  }, [folder, saveNow])

  // Renaming flushes pending edits first so the moved file carries them; if
  // the open note moves, follow it. Errors bubble to the sidebar's inline row.
  const handleRename = useCallback(
    async (file, name) => {
      await saveNow()
      const newPath = await renameFile(file.path, name)
      await noteLocalRename(folder, file.path, newPath)
      if (activeRef.current === file.path) {
        activeRef.current = newPath
        setActivePath(newPath)
        setInitialContent(contentRef.current) // remount shows live text, not open-time text
        localStorage.setItem('bbw:lastFile', newPath)
      }
      setFiles(await listFiles(folder))
    },
    [folder, saveNow]
  )

  const handleDelete = useCallback(
    async (file) => {
      const ok = await confirmDialog(
        IS_TAURI
          ? `Move "${file.title}" to the trash?`
          : `Delete "${file.title}"?`,
        { title: 'Delete note', okLabel: IS_TAURI ? 'Move to trash' : 'Delete' }
      )
      if (!ok) return
      if (activeRef.current === file.path) {
        // Cancel any queued autosave so it can't resurrect the file mid-delete.
        clearTimeout(saveTimer.current)
        activeRef.current = null
        contentRef.current = ''
        savedRef.current = ''
        setActivePath(null)
        setInitialContent(null)
        setContent('')
        setSaveState('saved')
        localStorage.removeItem('bbw:lastFile')
      }
      try {
        await deleteFile(file.path)
        await noteLocalDelete(folder, file.path)
      } catch (err) {
        console.error('Delete failed:', err)
        await alertDialog(String(err?.message || err), { title: 'Delete note' })
      }
      setFiles(await listFiles(folder))
    },
    [folder]
  )

  const handleDuplicate = useCallback(
    async (file) => {
      try {
        const text = await readFile(file.path)
        const dir = file.dir ? `${file.dir}/` : ''
        const current = await listFiles(folder)
        for (let n = 1; n <= 50; n++) {
          const rel = `${dir}${file.title} copy${n > 1 ? ` ${n}` : ''}.md`
          if (current.some((f) => f.rel === rel)) continue
          const path = `${folder.replace(/[\\/]+$/, '')}/${rel}`
          await writeFile(path, text)
          setFiles(await listFiles(folder))
          await openFile(path)
          return
        }
        throw new Error('Too many copies of this note already.')
      } catch (err) {
        console.error('Duplicate failed:', err)
        await alertDialog(String(err?.message || err), { title: 'Duplicate note' })
      }
    },
    [folder, openFile]
  )

  const handleReveal = useCallback((file) => {
    revealFile(file.path).catch((err) => console.error('Reveal failed:', err))
  }, [])

  // After a pull: re-list the workspace, and if the open note was rewritten on
  // disk, reload it into the editor (remount via editorEpoch — the path alone
  // wouldn't change the key).
  const handlePulled = useCallback(
    async (changedPaths) => {
      setFiles(await listFiles(folder))
      const active = activeRef.current
      if (active && changedPaths.includes(active)) {
        const text = await readFile(active)
        contentRef.current = text
        savedRef.current = text
        setContent(text)
        setInitialContent(text)
        setSaveState('saved')
        setEditorEpoch((n) => n + 1)
      }
    },
    [folder]
  )

  const handleCreate = useCallback(
    async (name) => {
      const path = await createFile(folder, name) // surfaces its error in the sidebar
      setFiles(await listFiles(folder))
      await openFile(path)
    },
    [folder, openFile]
  )

  // Keyboard shortcuts (also work while the preview has focus).
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        saveNow()
      } else if (key === 'b') {
        e.preventDefault()
        setSidebarOpen((v) => !v)
      } else if (key === 'e') {
        e.preventDefault()
        setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])
      } else if (key === 'g') {
        e.preventDefault()
        setGuideOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveNow])

  // Flush pending edits when the window loses focus or closes.
  useEffect(() => {
    const flush = () => saveNow()
    window.addEventListener('blur', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('blur', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [saveNow])

  const activeFile = files.find((f) => f.path === activePath) || null

  useEffect(() => {
    const title = activeFile ? `${activeFile.title} — Bluebird Writer` : 'Bluebird Writer'
    document.title = title
    if (IS_TAURI) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => {})
    }
  }, [activeFile])

  if (!folder) {
    return (
      <div className="App">
        <Welcome onOpenFolder={chooseFolder} />
      </div>
    )
  }

  const stats = wordStats(content)
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]

  // The guide takes over the right-hand pane: alongside the editor in write or
  // split mode, and on its own when there is nothing (or nothing else) to show.
  const hasDoc = activePath && initialContent !== null
  const showEditor = hasDoc && mode !== 'preview'
  const showAside = guideOpen || (hasDoc && mode !== 'write')

  return (
    <div className="App">
      {sidebarOpen && (
        <Sidebar
          folderName={folderLabel(folder)}
          files={files}
          activePath={activePath}
          onSelect={openFile}
          onCreate={handleCreate}
          onChangeFolder={chooseFolder}
          onRename={handleRename}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onReveal={handleReveal}
        />
      )}

      <div className="Main">
        <header className="TopBar">
          <button
            className="IconButton"
            title="Toggle sidebar (Ctrl+B)"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="9" y1="4" x2="9" y2="20" />
            </svg>
          </button>

          <div className="TopBar__title">
            <span className="TopBar__title-text">{activeFile ? activeFile.title : 'No note selected'}</span>
            {activeFile && saveState !== 'saved' && (
              <span className={`TopBar__dot TopBar__dot--${saveState}`} title={SAVE_LABELS[saveState]} />
            )}
          </div>

          <div className="ModeSwitch" title="Ctrl+E to cycle">
            {MODES.map((m) => (
              <button
                key={m}
                className={`ModeSwitch__btn${mode === m ? ' ModeSwitch__btn--active' : ''}`}
                onClick={() => setMode(m)}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>

          <button
            className={`IconButton${syncOpen ? ' IconButton--active' : ''}`}
            title="Sync with Bluebird Documentation"
            onClick={() => setSyncOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.5 19a4.5 4.5 0 0 0 .42-8.98 6 6 0 0 0-11.7 1.62A4 4 0 0 0 6.5 19z" />
              <path d="M12 11v5m0 0 2-2m-2 2-2-2" />
            </svg>
          </button>

          <button
            className={`IconButton${guideOpen ? ' IconButton--active' : ''}`}
            title="Markdown guide (Ctrl+G)"
            aria-pressed={guideOpen}
            onClick={() => setGuideOpen((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
              <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5" />
              <path d="M9 7.5h6M9 11h4" />
            </svg>
          </button>

          <button
            className="IconButton"
            title={`Switch to ${nextTheme} theme`}
            onClick={() => setTheme(nextTheme)}
          >
            {/* Icon shows the theme you'll switch to, same as the old toggle. */}
            {nextTheme === 'light' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : nextTheme === 'paper' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3v5a1 1 0 0 0 1 1h5" />
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>
        </header>

        <main className="Workspace">
          {showEditor && (
            <div className="Workspace__pane">
              <Editor
                key={`${activePath}:${editorEpoch}`}
                initialContent={initialContent}
                onChange={handleEdit}
                onSave={saveNow}
              />
            </div>
          )}
          {showAside && (
            <div className="Workspace__pane Workspace__pane--aside">
              {guideOpen ? (
                <Guide onClose={() => setGuideOpen(false)} />
              ) : (
                <Preview content={content} />
              )}
            </div>
          )}
          {!showEditor && !showAside && (
            <div className="EmptyState">
              {files.length ? 'Select a note from the sidebar' : 'Create your first note'}
            </div>
          )}
        </main>

        {syncOpen && (
          <SyncPanel
            folder={folder}
            onClose={() => setSyncOpen(false)}
            onBeforePull={saveNow}
            onPulled={handlePulled}
          />
        )}

        <footer className="StatusBar">
          <div className="StatusBar__left">
            <span className={`SaveState SaveState--${saveState}`}>
              {activeFile ? SAVE_LABELS[saveState] : ''}
            </span>
            {!IS_TAURI && <span className="DemoBadge">browser demo — changes stay in memory</span>}
          </div>
          <div className="StatusBar__right">
            {stats.words} {stats.words === 1 ? 'word' : 'words'} · {stats.chars} characters
          </div>
        </footer>
      </div>
    </div>
  )
}
