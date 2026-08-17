// Sync with Bluebird Documentation via the backend's agent APIs.
//
// Two kinds of documents live in Bluebird Documentation, each behind its own
// agent API and key type:
//   - Personal Spaces/Pages   → bb_  key  → /agent/documents/…
//   - Team-workspace documents → bbw_ key → /workspaces/agent/<id>/documents/…
// A bbw_ key is bound server-side to exactly one workspace, but the client
// must name the workspace id in the URL — connect-time discovery probes for
// it (mismatches return a distinctive 403, so probing is cheap and safe).
//
// The user can therefore connect several keys ("connections"): at most one
// personal key plus any number of workspace keys. Pulling only needs the
// "read" scope — read-only keys are the recommended setup until push exists.
//
// A manifest (.bbw-sync.json in the workspace root, invisible to the sidebar)
// records, per remote document, where it was written locally, the remote
// updated_at, and a hash of the Markdown as written. The hash is how we tell
// "safe to overwrite" from "the user edited this since the last pull" — and it
// is the foundation the (future, cautious) push mechanism will build on.
// Workspace entries are namespaced (ws:<id>:…) so the stores cannot collide.

import { readFile, writeFile } from './files'
import { quillHtmlToMarkdown } from './quillToMarkdown'

// Dev traffic goes through the Vite proxy (see vite.config.js) because the
// backend's CORS whitelist covers Tauri production origins but not :5175.
const API_BASE = import.meta.env.DEV
  ? '/bb-api'
  : 'https://bluebirddocumentationadmin.pythonanywhere.com'

const MANIFEST_NAME = '.bbw-sync.json'
const CONN_STORAGE = 'bbw:syncConnections'
const LEGACY_KEY_STORAGE = 'bbw:syncKey' // v1 stored a single personal key

const MAX_DISCOVERY_ID = 30

/* ─── Connections ────────────────────────────────────────────────── */
// Stored shape: { personal: 'bb_…' | null, workspaces: [{ key, workspaceId, label }] }

export function loadConnections() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONN_STORAGE))
    if (parsed && Array.isArray(parsed.workspaces)) {
      return { personal: parsed.personal || null, workspaces: parsed.workspaces }
    }
  } catch {
    // fall through to migration / empty state
  }
  return { personal: localStorage.getItem(LEGACY_KEY_STORAGE) || null, workspaces: [] }
}

export function saveConnections(conns) {
  localStorage.setItem(CONN_STORAGE, JSON.stringify(conns))
  localStorage.removeItem(LEGACY_KEY_STORAGE)
}

// Flatten the stored shape into the connection objects the API layer takes.
export function activeConnections(conns) {
  const list = []
  if (conns.personal) list.push({ kind: 'personal', key: conns.personal })
  for (const w of conns.workspaces) {
    list.push({ kind: 'workspace', key: w.key, workspaceId: w.workspaceId, label: w.label })
  }
  return list
}

export const connId = (conn) =>
  conn.kind === 'personal' ? 'personal' : `ws:${conn.workspaceId}`

export const connLabel = (conn) =>
  conn.kind === 'personal' ? 'Personal' : conn.label || `Workspace ${conn.workspaceId}`

/* ─── HTTP ───────────────────────────────────────────────────────── */

async function api(path, key, retried = false) {
  let res
  try {
    res = await fetch(API_BASE + path, { headers: { Authorization: key } })
  } catch {
    throw new Error('Could not reach Bluebird Documentation — check your connection.')
  }
  if (res.status === 401) {
    // The backend answers 401 for transient faults too (e.g. its database
    // waking from auto-suspend), so give one retry before blaming the key —
    // same pattern the other suite apps use.
    if (!retried) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return api(path, key, true)
    }
    throw new Error('API key rejected — it may be revoked or mistyped.')
  }
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'This API key is missing the "read" scope.')
  }
  if (res.status === 429) throw new Error('Rate limit reached — try again in a little while.')
  if (!res.ok) throw new Error(`Bluebird Documentation returned ${res.status}.`)
  return res.json()
}

const listPath = (conn) =>
  conn.kind === 'personal'
    ? '/agent/documents/'
    : `/workspaces/agent/${conn.workspaceId}/documents/`

const detailPath = (conn, type, name) =>
  conn.kind === 'personal'
    ? `/agent/documents/${type}/${encodeURIComponent(name)}/`
    : `/workspaces/agent/${conn.workspaceId}/documents/${type}/${encodeURIComponent(name)}/`

export async function listRemoteDocuments(conn) {
  const data = await api(listPath(conn), conn.key)
  const rank = { Space: 0, Page: 1 }
  return (data.documents || []).sort(
    (a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name)
  )
}

const fetchRemoteDocument = (conn, type, name) => api(detailPath(conn, type, name), conn.key)

// The personal API reports a page's parent as a name string; the workspace
// API reports it as a {id, name} object under "space".
const parentOf = (conn, detail) =>
  conn.kind === 'personal' ? detail.parent : detail.space?.name

/**
 * Find which workspace a bbw_ key is bound to by probing ids. Mismatches
 * return 403 "not scoped to this workspace"; the first 200 is our workspace.
 * Returns the id, or null when nothing matched within the probe range.
 */
export async function discoverWorkspaceId(key) {
  let retriedCold = false
  for (let id = 1; id <= MAX_DISCOVERY_ID; id++) {
    let res
    try {
      res = await fetch(`${API_BASE}/workspaces/agent/${id}/documents/`, {
        headers: { Authorization: key },
      })
    } catch {
      throw new Error('Could not reach Bluebird Documentation — check your connection.')
    }
    if (res.ok) return id
    if (res.status === 401) {
      if (!retriedCold) {
        // Transient backend fault (cold database) — retry this id once.
        retriedCold = true
        await new Promise((resolve) => setTimeout(resolve, 1500))
        id--
        continue
      }
      throw new Error('Workspace API key rejected — it may be revoked or mistyped.')
    }
    if (res.status === 429) {
      throw new Error('Rate limit reached while detecting the workspace — enter the workspace ID manually.')
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}))
      // Any 403 other than "wrong workspace" (e.g. missing read scope) would
      // repeat for every id — surface it instead of probing on.
      if (!/not scoped/i.test(body.error || '')) {
        throw new Error(body.error || 'Workspace API key rejected.')
      }
    }
  }
  return null
}

/* ─── Manifest ───────────────────────────────────────────────────── */

const joinPath = (folder, rel) => `${folder.replace(/[\\/]+$/, '')}/${rel}`

async function tryRead(path) {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

export async function loadManifest(folder) {
  const raw = await tryRead(joinPath(folder, MANIFEST_NAME))
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.docs === 'object') return parsed
    } catch {
      // Corrupt manifest — start fresh; pulls degrade to conflict-safe writes.
    }
  }
  return { version: 1, docs: {} }
}

const saveManifest = (folder, manifest) =>
  writeFile(joinPath(folder, MANIFEST_NAME), JSON.stringify(manifest, null, 2))

const relOf = (folder, path) => {
  const root = folder.replace(/[\\/]+$/, '')
  if (!path.startsWith(root)) return null
  return path.slice(root.length).replace(/^[\\/]+/, '').replaceAll('\\', '/')
}

// Keep the manifest coherent when the user manages pulled files locally:
// a rename moves the entry's rel (so pulls keep updating the file in its new
// home instead of resurrecting the old path); a delete drops the entry.
// No-ops (and no manifest file is created) when the path was never pulled.

export async function noteLocalRename(folder, oldPath, newPath) {
  const oldRel = relOf(folder, oldPath)
  const newRel = relOf(folder, newPath)
  if (!oldRel || !newRel) return
  const manifest = await loadManifest(folder)
  const entry = Object.values(manifest.docs).find((e) => e.rel === oldRel)
  if (!entry) return
  entry.rel = newRel
  await saveManifest(folder, manifest)
}

export async function noteLocalDelete(folder, path) {
  const rel = relOf(folder, path)
  if (!rel) return
  const manifest = await loadManifest(folder)
  const key = Object.keys(manifest.docs).find((k) => manifest.docs[k].rel === rel)
  if (!key) return
  delete manifest.docs[key]
  await saveManifest(folder, manifest)
}

// FNV-1a, hex string. Detects "did this file change" — not cryptographic.
export function contentHash(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/* ─── Pull ───────────────────────────────────────────────────────── */

const sanitizeName = (name) =>
  name.replace(/[\\/:*?"<>|]/g, '-').trim().replace(/\.+$/, '') || 'Untitled'

// Personal docs keep the v1 un-namespaced manifest keys.
export const docSyncKey = (conn, doc) =>
  conn.kind === 'personal'
    ? `${doc.type}:${doc.name}`
    : `ws:${conn.workspaceId}:${doc.type}:${doc.name}`

// Personal: Spaces at the top of Bluebird/, pages under their parent's name.
// Workspace: the same shape, one level down under Workspaces/<label>/.
function relFor(conn, doc, detail) {
  const base =
    conn.kind === 'personal' ? 'Bluebird' : `Bluebird/Workspaces/${sanitizeName(connLabel(conn))}`
  const name = sanitizeName(doc.name)
  if (doc.type === 'Space') return `${base}/${name}.md`
  const parent = parentOf(conn, detail)
  return `${base}/${parent ? sanitizeName(parent) : 'Pages'}/${name}.md`
}

/**
 * Phase 1 of a pull: fetch the selected remote documents and work out what
 * would change locally — WITHOUT writing anything. Every entry that differs
 * must be individually approved before applyPull() will touch the disk.
 *
 * `items` is [{ conn, doc }] and may span several connections.
 *
 * Returns plan entries { conn, doc, docKey, status, rel?, path?, markdown?,
 * local?, message? } where status is one of:
 *   'new'        — no local file yet; approving creates it
 *   'changed'    — remote changed, local untouched since last pull
 *   'conflict'   — local was edited since last pull (or a stranger file
 *                  occupies the path); approving replaces it
 *   'up-to-date' — nothing to do
 *   'error'      — fetch/convert failed
 */
export async function planPull(folder, items, { onProgress } = {}) {
  const manifest = await loadManifest(folder)
  const plan = []

  for (let i = 0; i < items.length; i++) {
    const { conn, doc } = items[i]
    const docKey = docSyncKey(conn, doc)
    const entry = manifest.docs[docKey]
    onProgress?.(i + 1, items.length, doc)

    try {
      // Fast path: remote unchanged since last pull and local file untouched —
      // no need to fetch the content at all.
      if (entry && entry.remoteUpdatedAt === doc.updated_at) {
        const local = await tryRead(joinPath(folder, entry.rel))
        if (local !== null && contentHash(local) === entry.hash) {
          plan.push({ conn, doc, docKey, status: 'up-to-date', rel: entry.rel })
          continue
        }
      }

      const detail = await fetchRemoteDocument(conn, doc.type, doc.name)
      const markdown = quillHtmlToMarkdown(detail.content)
      // Once a document has a local home, it keeps it — even if it was
      // re-parented remotely — so pulls never scatter duplicates around.
      const rel = entry?.rel || relFor(conn, doc, detail)
      const path = joinPath(folder, rel)
      const local = await tryRead(path)

      let status
      if (local === null) status = 'new'
      else if (local === markdown) status = 'up-to-date'
      else if (entry && contentHash(local) === entry.hash) status = 'changed'
      else status = 'conflict'

      plan.push({
        conn,
        doc,
        docKey,
        status,
        rel,
        path,
        markdown,
        local,
        message:
          status === 'conflict'
            ? entry
              ? 'Edited locally since the last pull — approving replaces your edits'
              : 'A local note already has this name — approving replaces it'
            : undefined,
      })
    } catch (err) {
      plan.push({ conn, doc, docKey, status: 'error', message: err.message })
    }
  }

  return plan
}

/**
 * Phase 2: write exactly the approved plan entries. Anything not in
 * `approvedKeys` is left untouched (outcome 'skipped'). Up-to-date entries
 * quietly refresh their manifest bookkeeping (content already identical).
 *
 * Returns the plan entries annotated with `outcome`:
 * 'applied' | 'skipped' | 'up-to-date' | 'error'.
 */
export async function applyPull(folder, plan, approvedKeys) {
  const manifest = await loadManifest(folder)
  const results = []

  for (const p of plan) {
    if (p.status === 'error') {
      results.push({ ...p, outcome: 'error' })
      continue
    }
    if (p.status === 'up-to-date') {
      // Content matches; record the current remote stamp so the next pull
      // takes the fast path.
      if (p.markdown !== undefined) {
        manifest.docs[p.docKey] = {
          rel: p.rel,
          hash: contentHash(p.markdown),
          remoteUpdatedAt: p.doc.updated_at,
          pulledAt: new Date().toISOString(),
        }
      }
      results.push({ ...p, outcome: 'up-to-date' })
      continue
    }
    if (!approvedKeys.has(p.docKey)) {
      results.push({ ...p, outcome: 'skipped' })
      continue
    }
    try {
      await writeFile(p.path, p.markdown)
      manifest.docs[p.docKey] = {
        rel: p.rel,
        hash: contentHash(p.markdown),
        remoteUpdatedAt: p.doc.updated_at,
        pulledAt: new Date().toISOString(),
      }
      results.push({ ...p, outcome: 'applied' })
    } catch (err) {
      results.push({ ...p, outcome: 'error', message: err.message })
    }
  }

  await saveManifest(folder, manifest)
  return results
}
