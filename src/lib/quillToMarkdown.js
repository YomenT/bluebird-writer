// Converts the Quill-flavoured HTML that Bluebird Documentation stores into
// Markdown. Quill's output differs from generic HTML in three ways that would
// mangle a naive conversion, so the DOM is normalized first:
//   1. Code blocks are per-line <div class="ql-code-block"> stacks, not <pre>.
//   2. Checklists are <ul data-checked="…">, not <li><input type=checkbox>>.
//   3. Nested lists are flat <li class="ql-indent-N">, not nested <ul>/<ol>.

import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
})
turndown.use(gfm)

// Quill represents a blank line as <p><br></p>; markdown has no equivalent
// (blank lines collapse), so emit a lone <br> paragraph — marked converts
// that straight back to <p><br></p>, making vertical spacing round-trip
// safe instead of silently disappearing (BBW-2).
turndown.addRule('quillBlankLine', {
  filter: (node) =>
    node.nodeName === 'P' &&
    (node.childNodes.length === 0 ||
      (node.childNodes.length === 1 && node.firstChild.nodeName === 'BR')),
  replacement: () => '\n\n<br>\n\n',
})

// Alignment / indent / direction classes live on paragraphs and headings;
// turndown's built-in block rules outrank keep(), so these need a rule of
// their own to survive as literal HTML.
turndown.addRule('quillBlockFormat', {
  filter: (node) =>
    /^(P|H[1-6])$/.test(node.nodeName) &&
    /\bql-(align|indent|direction)-/.test(node.getAttribute('class') || ''),
  replacement: (content, node) => `\n\n${node.outerHTML}\n\n`,
})

// Formats markdown cannot express ride along as literal HTML instead of
// being stripped (BBW-2: highlights vanished on every round trip). Markdown
// permits embedded HTML, marked passes it through, and Quill reads it as its
// own formatting again.
turndown.keep((node) => {
  const name = node.nodeName
  if (name === 'U' || name === 'SUB' || name === 'SUP') return true
  // Highlight / text colour, and Quill font & size runs.
  if (name === 'SPAN') {
    return (
      Boolean(node.getAttribute('style')) ||
      /\bql-(font|size)-/.test(node.getAttribute('class') || '')
    )
  }
  return false
})

function convertCodeBlocks(doc) {
  doc.body.querySelectorAll('.ql-code-block-container').forEach((container) => {
    const lines = [...container.querySelectorAll('.ql-code-block')]
    const lang = lines[0]?.dataset.language
    const pre = doc.createElement('pre')
    const code = doc.createElement('code')
    if (lang && lang !== 'plain') code.className = `language-${lang}`
    code.textContent = lines.map((l) => l.textContent).join('\n')
    pre.appendChild(code)
    container.replaceWith(pre)
  })
}

// Quill has no concept of "loose" lists, and the gfm task-list rule only
// recognises a checkbox that sits directly under its <li> — so unwrap the
// paragraph wrappers markdown round trips introduce (BBW-2 family).
function unwrapListItemParagraphs(doc) {
  doc.body.querySelectorAll('li > p').forEach((p) => {
    const li = p.parentNode
    while (p.firstChild) li.insertBefore(p.firstChild, p)
    p.remove()
  })
}

// The gfm plugin renders task items from <li><input type=checkbox>…, which is
// exactly what we build here from Quill's data-checked list attribute.
function convertChecklists(doc) {
  doc.body.querySelectorAll('ul[data-checked]').forEach((ul) => {
    const checked = ul.getAttribute('data-checked') === 'true'
    ul.querySelectorAll(':scope > li').forEach((li) => {
      const box = doc.createElement('input')
      box.type = 'checkbox'
      if (checked) box.setAttribute('checked', '')
      li.prepend(box)
    })
  })
}

// Rebuild Quill's flat indent-class lists as genuinely nested lists.
function nestIndentedLists(doc) {
  doc.body.querySelectorAll('ol, ul').forEach((list) => {
    const items = [...list.children].filter((el) => el.tagName === 'LI')
    if (!items.some((li) => /ql-indent-\d/.test(li.className))) return

    const root = doc.createElement(list.tagName)
    const stack = [{ level: 0, list: root }]
    let lastLi = null

    for (const li of items) {
      const match = li.className.match(/ql-indent-(\d+)/)
      const level = match ? Number(match[1]) : 0
      li.removeAttribute('class')

      while (stack.length > 1 && level < stack[stack.length - 1].level) stack.pop()
      if (level > stack[stack.length - 1].level && lastLi) {
        const sub = doc.createElement(list.tagName)
        lastLi.appendChild(sub)
        stack.push({ level, list: sub })
      }
      stack[stack.length - 1].list.appendChild(li)
      lastLi = li
    }
    list.replaceWith(root)
  })
}

// marked re-parses our lone "<br>" blank-line marker as a top-level HTML
// block (no <p> wrapper), so canonical round trips see body-level <br>s.
// Rewrap them so the quillBlankLine rule fires identically every pass.
function rewrapBareLineBreaks(doc) {
  ;[...doc.body.children].forEach((el) => {
    if (el.tagName === 'BR') {
      const p = doc.createElement('p')
      el.replaceWith(p)
      p.appendChild(el)
    }
  })
}

function stripArtifacts(doc) {
  // Editor cursor markers that sometimes leak into saved content.
  doc.body.querySelectorAll('.ql-cursor').forEach((el) => el.remove())
  // Video embeds have no Markdown equivalent — degrade to a plain link.
  doc.body.querySelectorAll('iframe').forEach((frame) => {
    const src = frame.getAttribute('src') || ''
    if (src) {
      const link = doc.createElement('a')
      link.href = src
      link.textContent = src
      frame.replaceWith(link)
    } else {
      frame.remove()
    }
  })
}

export function quillHtmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  convertCodeBlocks(doc)
  unwrapListItemParagraphs(doc)
  convertChecklists(doc)
  nestIndentedLists(doc)
  rewrapBareLineBreaks(doc)
  stripArtifacts(doc)
  return turndown.turndown(doc.body.innerHTML)
}
