/**
 * WYSIWYG-редактор описания товара (TipTap/ProseMirror). Живёт только в чанке админки.
 * Модель документа — src/cms/descriptionDoc.ts; здесь только привязка к редактору:
 * автожирный абзацев, «Автосписок»/«Нумерация», B/I, история, вставка обычного текста.
 */
import { useEffect, useRef } from 'react'
import { Extension, type Editor as CoreEditor } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Paragraph from '@tiptap/extension-paragraph'
import { ListItem } from '@tiptap/extension-list'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import {
  applyListToBlocks,
  currentBlockRange,
  textToBlocks,
  type DescriptionDoc,
  type DocBlock,
  type ListKind,
} from '../cms/descriptionDoc'
import admin from './Admin.module.css'

/** Абзац с атрибутом autoBold (по умолчанию true; при Enter новый абзац снова получает true). */
const AutoParagraph = Paragraph.extend({
  addAttributes() {
    return {
      autoBold: {
        default: true,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute('data-auto-bold') !== 'false',
        renderHTML: (attrs) => (attrs.autoBold === false ? { 'data-auto-bold': 'false' } : {}),
      },
    }
  },
})

/** Пункт списка — ровно один абзац: без вложенных списков (Tab не создаёт вложенность). */
const FlatListItem = ListItem.extend({
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => true,
      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
    }
  },
})

const autoBoldKey = new PluginKey('autoBold')

/** Автожирный: каждый абзац верхнего уровня с autoBold целиком жирный. Пункты списков не трогаются. */
const AutoBold = Extension.create({
  name: 'autoBold',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: autoBoldKey,
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null
          const bold = state.schema.marks.bold!
          let tr = state.tr
          let changed = false
          state.doc.forEach((node, offset) => {
            if (node.type.name !== 'paragraph' || node.attrs.autoBold === false || node.content.size === 0) return
            let needs = false
            node.descendants((child) => {
              if (child.isText && !bold.isInSet(child.marks)) needs = true
            })
            if (needs) {
              tr = tr.addMark(offset + 1, offset + 1 + node.content.size, bold.create())
              changed = true
            }
          })
          return changed ? tr.setMeta('addToHistory', true) : null
        },
      }),
    ]
  },
})

function topIndex(doc: PMNode, pos: number): number {
  return doc.resolve(Math.min(pos, doc.content.size)).index(0)
}

function blockStart(doc: PMNode, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
  return pos
}

/** «Автосписок» / «Нумерация»: выделенные строки или текущий блок → список одной транзакцией (одна запись истории). */
function applyList(editor: CoreEditor, kind: ListKind): boolean {
  const { state, view } = editor
  const { doc, selection } = state
  const hadSelection = !selection.empty
  let from = topIndex(doc, selection.from)
  let to = topIndex(doc, selection.empty ? selection.from : selection.to - (selection.to > selection.from ? 1 : 0))
  if (to < from) to = from
  const blocks: DocBlock[] = []
  doc.forEach((n) => blocks.push(n.toJSON() as DocBlock))
  if (!hadSelection) [from, to] = currentBlockRange(blocks, from)
  const next = applyListToBlocks(blocks.slice(from, to + 1), kind)
  const nodes = next.map((b) => state.schema.nodeFromJSON(b))
  const start = blockStart(doc, from)
  const end = blockStart(doc, to + 1)
  // Команда — отдельный шаг истории (не склеивается с набором текста).
  let tr = closeHistory(state.tr).replaceWith(start, end, nodes)
  const size = nodes.reduce((s, n) => s + n.nodeSize, 0)
  const sel = hadSelection
    ? TextSelection.between(tr.doc.resolve(start), tr.doc.resolve(start + size), 1)
    : TextSelection.near(tr.doc.resolve(Math.min(start + size - 1, tr.doc.content.size)), -1)
  tr = tr.setSelection(sel).scrollIntoView()
  view.dispatch(closeHistory(tr))
  view.focus()
  return true
}

/** B: при снятии жирного с абзаца с автожирным абзац помечается autoBold:false, чтобы жирный не вернулся сам. */
function toggleBold(editor: CoreEditor): boolean {
  const { state } = editor
  const removing = editor.isActive('bold')
  if (state.selection.empty || !removing) return editor.chain().focus().toggleBold().run()
  const { from, to } = state.selection
  let tr = closeHistory(state.tr)
  state.doc.forEach((node, offset) => {
    const end = offset + node.nodeSize
    if (node.type.name === 'paragraph' && node.attrs.autoBold !== false && end > from && offset < to) {
      tr = tr.setNodeMarkup(offset, undefined, { ...node.attrs, autoBold: false })
    }
  })
  tr = tr.removeMark(from, to, state.schema.marks.bold!)
  editor.view.dispatch(tr)
  editor.view.focus()
  return true
}

function toDoc(json: { content?: unknown[] }): DescriptionDoc {
  return { type: 'doc', version: 1, content: (json.content ?? []) as DocBlock[] }
}

export interface DescriptionEditorProps {
  value: DescriptionDoc
  /** При изменении — содержимое редактора заменяется на value (восстановление черновика, «Отменить правки»). */
  resetToken: number
  disabled?: boolean
  onChange: (doc: DescriptionDoc) => void
}

export default function DescriptionEditor({ value, resetToken, disabled, onChange }: DescriptionEditorProps) {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: false,
        listItem: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
        link: false,
        underline: false,
        trailingNode: false,
        dropcursor: false,
        gapcursor: false,
        heading: { levels: [3, 4] },
        undoRedo: { depth: 200, newGroupDelay: 600 },
      }),
      AutoParagraph,
      FlatListItem,
      AutoBold,
    ],
    content: value,
    editable: !disabled,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: admin.richEditor,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Описание товара',
        spellcheck: 'true',
        autocapitalize: 'sentences',
      },
      // Вставка: только обычный текст (HTML из буфера не принимается). Многострочный текст сохраняет структуру.
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain') ?? ''
        event.preventDefault()
        if (!text) return true
        if (!/[\r\n]/.test(text)) {
          view.dispatch(view.state.tr.insertText(text).scrollIntoView())
          return true
        }
        const blocks = textToBlocks(text)
        if (blocks.length) editorRef.current?.chain().focus().insertContent(blocks).run()
        return true
      },
      handleDrop: (_view, event) => {
        // Перетаскивание внешнего HTML/файлов отключено; внутри редактора — штатно.
        const dt = (event as DragEvent).dataTransfer
        return !!dt && (dt.files.length > 0 || (dt.types.includes('text/html') && !dt.types.includes('application/x-prosemirror')))
      },
    },
    onUpdate: ({ editor: e }) => onChangeRef.current(toDoc(e.getJSON())),
  })
  const editorRef = useRef<CoreEditor | null>(null)
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  const lastReset = useRef(resetToken)
  useEffect(() => {
    if (!editor || lastReset.current === resetToken) return
    lastReset.current = resetToken
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, resetToken, value])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  })

  const btn = (label: string, title: string, active: boolean, run: () => void, enabled = true, wide = false) => (
    <button
      type="button"
      className={`${admin.tbBtn} ${wide ? admin.tbWide : ''} ${active ? admin.tbActive : ''}`}
      aria-pressed={active}
      aria-label={title}
      title={title}
      disabled={disabled || !enabled || !editor}
      // Не забирать фокус у редактора — выделение сохраняется.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  )

  return (
    <div className={admin.richWrap}>
      <div className={admin.toolbar} role="toolbar" aria-label="Форматирование описания">
        {btn('B', 'Жирный', !!s?.bold, () => editor && toggleBold(editor))}
        {btn('I', 'Курсив', !!s?.italic, () => editor?.chain().focus().toggleItalic().run())}
        {btn('• Автосписок', 'Автосписок', !!s?.bullet, () => editor && applyList(editor, 'bulletList'), true, true)}
        {btn('1. Нумерация', 'Нумерация', !!s?.ordered, () => editor && applyList(editor, 'orderedList'), true, true)}
        <span className={admin.tbSep} aria-hidden="true" />
        {btn('↶', 'Отменить', false, () => editor?.chain().focus().undo().run(), !!s?.canUndo)}
        {btn('↷', 'Повторить', false, () => editor?.chain().focus().redo().run(), !!s?.canRedo)}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
