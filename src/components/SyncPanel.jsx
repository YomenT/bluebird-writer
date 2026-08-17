import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadConnections,
  saveConnections,
  activeConnections,
  connId,
  connLabel,
  listRemoteDocuments,
  discoverWorkspaceId,
  docSyncKey,
  planPull,
  applyPull,
} from '../lib/sync'
import { openExternal } from '../lib/files'
import DiffView from './DiffView'
import '../css/SyncPanel.css'

const REVIEW_ORDER = ['conflict', 'changed', 'new', 'error']
const REVIEW_TITLES = {
  conflict: 'Conflicts — you edited these locally',
  changed: 'Updated in Bluebird Documentation',
  new: 'New — not in this folder yet',
  error: 'Could not compare',
}
const OUTCOME_LABELS = {
  applied: 'Applied',
  skipped: 'Skipped',
  'up-to-date': 'Up to date',
  error: 'Failed',
}

export default function SyncPanel({ folder, onClose, onBeforePull, onPulled }) {
  const [conns, setConns] = useState(loadConnections)
  // connId → { conn, docs: []|null, error: '' }
  const [sources, setSources] = useState(new Map())
  const [adding, setAdding] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [wsIdInput, setWsIdInput] = useState('')
  const [wsLabelInput, setWsLabelInput] = useState('')
  const [addError, setAddError] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)

  // Selection helpers: find docs by name, narrow to a source or type, then
  // select what's shown. Selection survives filter changes (it's id-based).
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  // Review stage: nothing is written until entries are approved and applied.
  const [stage, setStage] = useState('list') // 'list' | 'review'
  const [plan, setPlan] = useState(null)
  const [approved, setApproved] = useState(() => new Set())
  const [expanded, setExpanded] = useState(() => new Set())
  const [outcomes, setOutcomes] = useState(null) // docKey → outcome after apply

  const closedRef = useRef(false)

  useEffect(() => {
    closedRef.current = false // StrictMode remounts after running cleanup
    return () => { closedRef.current = true }
  }, [])

  const connections = activeConnections(conns)
  const isWorkspaceKey = keyInput.trim().startsWith('bbw_')
  const hasConnections = connections.length > 0

  // Fetch each connection's document list; failures stay local to their group.
  const refresh = useCallback(async (connList) => {
    setBusy(true)
    setStage('list')
    setPlan(null)
    setOutcomes(null)
    const fetched = await Promise.all(
      connList.map(async (conn) => {
        try {
          return { conn, docs: await listRemoteDocuments(conn), error: '' }
        } catch (err) {
          return { conn, docs: null, error: err.message }
        }
      })
    )
    if (closedRef.current) return
    // Keyed in connection order (personal first), not fetch-completion order.
    const next = new Map(fetched.map((s) => [connId(s.conn), s]))
    setSources(next)
    // Start unselected — picking specific documents is the normal flow, and
    // "everything" is one click on the select-all checkbox.
    setSelected(new Set())
    setBusy(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load-on-open fetch; refresh() sets loading state
    if (connections.length) refresh(connections)
    // Stored connections only change through the handlers below, which
    // refresh explicitly — this effect is just the load-on-open fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = (nextConns) => {
    setConns(nextConns)
    saveConnections(nextConns)
    return nextConns
  }

  const addKey = async () => {
    const key = keyInput.trim()
    if (!key) return
    setAddError('')
    setBusy(true)
    try {
      let nextConns
      if (key.startsWith('bbw_')) {
        let workspaceId = Number(wsIdInput.trim()) || null
        if (!workspaceId) {
          workspaceId = await discoverWorkspaceId(key)
          if (!workspaceId) {
            throw new Error(
              'Could not detect this key\'s workspace automatically — enter its workspace ID below.'
            )
          }
        }
        if (conns.workspaces.some((w) => w.workspaceId === workspaceId)) {
          throw new Error('That workspace is already connected.')
        }
        const entry = { key, workspaceId, label: wsLabelInput.trim() || `Workspace ${workspaceId}` }
        // Validate before persisting so a bad key never gets stored.
        await listRemoteDocuments({ kind: 'workspace', ...entry })
        nextConns = { ...conns, workspaces: [...conns.workspaces, entry] }
      } else {
        await listRemoteDocuments({ kind: 'personal', key })
        nextConns = { ...conns, personal: key }
      }
      if (closedRef.current) return
      persist(nextConns)
      setKeyInput('')
      setWsIdInput('')
      setWsLabelInput('')
      setAdding(false)
      await refresh(activeConnections(nextConns))
    } catch (err) {
      if (!closedRef.current) setAddError(err.message)
    } finally {
      if (!closedRef.current) setBusy(false)
    }
  }

  const removeConnection = (conn) => {
    const nextConns =
      conn.kind === 'personal'
        ? { ...conns, personal: null }
        : { ...conns, workspaces: conns.workspaces.filter((w) => w.workspaceId !== conn.workspaceId) }
    persist(nextConns)
    setSources((prev) => {
      const next = new Map(prev)
      next.delete(connId(conn))
      return next
    })
  }

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const matchesFilters = (conn, doc) => {
    if (sourceFilter !== 'all' && connId(conn) !== sourceFilter) return false
    if (typeFilter !== 'all' && doc.type !== typeFilter) return false
    const q = query.trim().toLowerCase()
    if (q && !`${doc.name} ${doc.description || ''}`.toLowerCase().includes(q)) return false
    return true
  }

  // What the current filters leave on screen — select-all acts on this.
  const visibleByConn = new Map()
  const visibleIds = []
  let totalCount = 0
  for (const { conn, docs } of sources.values()) {
    totalCount += (docs || []).length
    const shown = (docs || []).filter((doc) => matchesFilters(conn, doc))
    visibleByConn.set(connId(conn), shown)
    for (const doc of shown) visibleIds.push(docSyncKey(conn, doc))
  }
  const filtersActive = query.trim() !== '' || sourceFilter !== 'all' || typeFilter !== 'all'

  const setMany = (ids, on) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const toggleAll = () => setMany(visibleIds, !allVisibleSelected)

  /* ─── Stage 1: compare (no writes) ─────────────────────────────── */

  const check = async () => {
    const items = []
    for (const { conn, docs } of sources.values()) {
      for (const doc of docs || []) {
        if (selected.has(docSyncKey(conn, doc))) items.push({ conn, doc })
      }
    }
    if (!items.length) return
    setBusy(true)
    try {
      await onBeforePull?.() // flush unsaved editor changes so comparisons are honest
      const result = await planPull(folder, items, {
        onProgress: (done, total) => {
          if (!closedRef.current) setProgress({ done, total, verb: 'Comparing' })
        },
      })
      if (closedRef.current) return
      setPlan(result)
      setApproved(new Set())
      setExpanded(new Set())
      setOutcomes(null)
      setStage('review')
    } finally {
      if (!closedRef.current) {
        setBusy(false)
        setProgress(null)
      }
    }
  }

  /* ─── Stage 2: approve & apply ─────────────────────────────────── */

  const pending = (plan || []).filter((p) => REVIEW_ORDER.includes(p.status))
  const upToDateCount = (plan || []).filter((p) => p.status === 'up-to-date').length

  const toggleApproval = (docKey) => {
    if (outcomes) return // already applied
    setApproved((prev) => {
      const next = new Set(prev)
      if (next.has(docKey)) next.delete(docKey)
      else next.add(docKey)
      return next
    })
  }

  const toggleExpanded = (docKey) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(docKey)) next.delete(docKey)
      else next.add(docKey)
      return next
    })
  }

  const approveAllNew = () => {
    if (outcomes) return
    setApproved((prev) => {
      const next = new Set(prev)
      for (const p of pending) if (p.status === 'new') next.add(p.docKey)
      return next
    })
  }

  const apply = async () => {
    if (!plan || !approved.size) return
    setBusy(true)
    try {
      const results = await applyPull(folder, plan, approved)
      if (closedRef.current) return
      setOutcomes(new Map(results.map((r) => [r.docKey, r])))
      const changed = results.filter((r) => r.outcome === 'applied').map((r) => r.path)
      if (changed.length) await onPulled?.(changed)
    } finally {
      if (!closedRef.current) setBusy(false)
    }
  }

  const backToList = () => {
    setStage('list')
    setPlan(null)
    setOutcomes(null)
  }

  const applySummary = () => {
    if (!outcomes) return null
    const counts = {}
    for (const r of outcomes.values()) counts[r.outcome] = (counts[r.outcome] || 0) + 1
    const parts = []
    if (counts.applied) parts.push(`${counts.applied} applied`)
    if (counts.skipped) parts.push(`${counts.skipped} left untouched`)
    if (counts.error) parts.push(`${counts.error} failed`)
    return parts.join(' · ')
  }

  /* ─── Fragments ────────────────────────────────────────────────── */

  const addForm = (
    <div className="SyncPanel__setup">
      {!hasConnections && (
        <p>
          In Bluebird Documentation, create an API key with the <strong>read</strong> scope
          only — that's all pulling needs, and a read-only key means this app cannot change
          anything in your account.
        </p>
      )}
      <p className="SyncPanel__hint">
        <strong>Personal</strong> docs: Account → API keys (<code>bb_…</code>).{' '}
        <strong>Team workspace</strong> docs: Workspace Settings → API keys (<code>bbw_…</code>) —
        one key per workspace.
      </p>
      <div className="SyncPanel__keyrow">
        <input
          className="SyncPanel__input"
          type="password"
          value={keyInput}
          placeholder="bb_… or bbw_…"
          aria-label="Bluebird Documentation API key"
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addKey()}
        />
        <button className="SyncPanel__primary" disabled={!keyInput.trim() || busy} onClick={addKey}>
          Connect
        </button>
      </div>
      {isWorkspaceKey && (
        <div className="SyncPanel__keyrow">
          <input
            className="SyncPanel__input SyncPanel__input--short"
            type="text"
            inputMode="numeric"
            value={wsIdInput}
            placeholder="Workspace ID (auto-detected if blank)"
            aria-label="Workspace ID"
            onChange={(e) => setWsIdInput(e.target.value)}
          />
          <input
            className="SyncPanel__input"
            type="text"
            value={wsLabelInput}
            placeholder="Label, e.g. team name (optional)"
            aria-label="Workspace label"
            onChange={(e) => setWsLabelInput(e.target.value)}
          />
        </div>
      )}
      {!hasConnections && (
        <button
          className="SyncPanel__link"
          onClick={() => openExternal('https://bluebird-documentation.com')}
        >
          Open Bluebird Documentation ↗
        </button>
      )}
      {addError && <p className="SyncPanel__error">{addError}</p>}
    </div>
  )

  const listStage = (
    <>
      <div className="SyncPanel__toolbar">
        <label className="SyncPanel__selectall" title="Select everything currently shown">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAll}
            disabled={visibleIds.length === 0}
          />
          {totalCount
            ? `${selected.size} selected${filtersActive ? ` · ${visibleIds.length} shown` : ` of ${totalCount}`}`
            : busy ? 'Connecting…' : 'No documents'}
        </label>
        <div className="SyncPanel__toolbar-actions">
          <button
            className="SyncPanel__ghost"
            disabled={busy}
            onClick={() => { setAdding((v) => !v); setAddError('') }}
          >
            {adding ? 'Cancel' : 'Add key'}
          </button>
          <button className="SyncPanel__ghost" disabled={busy} onClick={() => refresh(connections)}>
            Refresh
          </button>
        </div>
      </div>

      {adding && addForm}

      {totalCount > 0 && (
        <div className="SyncPanel__filters">
          <input
            className="SyncPanel__search"
            type="search"
            value={query}
            placeholder="Search documents…"
            aria-label="Search documents"
            onChange={(e) => setQuery(e.target.value)}
          />
          {connections.length > 1 && (
            <div className="SyncPanel__chips" role="group" aria-label="Filter by source">
              <button
                className={`SyncPanel__chip${sourceFilter === 'all' ? ' SyncPanel__chip--active' : ''}`}
                onClick={() => setSourceFilter('all')}
              >
                All sources
              </button>
              {connections.map((conn) => (
                <button
                  key={connId(conn)}
                  className={`SyncPanel__chip${sourceFilter === connId(conn) ? ' SyncPanel__chip--active' : ''}`}
                  onClick={() => setSourceFilter((s) => (s === connId(conn) ? 'all' : connId(conn)))}
                >
                  {connLabel(conn)}
                </button>
              ))}
            </div>
          )}
          <div className="SyncPanel__chips" role="group" aria-label="Filter by type">
            {['all', 'Space', 'Page'].map((t) => (
              <button
                key={t}
                className={`SyncPanel__chip${typeFilter === t ? ' SyncPanel__chip--active' : ''}`}
                onClick={() => setTypeFilter(t)}
              >
                {t === 'all' ? 'All types' : `${t}s`}
              </button>
            ))}
          </div>
        </div>
      )}

      <ul className="SyncPanel__list">
        {[...sources.values()].map(({ conn, docs, error }) => {
          const shown = visibleByConn.get(connId(conn)) || []
          // Groups emptied by search/type filters drop out; an explicitly
          // chosen source stays visible so "no matches" is evident.
          if (filtersActive && !shown.length && sourceFilter !== connId(conn)) return null
          const shownIds = shown.map((doc) => docSyncKey(conn, doc))
          const groupSelected = shownIds.length > 0 && shownIds.every((id) => selected.has(id))
          return (
            <li key={connId(conn)}>
              <div className="SyncPanel__group">
                <label className="SyncPanel__group-check" title={`Select all shown in ${connLabel(conn)}`}>
                  <input
                    type="checkbox"
                    checked={groupSelected}
                    disabled={shownIds.length === 0}
                    onChange={() => setMany(shownIds, !groupSelected)}
                  />
                </label>
                <span className={`SyncPanel__group-name SyncPanel__group-name--${conn.kind}`}>
                  {connLabel(conn)}
                </span>
                <span className="SyncPanel__muted">
                  {docs
                    ? filtersActive
                      ? `${shown.length} of ${docs.length} shown`
                      : `${docs.length} ${docs.length === 1 ? 'document' : 'documents'}`
                    : ''}
                </span>
                <button
                  className="SyncPanel__group-remove"
                  title={`Disconnect ${connLabel(conn)}`}
                  onClick={() => removeConnection(conn)}
                >
                  Disconnect
                </button>
              </div>
              {error && <p className="SyncPanel__error">{error}</p>}
              {filtersActive && !shown.length && (
                <p className="SyncPanel__muted SyncPanel__nomatch">No matches in this source.</p>
              )}
              <ul className="SyncPanel__sublist">
                {shown.map((doc) => {
                  const id = docSyncKey(conn, doc)
                  return (
                    <li key={id} className="SyncPanel__row">
                      <label className="SyncPanel__doc">
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={() => toggle(id)}
                        />
                        <span className={`SyncPanel__type SyncPanel__type--${doc.type.toLowerCase()}`}>
                          {doc.type}
                        </span>
                        <span className="SyncPanel__name" title={doc.description || doc.name}>
                          {doc.name}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ul>

      <footer className="SyncPanel__foot">
        <span className="SyncPanel__muted">
          {progress ? `${progress.verb} ${progress.done}/${progress.total}…` : 'Nothing is written without your approval.'}
        </span>
        <button
          className="SyncPanel__primary"
          disabled={busy || selected.size === 0}
          onClick={check}
        >
          Check {selected.size || ''} {selected.size === 1 ? 'document' : 'documents'}
        </button>
      </footer>
    </>
  )

  const reviewRow = (p) => {
    const outcome = outcomes?.get(p.docKey)
    const isOpen = expanded.has(p.docKey)
    return (
      <li key={p.docKey} className="SyncPanel__review-item">
        <div className="SyncPanel__row">
          <label className="SyncPanel__doc" title={p.message || ''}>
            <input
              type="checkbox"
              disabled={p.status === 'error' || !!outcomes}
              checked={approved.has(p.docKey)}
              onChange={() => toggleApproval(p.docKey)}
            />
            <span className={`SyncPanel__type SyncPanel__type--${p.doc.type.toLowerCase()}`}>
              {p.doc.type}
            </span>
            <span className="SyncPanel__name" title={p.doc.name}>{p.doc.name}</span>
            <span className="SyncPanel__conn">{connLabel(p.conn)}</span>
          </label>
          {p.status !== 'error' ? (
            <button className="SyncPanel__ghost SyncPanel__ghost--small" onClick={() => toggleExpanded(p.docKey)}>
              {isOpen ? 'Hide' : p.status === 'new' ? 'Preview' : 'Diff'}
            </button>
          ) : (
            <span className="SyncPanel__status SyncPanel__status--error" title={p.message}>Failed</span>
          )}
          {outcome && (
            <span className={`SyncPanel__status SyncPanel__status--${outcome.outcome === 'applied' ? 'new' : outcome.outcome === 'error' ? 'error' : 'up-to-date'}`}>
              {OUTCOME_LABELS[outcome.outcome]}
            </span>
          )}
        </div>
        {p.message && p.status === 'conflict' && (
          <p className="SyncPanel__warning">{p.message}</p>
        )}
        {isOpen && (
          <div className="SyncPanel__diff">
            <DiffView oldText={p.local || ''} newText={p.markdown || ''} />
          </div>
        )}
      </li>
    )
  }

  const reviewStage = (
    <>
      <div className="SyncPanel__toolbar">
        <span className="SyncPanel__muted">
          {pending.length
            ? `${pending.length} ${pending.length === 1 ? 'difference' : 'differences'} · ${upToDateCount} up to date`
            : `Everything is up to date (${upToDateCount} checked)`}
        </span>
        <div className="SyncPanel__toolbar-actions">
          {pending.some((p) => p.status === 'new') && !outcomes && (
            <button className="SyncPanel__ghost" onClick={approveAllNew}>
              Approve all new
            </button>
          )}
          <button className="SyncPanel__ghost" disabled={busy} onClick={backToList}>
            Back
          </button>
        </div>
      </div>

      <ul className="SyncPanel__list">
        {REVIEW_ORDER.map((status) => {
          const group = pending.filter((p) => p.status === status)
          if (!group.length) return null
          return (
            <li key={status}>
              <div className="SyncPanel__group">
                <span className={`SyncPanel__review-title SyncPanel__review-title--${status}`}>
                  {REVIEW_TITLES[status]}
                </span>
                <span className="SyncPanel__muted">{group.length}</span>
              </div>
              <ul className="SyncPanel__sublist">{group.map(reviewRow)}</ul>
            </li>
          )
        })}
      </ul>

      <footer className="SyncPanel__foot">
        <span className="SyncPanel__muted">
          {outcomes
            ? applySummary()
            : pending.length
              ? `${approved.size} of ${pending.length} approved — unapproved stay untouched`
              : ''}
        </span>
        {outcomes ? (
          <button className="SyncPanel__primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <button
            className="SyncPanel__primary"
            disabled={busy || approved.size === 0}
            onClick={apply}
          >
            Apply {approved.size || ''} approved
          </button>
        )}
      </footer>
    </>
  )

  return (
    <div className="SyncOverlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="SyncPanel" role="dialog" aria-label="Sync with Bluebird Documentation">
        <header className="SyncPanel__head">
          <div>
            <h2 className="SyncPanel__title">Sync with Bluebird Documentation</h2>
            <p className="SyncPanel__subtitle">
              {!hasConnections
                ? 'Connect with an API key to get started.'
                : stage === 'review'
                  ? 'Review each difference — only approved changes are written.'
                  : 'Pull personal and team-workspace documents into this folder as Markdown.'}
            </p>
          </div>
          <button className="SyncPanel__close" title="Close" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {!hasConnections ? addForm : stage === 'review' ? reviewStage : listStage}
      </div>
    </div>
  )
}
