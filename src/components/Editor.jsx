import { useEffect, useRef } from 'react'
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import '../css/Editor.css'

// Markdown gets styled in place (iA-Writer style) rather than colour-coded
// like source code. Colours come from the suite CSS variables so the same
// definition works in both themes.
const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.6em', fontWeight: '700', letterSpacing: '-0.02em' },
  { tag: tags.heading2, fontSize: '1.35em', fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.18em', fontWeight: '600' },
  { tag: tags.heading4, fontSize: '1.05em', fontWeight: '600' },
  { tag: [tags.heading5, tags.heading6], fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--text-tertiary)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.88em', color: 'var(--accent)' },
  { tag: tags.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--text-tertiary)' },
  { tag: tags.processingInstruction, color: 'var(--text-tertiary)' },
  { tag: tags.contentSeparator, color: 'var(--text-tertiary)' },
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '15.5px',
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-prose)',
    lineHeight: '1.75',
    overflow: 'auto',
  },
  '.cm-content': {
    maxWidth: '760px',
    margin: '0 auto',
    padding: '44px 28px 45vh',
    caretColor: 'var(--accent)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--accent-glow) !important',
  },
  '.cm-placeholder': { color: 'var(--text-placeholder)' },
})

export default function Editor({ initialContent, onChange, onSave }) {
  const hostRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  }, [onChange, onSave])

  // The parent remounts this component per file (key={path}), so the view
  // lives exactly as long as the open document.
  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: initialContent,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          placeholder('Start writing…'),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(mdHighlight),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                onSaveRef.current?.()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          editorTheme,
        ],
      }),
      parent: hostRef.current,
    })
    view.focus()
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="Editor" ref={hostRef} />
}
