import React, { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import cytoscape from 'cytoscape'
import type { Entity, Relation } from '../shared/contracts.ts'

export function Modal({
  title,
  children,
  close,
}: {
  title: string
  children: React.ReactNode
  close: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus()
    return () => previous?.focus()
  }, [])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={root}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Tab') {
            const items = [
              ...(root.current?.querySelectorAll<HTMLElement>(
                'button,input,select,textarea,[tabindex="0"]',
              ) ?? []),
            ].filter((x) => !x.hasAttribute('disabled'))
            const first = items[0],
              last = items[items.length - 1]
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last?.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
export function TextEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (text: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const callback = useRef(onChange)
  callback.current = onChange
  const editor = useRef<EditorView>()
  useEffect(() => {
    const view = new EditorView({
      parent: root.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          markdown(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': 'Manuscript editor',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callback.current(update.state.doc.toString())
          }),
          EditorView.theme({
            '&': { color: 'var(--m-text)', backgroundColor: 'var(--m-panel)' },
            '.cm-gutters': {
              backgroundColor: 'var(--m-bg)',
              color: 'var(--m-muted)',
              border: 'none',
            },
          }),
        ],
      }),
    })
    editor.current = view
    return () => view.destroy()
  }, [])
  useEffect(() => {
    const view = editor.current
    if (view && value !== view.state.doc.toString())
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      })
  }, [value])
  return <div className="editor" ref={root} />
}
export function StoryGraph({
  nodes,
  edges,
  select,
  focus,
  route,
}: {
  nodes: Entity[]
  edges: Relation[]
  select: (id: string) => void
  focus?: string
  route?: string[]
}) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!root.current) return
    const css = getComputedStyle(root.current)
    const accent = css.getPropertyValue('--m-accent').trim() || '#28604e'
    const text = css.getPropertyValue('--m-text').trim() || '#222'
    const line = css.getPropertyValue('--m-line').trim() || '#ccc'
    const graph = cytoscape({
      container: root.current,
      elements: [
        ...nodes.map((n) => ({
          data: { id: n.id, label: n.name },
          classes: n.id === focus ? 'focused' : route?.includes(n.id) ? 'path' : '',
        })),
        ...edges.map((e) => ({
          data: { id: e.id, source: e.from, target: e.to, label: e.kind },
        })),
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeDimensionsIncludeLabels: true,
      },
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': accent,
            color: text,
            'font-size': 11,
            width: 22,
            height: 22,
            'text-valign': 'bottom',
            'text-margin-y': 8,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.2,
            'line-color': line,
            'target-arrow-color': line,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
        {
          selector: '.focused,.path',
          style: {
            width: 34,
            height: 34,
            'border-width': 3,
            'border-color': text,
          },
        },
      ],
    })
    graph.on('tap', 'node', (e) => select(e.target.id()))
    const resize = new ResizeObserver(() => graph.resize())
    resize.observe(root.current)
    return () => {
      resize.disconnect()
      graph.destroy()
    }
  }, [nodes, edges, focus, route])
  return (
    <div className="graph" ref={root} aria-label="Story relationships; equivalent list follows" />
  )
}
export function findPath(from: string, to: string, edges: Relation[]): string[] {
  const queue: string[][] = [[from]]
  const seen = new Set([from])
  while (queue.length) {
    const path = queue.shift()!
    const end = path[path.length - 1]
    if (end === to) return path
    for (const edge of edges) {
      const next = edge.from === end ? edge.to : edge.to === end ? edge.from : undefined
      if (next && !seen.has(next)) {
        seen.add(next)
        queue.push([...path, next])
      }
    }
  }
  return []
}
