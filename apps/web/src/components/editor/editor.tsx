import { useRef } from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { ListPlugin } from "@lexical/react/LexicalListPlugin"
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { ListItemNode, ListNode } from "@lexical/list"
import { CodeHighlightNode, CodeNode } from "@lexical/code"
import { AutoLinkNode, LinkNode } from "@lexical/link"
import { $getRoot } from "lexical"
import { editorTheme } from "./theme"
import { ToolbarPlugin } from "./plugins/toolbar-plugin"
import type { EditorState } from "lexical"

export interface EditorPayload {
  stateJson: unknown
  text: string
}

export function Editor({
  initialStateJson,
  onChange,
  placeholder = "tell your story…",
  readOnly = false,
}: {
  initialStateJson?: unknown
  onChange?: (payload: EditorPayload) => void
  placeholder?: string
  readOnly?: boolean
}) {
  // LexicalComposer's `editorState` accepts a string (serialized JSON) or an initializer function.
  const initialEditorState = initialStateJson
    ? JSON.stringify(initialStateJson)
    : undefined
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  return (
    <LexicalComposer
      initialConfig={{
        namespace: "article-editor",
        theme: editorTheme,
        onError(err) {
          console.error("[lexical]", err)
        },
        nodes: [
          HeadingNode,
          QuoteNode,
          ListNode,
          ListItemNode,
          CodeNode,
          CodeHighlightNode,
          LinkNode,
          AutoLinkNode,
        ],
        editable: !readOnly,
        editorState: initialEditorState,
      }}
    >
      {!readOnly && <ToolbarPlugin />}
      <div className="relative px-4 py-4 text-sm leading-relaxed focus-within:outline-none">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="min-h-[40vh] outline-none [&>*:first-child]:!mt-0"
              aria-placeholder={placeholder}
              placeholder={
                <div className="pointer-events-none absolute top-4 left-4 leading-relaxed text-muted-foreground select-none">
                  {placeholder}
                </div>
              }
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      {onChange && (
        <OnChangePlugin
          onChange={(state: EditorState) => {
            state.read(() => {
              const text = $getRoot().getTextContent()
              const stateJson = state.toJSON()
              onChangeRef.current?.({ stateJson, text })
            })
          }}
        />
      )}
    </LexicalComposer>
  )
}
