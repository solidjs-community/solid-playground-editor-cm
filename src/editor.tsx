import {
  keymap,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  lineNumbers,
  highlightActiveLineGutter,
  hoverTooltip,
  EditorView,
  type Tooltip
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  completeFromList,
  type CompletionContext,
  type CompletionResult
} from "@codemirror/autocomplete";
import { lintKeymap, linter, Diagnostic } from "@codemirror/lint"
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import {
  createSignal,
  onCleanup,
  createEffect,
  For,
  createUniqueId,
  onMount,
  Accessor,
  Show,
  type JSX,
  type Setter
} from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import ts, { displayPartsToString, flattenDiagnosticMessageText } from "typescript";
import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
  type VirtualTypeScriptEnvironment
} from "@typescript/vfs";
import "./editor.css";

export const createEnv = (files?: Record<string, string>, tsOptions: ts.CompilerOptions = {}): [
  fs: Accessor<Map<string, string> | undefined>,
  env: Accessor<VirtualTypeScriptEnvironment | undefined>
] => {
  const [fs, setFs] = createSignal<Map<string, string>>();
  const [env, setEnv] = createSignal<VirtualTypeScriptEnvironment>();
  onMount(async () => {
    const fsMap = await createDefaultMapFromCDN({
      target: ts.ScriptTarget.ES2021,
      downlevelIteration: true,
      strict: true,
      ...tsOptions
    }, ts.version, true, ts);
    Object.entries(files || {}).forEach(([name, content]) => fsMap.set(name, content));
  
    const system = createSystem(fsMap);
    
    const compilerOpts = {};
    const tsEnv = createVirtualTypeScriptEnvironment(
      system,
      [...fsMap.keys()].filter(name => /\.[jt]sx?$/i.test(name)),
      ts,
      compilerOpts
    );
  
    setFs(fsMap);
    setEnv(tsEnv);
  });
  return [fs, env];
}

export const createCompletionSource = (
  env: VirtualTypeScriptEnvironment,
  fileName: string
) => (ctx: CompletionContext): Promise<CompletionResult | null> => {
  const completions = env.languageService.getCompletionsAtPosition(fileName, ctx.pos, {});
  if (!completions) {
    return Promise.resolve(null);
  }
  return Promise.resolve(completeFromList(completions.entries.map(c => ({
    type: c.kind,
    label: c.name,
    boost: 1 / Number(c.sortText)
  })))(ctx));
};

const severity = ["warning", "error", "info", "info"] as const;

export const createLintDiagnostics = (
  env: VirtualTypeScriptEnvironment,
  fileName: string
) => () => {
  return env.languageService.getSemanticDiagnostics(fileName).reduce((result, item) => {
    if (item.start !== undefined && item.length !== undefined) {
      result.push({
        from: item.start,
        to: item.start + item.length,
        severity: severity[item.category],
        message: flattenDiagnosticMessageText(item.messageText, "\n", 0)
      });
    }
    return result;
  }, [] as Diagnostic[]);
}

export const createHoverTooltipSource = (
  env: VirtualTypeScriptEnvironment,
  fileName: string
) => async (_view: EditorView, pos: number): Promise<Tooltip | null> => {
  const quickInfo = await env.languageService.getQuickInfoAtPosition(fileName, pos);
  return quickInfo ? {
    pos,
    create() {
      const dom = Object.assign(document.createElement("div"), {
        className: "cm-quickinfo-tooltip",
        textContent: displayPartsToString(quickInfo.displayParts)
      });
      console.log(javascript().language.parser.parse(displayPartsToString(quickInfo.displayParts)));
      if (quickInfo.documentation) {
        dom.appendChild(Object.assign(document.createElement("div"), {
          textContent: displayPartsToString(quickInfo.documentation)
        }))
      }
      return {
        dom
      };
    },
    above: false
  } : null;
}

const staticExtensions = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, {fallback: true}),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap
  ]),
];

export type EditorProps = {
  /** current fileName (must be a file available in files) */
  fileName: string,
  /** setter for current fileName - if not present, tabs will not be rendered */
  setFileName?: Setter<string>,
  /** file system store */
  files?: Record<string, string>,
  /** setter for file system store */
  setFiles?: SetStoreFunction<Record<string, string>>,
  /** overwrite for the loading fallback */
  loading?: JSX.Element,
  /** override ts compiler options */
  tsOptions?: ts.CompilerOptions
};

/** Editor for the solid.js playground based on code mirror 6 and typescript's virtual environment */
export const Editor = (props: EditorProps) => {
  const [ref, setRef] = createSignal<HTMLDivElement>();
  const [fs, env] = createEnv(props.files, props.tsOptions);
  createEffect(() => {
    if (fs() && env()) {
      const view = new EditorView({
        doc: fs()?.get(props.fileName) || "",
        parent: ref(),
        extensions: [
          ...staticExtensions,
          /\.[jt]sx?$/i.test(props.fileName)
            ? autocompletion({
                activateOnTyping: true,
                maxRenderedOptions: 30,
                override: [createCompletionSource(env()!, props.fileName)]
              })
            : autocompletion(),                    
          ...(
            /\.[jt]sx?$/i.test(props.fileName) 
            ? [
                javascript({
                  jsx: props.fileName.endsWith('x'),
                  typescript: /\.tsx?$/i.test(props.fileName)
                }),
                ((lintDiagnostics) => linter(lintDiagnostics))(
                  createLintDiagnostics(env()!, props.fileName)
                ),
                hoverTooltip(createHoverTooltipSource(env()!, props.fileName))
              ]
            : /\.(postcss|sass|scss|css)$/i.test(props.fileName)
            ? [css()]
            : /\.json5?$/i.test(props.fileName) 
            ? [json()]
            : /\.html?$/i.test(props.fileName)
            ? [html()]
            : []
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const data = view.state.doc.toString();
              env()!.updateFile(props.fileName, data);
              props.setFiles?.(props.fileName, data);
            }
          })
        ]
      });      
      onCleanup(() => view.destroy());
    }
  });
  const id = createUniqueId();
  return <Show
    when={fs()?.has(props.fileName)}
    fallback={props.loading || <div class="editor loading">{'Loading...'}</div>}
  >
    <section class="editor" ref={setRef}>
      <Show when={!!props.setFileName}>
        <div role="tablist" aria-label="Files" id={`editor-files-panel-${id}`}>
          <For each={[...(fs()?.keys() || [])].filter(n => !/^\/lib(\.\w+)*\.d\.ts$/.test(n))}>
            {(file) => (
              <div
                role="tab"
                tabIndex={0}
                aria-selected={file === props.fileName || undefined}
                onClick={() => props.setFileName?.(file)}
              >{file}</div>
            )}
          </For>
        </div>
      </Show>
    </section>
  </Show>;
};
