import { marked } from 'marked'
import DOMPurify from 'dompurify'

// breaks: true — a single Enter is a line break (BBW-3). Strict CommonMark
// treats a lone newline as a space and demands two trailing spaces for a
// break, which does not match how people type in an editor. Bluebird
// Documentation's sync converter is configured the same way, so the preview
// always shows what a push would store.
marked.use({ gfm: true, breaks: true })

export function renderMarkdown(source) {
  return DOMPurify.sanitize(marked.parse(source ?? ''))
}
