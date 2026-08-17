import { useMemo } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { openExternal } from '../lib/files'
import '../css/Preview.css'

export default function Preview({ content }) {
  const html = useMemo(() => renderMarkdown(content), [content])

  // Links open in the system browser instead of navigating the app window.
  const handleClick = (e) => {
    const link = e.target.closest('a[href]')
    if (!link) return
    e.preventDefault()
    const href = link.getAttribute('href')
    if (/^https?:\/\//i.test(href)) openExternal(href)
  }

  return (
    <div className="Preview" onClick={handleClick}>
      <div className="Preview__content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
