import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import cytoscape from 'cytoscape'
import type { Entity, Relation } from '../shared/contracts.ts'
import css from './visualizations.module.css'

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
            '&': {
              color: 'var(--dsw-alias-label-primary)',
              backgroundColor: 'var(--dsw-alias-bg-layer-1)',
            },
            '.cm-gutters': {
              backgroundColor: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-secondary)',
              border: 'none',
            },
            '.cm-cursor': { borderLeftColor: 'var(--dsw-alias-label-primary)' },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
              backgroundColor: 'var(--dsw-alias-state-business-tertiary)',
            },
            '.cm-content ::selection': {
              backgroundColor: 'var(--dsw-alias-state-business-tertiary)',
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
  return <div className={css.editor} ref={root} />
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
    const token = (name: string) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${name})`
      root.current!.append(probe)
      const value = getComputedStyle(probe).color
      probe.remove()
      return value
    }
    const accent = token('--dsw-alias-state-business-primary')
    const text = token('--dsw-alias-label-primary')
    const line = token('--dsw-alias-border-l2')
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
    const updateTheme = () => {
      const nextAccent = token('--dsw-alias-state-business-primary')
      const nextText = token('--dsw-alias-label-primary')
      const nextLine = token('--dsw-alias-border-l2')
      graph
        .style()
        .selector('node')
        .style({ 'background-color': nextAccent, color: nextText })
        .selector('edge')
        .style({ 'line-color': nextLine, 'target-arrow-color': nextLine })
        .selector('.focused,.path')
        .style({ 'border-color': nextText })
        .update()
    }
    const theme = new MutationObserver(updateTheme)
    theme.observe(document.documentElement, {
      attributes: true,
    })
    theme.observe(document.body, {
      attributes: true,
    })
    const resize = new ResizeObserver(() => graph.resize())
    resize.observe(root.current)
    return () => {
      resize.disconnect()
      theme.disconnect()
      graph.destroy()
    }
  }, [nodes, edges, focus, route])
  return (
    <div
      className={css.graph}
      ref={root}
      aria-label="Story relationships; equivalent list follows"
    />
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
