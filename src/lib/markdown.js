import { marked } from 'marked'
import DOMPurify from 'dompurify'

// breaks: true — a single Enter is a line break (BBW-3). Strict CommonMark
// treats a lone newline as a space and demands two trailing spaces for a
// break, which does not match how people type in an editor. Bluebird
// Documentation's sync converter is configured the same way, so the preview
// always shows what a push would store.
marked.use({ gfm: true, breaks: true })

// Quill turns every line break into a block of its own when it loads a
// pushed note, so each line gets the paragraph gap there. Mirror that here,
// or the preview draws lines tight that Bluebird Documentation spaces
// apart (BBW-5). Only direct <br> children split — one inside <strong> etc.
// would tear the formatting, and is rare enough to leave as a plain break.
function splitLineBreaks(root) {
  root.querySelectorAll('p').forEach((p) => {
    if (![...p.childNodes].some((n) => n.nodeName === 'BR')) return
    const lines = [[]]
    for (const node of [...p.childNodes]) {
      if (node.nodeName === 'BR') lines.push([])
      else lines[lines.length - 1].push(node)
    }
    // "<br>" on its own is Quill's blank line; keep one visible line for it.
    if (lines.every((l) => l.length === 0)) return
    const isEmpty = (nodes) => nodes.every((n) => n.nodeName === '#text' && !n.textContent.trim())
    // A trailing break adds no line in Quill; an inner empty one is a blank line.
    while (lines.length > 1 && isEmpty(lines[lines.length - 1])) lines.pop()
    const blocks = lines.map((nodes) => {
      const block = p.cloneNode(false)
      if (isEmpty(nodes)) block.appendChild(document.createElement('br'))
      else block.append(...nodes)
      return block
    })
    p.replaceWith(...blocks)
  })
  // marked emits the lone-<br> blank-line marker as a bare HTML block; give
  // it a paragraph so it takes up a line plus the gap, like <p><br></p>.
  ;[...root.childNodes].forEach((node) => {
    if (node.nodeName === 'BR') {
      const p = document.createElement('p')
      node.replaceWith(p)
      p.appendChild(node)
    }
  })
}

export function renderMarkdown(source) {
  const fragment = DOMPurify.sanitize(marked.parse(source ?? ''), { RETURN_DOM_FRAGMENT: true })
  splitLineBreaks(fragment)
  const host = document.createElement('div')
  host.appendChild(fragment)
  return host.innerHTML
}
