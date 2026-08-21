import { useMemo, useState } from 'react'
import { renderMarkdown } from '../lib/markdown'
import '../css/Preview.css'
import '../css/Guide.css'

// Cheat-sheet content. Every example is rendered with the same renderMarkdown()
// the preview uses, so what the guide shows is exactly what the app produces.
const SECTIONS = [
  {
    id: 'basics',
    title: 'The basics',
    items: [
      {
        label: 'Headings',
        md: ['# Title', '## Section', '### Sub-section'].join('\n'),
        note: 'One # per level, up to six. Always leave a space after the hashes.',
      },
      {
        label: 'Bold, italic & strikethrough',
        md: '**Bold**, *italic*, ***both*** and ~~crossed out~~.',
      },
      {
        label: 'Paragraphs & line breaks',
        md: [
          'A blank line starts a new paragraph.',
          '',
          'End a line with two spaces  ',
          'to break the line without a new paragraph.',
        ].join('\n'),
        note: 'A single newline on its own is treated as a space, not a line break.',
      },
    ],
  },
  {
    id: 'lists',
    title: 'Lists',
    items: [
      {
        label: 'Bulleted list',
        md: ['- Coffee', '- Tea', '    - Green', '    - Black'].join('\n'),
        note: 'Indent by four spaces (or one tab) to nest an item.',
      },
      {
        label: 'Numbered list',
        md: ['1. Open a folder', '2. Write a note', '3. It saves itself'].join('\n'),
        note: 'The numbers you type do not have to be in order — the renderer counts for you.',
      },
      {
        label: 'Task list',
        md: ['- [x] Draft the outline', '- [ ] Write the intro', '- [ ] Proofread'].join('\n'),
      },
    ],
  },
  {
    id: 'links',
    title: 'Links, images & quotes',
    items: [
      {
        label: 'Links',
        md: 'Read the [Bluebird docs](https://bluebird-documentation.com) or paste a bare URL: https://example.com',
        note: 'Links open in your system browser rather than inside the app window.',
      },
      {
        label: 'Images',
        md: '![A blue sky](https://example.com/sky.png)',
        note: 'A full https:// URL always works. Local paths resolve against the app window, not your notes folder, so they may not display.',
      },
      {
        label: 'Blockquote',
        md: ['> Writing is thinking on paper.', '>', '> — someone, probably'].join('\n'),
      },
    ],
  },
  {
    id: 'code',
    title: 'Code',
    items: [
      {
        label: 'Inline code',
        md: 'Run `npm run dev` to start the app.',
      },
      {
        label: 'Code block',
        md: ['```js', "console.log('hello')", '```'].join('\n'),
        note: 'Three backticks open and close the block. The word after the opening fence names the language.',
      },
    ],
  },
  {
    id: 'structure',
    title: 'Structure',
    items: [
      {
        label: 'Horizontal rule',
        md: ['Above the line.', '', '---', '', 'Below the line.'].join('\n'),
      },
      {
        label: 'Table',
        md: [
          '| Feature | Shortcut |',
          '| --- | ---: |',
          '| Save | Ctrl+S |',
          '| Sidebar | Ctrl+B |',
        ].join('\n'),
        note: 'Add a colon in the divider row to align a column: --- left, :---: centre, ---: right.',
      },
    ],
  },
  {
    id: 'escaping',
    title: 'When Markdown gets in the way',
    items: [
      {
        label: 'Escaping characters',
        md: 'Type \\*asterisks\\* or \\_underscores\\_ literally by putting a backslash first.',
      },
      {
        label: 'Raw HTML',
        md: 'Simple tags such as <strong>this one</strong> are allowed.',
        note: 'HTML is sanitised before it renders, so scripts and other unsafe tags are stripped.',
      },
      {
        label: 'Highlight & text colour',
        md: 'Markdown has no syntax for these, so use HTML: <span style="background-color: rgba(251, 191, 36, 0.35);">highlighted</span> and <span style="color: #e5484d;">coloured</span> text.',
        note: 'Syncing keeps these intact — they arrive in Bluebird Documentation as real highlights and text colours, and highlighted documents pull back the same way.',
      },
    ],
  },
]

const SHORTCUTS = [
  ['Ctrl', 'S', 'Save now'],
  ['Ctrl', 'B', 'Toggle the sidebar'],
  ['Ctrl', 'E', 'Cycle Write / Split / Preview'],
  ['Ctrl', 'G', 'Toggle this guide'],
]

// Parse once at module load — the snippets never change.
const RENDERED = SECTIONS.map((section) => ({
  ...section,
  items: section.items.map((item) => ({
    ...item,
    id: `${section.id}:${item.label}`,
    html: renderMarkdown(item.md),
  })),
}))

function matches(item, query) {
  const haystack = `${item.label} ${item.md} ${item.note || ''}`.toLowerCase()
  return haystack.includes(query)
}

export default function Guide({ onClose }) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(null)

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return RENDERED
    return RENDERED.map((s) => ({ ...s, items: s.items.filter((i) => matches(i, q)) })).filter(
      (s) => s.items.length
    )
  }, [query])

  const copy = async (item) => {
    try {
      await navigator.clipboard.writeText(item.md)
      setCopied(item.id)
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 1400)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  return (
    <div className="Guide">
      <header className="Guide__bar">
        <span className="Guide__bar-title">Markdown guide</span>
        <input
          className="Guide__search"
          type="search"
          value={query}
          placeholder="Search…"
          aria-label="Search the Markdown guide"
          onChange={(e) => setQuery(e.target.value)}
        />
        {onClose && (
          <button className="Guide__close" title="Close guide (Ctrl+G)" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </header>

      <div className="Guide__body">
        <div className="Guide__inner">
          {!query && (
            <p className="Guide__intro">
              Markdown is plain text with a few punctuation marks that mean “make this a heading”,
              “make this bold”, and so on. Type the left-hand column, get the right-hand column.
            </p>
          )}

          {sections.map((section) => (
            <section key={section.id} className="Guide__section">
              <h2 className="Guide__section-title">{section.title}</h2>
              {section.items.map((item) => (
                <article key={item.id} className="GuideCard">
                  <div className="GuideCard__head">
                    <h3 className="GuideCard__label">{item.label}</h3>
                    <button
                      className="GuideCard__copy"
                      onClick={() => copy(item)}
                      title="Copy this snippet"
                    >
                      {copied === item.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="GuideCard__panes">
                    <pre className="GuideCard__source">{item.md}</pre>
                    <div
                      className="Preview__content GuideCard__rendered"
                      dangerouslySetInnerHTML={{ __html: item.html }}
                    />
                  </div>
                  {item.note && <p className="GuideCard__note">{item.note}</p>}
                </article>
              ))}
            </section>
          ))}

          {!sections.length && <p className="Guide__empty">Nothing matches “{query}”.</p>}

          {!query && (
            <section className="Guide__section">
              <h2 className="Guide__section-title">Shortcuts</h2>
              <ul className="Guide__shortcuts">
                {SHORTCUTS.map(([mod, key, description]) => (
                  <li key={key}>
                    <span className="Guide__keys">
                      <kbd>{mod}</kbd>
                      <kbd>{key}</kbd>
                    </span>
                    {description}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
