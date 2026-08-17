import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.use({ gfm: true, breaks: false })

export function renderMarkdown(source) {
  return DOMPurify.sanitize(marked.parse(source ?? ''))
}
