import { ViewPlugin, Decoration, EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

// Vertical rhythm copied from Bluebird Documentation's Quill editor
// (DocEditorMakeover.css / Document.css) so a note is spaced the same in both
// apps (BBW-5). In Quill every Enter starts a new block, and each block
// carries a bottom margin, so one Enter already leaves a visible gap. A
// single Enter here syncs over as exactly that (see markdown.js), so every
// editor line gets the same gap, and the exceptions are the blocks that
// Quill keeps tight.
export const LINE_HEIGHT = 1.6
export const PARA_GAP = 0.7 // em — Quill's p / list / quote / code margin-bottom
const HEADING_TOP = 0.95 // em of the heading's own size
const HEADING_BOTTOM = 0.4
const LIST_ITEM_GAP = '3px' // Quill's li margin-bottom

// Heading sizes live on the line (not the text span) so the heading's
// padding is measured in its own em, the way Quill's margins are.
const HEADING_SIZES = { 1: 1.6, 2: 1.35, 3: 1.18, 4: 1.05, 5: 1, 6: 1 }

// Quill's margins collapse (a paragraph's 0.7em bottom and a heading's top
// overlap); line padding does not, so a heading only pads by the difference.
const headingTheme = {}
for (const [level, size] of Object.entries(HEADING_SIZES)) {
  headingTheme[`.cm-line.cm-bb-h${level}`] = {
    fontSize: `${size}em`,
    paddingTop: `${Math.max(0, HEADING_TOP - PARA_GAP / size).toFixed(3)}em`,
    paddingBottom: `${HEADING_BOTTOM}em`,
  }
}

export const spacingTheme = EditorView.theme({
  '.cm-line': { paddingBottom: `${PARA_GAP}em` },
  ...headingTheme,
  '.cm-line.cm-bb-item': { paddingBottom: LIST_ITEM_GAP },
  '.cm-line.cm-bb-tight': { paddingBottom: '0' },
  '.cm-line.cm-bb-flush': { paddingTop: '0' },
})

// Blocks whose inner lines sit flush in Quill: only the block as a whole
// gets the paragraph gap, on its last line.
const TIGHT_BLOCKS = { FencedCode: 'cm-bb-tight', CodeBlock: 'cm-bb-tight', Table: 'cm-bb-tight', BulletList: 'cm-bb-item', OrderedList: 'cm-bb-item' }

// Spans that are code, addresses or markup rather than prose — the spell
// checker would underline nearly every one of them (BBW-4).
const NO_SPELLCHECK = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'URL', 'Autolink', 'HTMLTag', 'HTMLBlock', 'CommentBlock', 'Comment'])
const noSpellcheck = Decoration.mark({ attributes: { spellcheck: 'false' } })

const lineDeco = new Map()
function lineClass(cls) {
  if (!lineDeco.has(cls)) lineDeco.set(cls, Decoration.line({ class: cls }))
  return lineDeco.get(cls)
}

function build(view) {
  const { doc } = view.state
  const tree = syntaxTree(view.state)
  const lines = new Map() // line start -> classes
  const marks = []
  const addClass = (pos, cls) => {
    const list = lines.get(pos) || []
    list.push(cls)
    lines.set(pos, list)
  }

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        if (NO_SPELLCHECK.has(name) && node.to > node.from) {
          marks.push(noSpellcheck.range(node.from, node.to))
        }

        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name)
        if (heading) {
          const first = doc.lineAt(node.from)
          const last = doc.lineAt(node.to)
          for (let n = first.number; n <= last.number; n++) {
            const line = doc.line(n)
            addClass(line.from, `cm-bb-h${heading[1]}`)
            if (n === 1) addClass(line.from, 'cm-bb-flush')
          }
          return false
        }

        const tight = TIGHT_BLOCKS[name]
        if (tight) {
          const first = doc.lineAt(Math.max(node.from, from))
          const last = doc.lineAt(node.to)
          const stop = Math.min(last.number - 1, doc.lineAt(to).number)
          for (let n = first.number; n <= stop; n++) addClass(doc.line(n).from, tight)
          // Code is one opaque span; lists and tables still hold inline
          // code / links that need their spellcheck marks.
          return name === 'FencedCode' || name === 'CodeBlock' ? false : undefined
        }
        return undefined
      },
    })
  }

  const ranges = [...marks]
  for (const [pos, classes] of lines) {
    // A list nested in a list is visited twice; keep one of each class.
    ranges.push(lineClass([...new Set(classes)].join(' ')).range(pos))
  }
  return Decoration.set(ranges, true)
}

export const blockDecorations = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = build(view)
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
