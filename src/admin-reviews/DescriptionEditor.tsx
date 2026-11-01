/**
 * WYSIWYG-редактор описания товара (TipTap/ProseMirror). Живёт только в чанке админки.
 * Модель документа — src/cms/descriptionDoc.ts; здесь только привязка к редактору:
 * автожирный абзацев, «Автосписок»/«Нумерация», «Заголовок секции», B/I, история, вставка обычного текста,
 * панель секций (свернуть/вверх/вниз/дублировать/удалить). Каждая команда — отдельный шаг истории.
 */
import { useEffect, useRef } from 'react'
import { Extension, type Editor as CoreEditor } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Paragraph from '@tiptap/extension-paragraph'
import { ListItem } from '@tiptap/extension-list'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
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
import { deleteSection, duplicateSection, headingFromSelection, moveSection, sectionRanges } from '../cms/sections'
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

const collapseKey = new PluginKey<number[]>('collapse')

/**
 * Свёрнутые секции — только вид в редакторе (на документ и сайт не влияет): блоки после свёрнутого
 * заголовка до следующего заголовка скрываются декорациями. Позиции заголовков сдвигаются вместе с правками.
 */
const Collapse = Extension.create({
  name: 'sectionCollapse',
  addProseMirrorPlugins() {
    return [
      new Plugin<number[]>({
        key: collapseKey,
        state: {
          init: () => [],
          apply: (tr, value, _old, state) => {
            const meta = tr.getMeta(collapseKey) as { toggle?: number; clear?: boolean } | undefined
            if (meta?.clear) return []
            let next = tr.docChanged ? value.map((p) => tr.mapping.map(p)) : value
            next = next.filter((p) => p < state.doc.content.size && state.doc.nodeAt(p)?.type.name === 'heading')
            if (meta?.toggle !== undefined) next = next.includes(meta.toggle) ? next.filter((p) => p !== meta.toggle) : [...next, meta.toggle]
            return [...new Set(next)]
          },
        },
        props: {
          decorations: (state) => {
            const collapsed = collapseKey.getState(state) ?? []
            if (!collapsed.length) return null
            const decos: Decoration[] = []
            let hiding = false
            state.doc.forEach((node, offset) => {
              if (node.type.name === 'heading') {
                hiding = collapsed.includes(offset)
                if (hiding) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: admin.headingCollapsed ?? '' }))
              } else if (hiding) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: admin.collapsedBlock ?? '' }))
            })
            return DecorationSet.create(state.doc, decos)
          },
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

function blocksOf(state: EditorState): DocBlock[] {
  const blocks: DocBlock[] = []
  state.doc.forEach((n) => blocks.push(n.toJSON() as DocBlock))
  return blocks
}

/**
 * «Заголовок секции»: выделенный фрагмент внутри абзаца становится отдельным заголовком (текст до и после
 * остаётся абзацами); без выделения — абзац ⇄ заголовок. В списках недоступно.
 */
function applySectionHeading(editor: CoreEditor): boolean {
  const { state, view } = editor
  const { doc, selection } = state
  const index = topIndex(doc, selection.from)
  const node = doc.child(index)
  if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return false
  const start = blockStart(doc, index)
  const inner = node.content.size
  const sameBlock = topIndex(doc, selection.to) === index
  const from = selection.empty || !sameBlock ? 0 : Math.max(0, selection.from - start - 1)
  const to = selection.empty || !sameBlock ? 0 : Math.min(inner, selection.to - start - 1)
  const next = headingFromSelection(node.toJSON() as Parameters<typeof headingFromSelection>[0], from, to)
  const nodes = next.map((b) => state.schema.nodeFromJSON(b))
  let tr = closeHistory(state.tr).replaceWith(start, start + node.nodeSize, nodes)
  // Курсор — в конец нового заголовка (или блока).
  const hIdx = Math.max(0, next.findIndex((b) => b.type === 'heading'))
  let pos = start
  for (let i = 0; i < hIdx; i++) pos += nodes[i]!.nodeSize
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + nodes[hIdx]!.nodeSize - 1, tr.doc.content.size)), -1)).scrollIntoView()
  view.dispatch(closeHistory(tr))
  view.focus()
  return true
}

/** Операция над секциями — весь документ заменяется одной транзакцией (один шаг «Отменить»). */
function applySectionOp(editor: CoreEditor, op: (blocks: DocBlock[]) => DocBlock[]): void {
  const { state, view } = editor
  const nodes = op(blocksOf(state)).map((b) => state.schema.nodeFromJSON(b))
  let tr = closeHistory(state.tr).replaceWith(0, state.doc.content.size, nodes)
  tr = tr.setMeta(collapseKey, { clear: true })
  view.dispatch(closeHistory(tr))
}

function toggleCollapse(editor: CoreEditor, sectionIndex: number): void {
  const r = sectionRanges(blocksOf(editor.state))[sectionIndex]
  if (!r || !r.hasHeading) return
  editor.view.dispatch(editor.state.tr.setMeta(collapseKey, { toggle: blockStart(editor.state.doc, r.start) }).setMeta('addToHistory', false))
}

function toDoc(json: { content?: unknown[] }): DescriptionDoc {
  return { type: 'doc', version: 1, content: (json.content ?? []) as DocBlock[] }
}

interface SectionItem {
  index: number
  title: string
  collapsed: boolean
}

/** Секции с заголовком (строкой JSON — чтобы useEditorState сравнивал по значению). */
function sectionList(editor: CoreEditor): string {
  const { state } = editor
  const collapsed = collapseKey.getState(state) ?? []
  const items: SectionItem[] = []
  const blocks = blocksOf(state)
  sectionRanges(blocks).forEach((r, index) => {
    if (!r.hasHeading) return
    items.push({ index, title: state.doc.child(r.start).textContent.slice(0, 80), collapsed: collapsed.includes(blockStart(state.doc, r.start)) })
  })
  return JSON.stringify(items)
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
      Collapse,
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
      heading: e?.isActive('heading') ?? false,
      inList: (e?.isActive('bulletList') || e?.isActive('orderedList')) ?? false,
      sections: e ? sectionList(e) : '[]',
    }),
  })

  const sections = JSON.parse(s?.sections ?? '[]') as SectionItem[]
  const secBtn = (label: string, title: string, run: () => void, enabled = true, pressed?: boolean) => (
    <button
      type="button"
      className={admin.secBtn}
      aria-label={title}
      title={title}
      aria-pressed={pressed}
      disabled={disabled || !enabled || !editor}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  )

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
        {btn('Заголовок секции', 'Заголовок секции', !!s?.heading, () => editor && applySectionHeading(editor), !s?.inList, true)}
        <span className={admin.tbSep} aria-hidden="true" />
        {btn('↶', 'Отменить', false, () => editor?.chain().focus().undo().run(), !!s?.canUndo)}
        {btn('↷', 'Повторить', false, () => editor?.chain().focus().redo().run(), !!s?.canRedo)}
      </div>
      <EditorContent editor={editor} />
      {sections.length ? (
        <ol className={admin.sectionPanel} aria-label="Секции описания" data-testid="desc-sections">
          {sections.map((sec, k) => (
            <li key={`${sec.index}-${sec.title}`} className={admin.sectionRow} data-testid="desc-section-row">
              <span className={admin.sectionTitle}>{sec.title || 'Без названия'}</span>
              <span className={admin.sectionBtns}>
                {secBtn(sec.collapsed ? '▸' : '▾', sec.collapsed ? 'Развернуть секцию' : 'Свернуть секцию', () => editor && toggleCollapse(editor, sec.index), true, sec.collapsed)}
                {secBtn('↑', 'Секцию выше', () => editor && applySectionOp(editor, (b) => moveSection(b, sec.index, -1)), k > 0)}
                {secBtn('↓', 'Секцию ниже', () => editor && applySectionOp(editor, (b) => moveSection(b, sec.index, 1)), k < sections.length - 1)}
                {secBtn('⧉', 'Дублировать секцию', () => editor && applySectionOp(editor, (b) => duplicateSection(b, sec.index)))}
                {secBtn('✕', 'Удалить секцию', () => {
                  if (editor && window.confirm(`Удалить секцию «${sec.title || 'Без названия'}» вместе с текстом? Можно вернуть кнопкой «Отменить».`)) {
                    applySectionOp(editor, (b) => deleteSection(b, sec.index))
                  }
                })}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
