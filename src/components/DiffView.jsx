import { useMemo } from 'react'
import { diffLines } from 'diff'
import '../css/DiffView.css'

const MAX_LINES = 400 // keep giant documents from freezing the panel
const CONTEXT = 3 // unchanged lines shown around each change

// Compact line diff: changed hunks with a little context, unchanged stretches
// collapsed to a "⋯ n unchanged lines" marker.
export default function DiffView({ oldText, newText }) {
  const rows = useMemo(() => {
    const parts = diffLines(oldText ?? '', newText ?? '')
    const out = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const lines = part.value.replace(/\n$/, '').split('\n')
      const kind = part.added ? 'add' : part.removed ? 'del' : 'ctx'

      if (kind === 'ctx') {
        // Trim long unchanged runs to CONTEXT lines on each side.
        const head = i === 0 ? [] : lines.slice(0, CONTEXT)
        const tail = i === parts.length - 1 ? [] : lines.slice(-CONTEXT)
        const hidden = lines.length - head.length - tail.length
        if (hidden > 0) {
          head.forEach((l) => out.push({ kind, text: l }))
          out.push({ kind: 'gap', text: `${hidden} unchanged ${hidden === 1 ? 'line' : 'lines'}` })
          tail.forEach((l) => out.push({ kind, text: l }))
        } else {
          lines.forEach((l) => out.push({ kind, text: l }))
        }
      } else {
        lines.forEach((l) => out.push({ kind, text: l }))
      }

      if (out.length > MAX_LINES) {
        out.length = MAX_LINES
        out.push({ kind: 'gap', text: 'diff truncated…' })
        break
      }
    }
    return out
  }, [oldText, newText])

  return (
    <div className="DiffView">
      {rows.map((row, i) => (
        <div key={i} className={`DiffView__line DiffView__line--${row.kind}`}>
          <span className="DiffView__sign">
            {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : row.kind === 'gap' ? '⋯' : ' '}
          </span>
          <span className="DiffView__text">{row.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}
