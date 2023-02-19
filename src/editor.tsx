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
  type Tooltip,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  completeFromList,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { lintKeymap, linter, Diagnostic } from "@codemirror/lint";
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
  type Setter,
} from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import ts, {
  displayPartsToString,
  flattenDiagnosticMessageText,
} from "typescript";
import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualTypeScriptEnvironment,
  type VirtualTypeScriptEnvironment,
} from "@typescript/vfs";
import "./editor.css";

export const createEnv = (
  files?: Record<string, string>,
  tsOptions: ts.CompilerOptions = {}
): [
  fs: Accessor<Map<string, string> | undefined>,
  env: Accessor<VirtualTypeScriptEnvironment | undefined>
] => {
  const [fs, setFs] = createSignal<Map<string, string>>();
  const [env, setEnv] = createSignal<VirtualTypeScriptEnvironment>();
  onMount(async () => {
    try {
      const fsMap = await createDefaultMapFromCDN(
        {
          target: ts.ScriptTarget.ES2021,
          downlevelIteration: true,
          strict: true,
          ...tsOptions,
        },
        ts.version,
        true,
        ts
      );
      Object.entries(files || {}).forEach(([name, content]) =>
        fsMap.set(name, content)
      );

      const system = createSystem(fsMap);

      const compilerOpts = {};
      const tsEnv = createVirtualTypeScriptEnvironment(
        system,
        [...fsMap.keys()].filter((name) => /\.[jt]sx?$/i.test(name)),
        ts,
        compilerOpts
      );

      setFs(fsMap);
      setEnv(tsEnv);
    } catch (_err) {}
  });
  return [fs, env];
};

export const createCompletionSource =
  (env: VirtualTypeScriptEnvironment, fileName: string) =>
  (ctx: CompletionContext): Promise<CompletionResult | null> => {
    try {
      const completions = env.languageService.getCompletionsAtPosition(
        fileName,
        ctx.pos,
        {}
      );
      if (!completions) {
        return Promise.resolve(null);
      }
      return Promise.resolve(
        completeFromList(
          completions.entries.map((c) => ({
            type: c.kind,
            label: c.name,
            boost: 1 / Number(c.sortText),
          }))
        )(ctx)
      );
    } catch (_error) {
      return Promise.resolve(null);
    }
  };

const severity = ["warning", "error", "info", "info"] as const;

export const createLintDiagnostics =
  (env: VirtualTypeScriptEnvironment, fileName: string) => () => {
    try {
      return env.languageService
        .getSemanticDiagnostics(fileName)
        .reduce((result, item) => {
          if (item.start !== undefined && item.length !== undefined) {
            result.push({
              from: item.start,
              to: item.start + item.length,
              severity: severity[item.category],
              message: flattenDiagnosticMessageText(item.messageText, "\n", 0),
            });
          }
          return result;
        }, [] as Diagnostic[]);
    } catch (_error) {
      return [];
    }
  };

export const createHoverTooltipSource =
  (env: VirtualTypeScriptEnvironment, fileName: string) =>
  async (_view: EditorView, pos: number): Promise<Tooltip | null> => {
    try {
      const quickInfo = await env.languageService.getQuickInfoAtPosition(
        fileName,
        pos
      );
      return quickInfo
        ? {
            pos,
            create() {
              const dom = Object.assign(document.createElement("div"), {
                className: "cm-quickinfo-tooltip",
                textContent: displayPartsToString(quickInfo.displayParts),
              });
              console.log(
                javascript().language.parser.parse(
                  displayPartsToString(quickInfo.displayParts)
                )
              );
              if (quickInfo.documentation) {
                dom.appendChild(
                  Object.assign(document.createElement("div"), {
                    textContent: displayPartsToString(quickInfo.documentation),
                  })
                );
              }
              return {
                dom,
              };
            },
            above: false,
          }
        : null;
    } catch (_error) {
      return null;
    }
  };

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
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
    ...lintKeymap,
  ]),
];

export type EditorProps = {
  /** current fileName (must be a file available in files) */
  fileName: string;
  /** setter for current fileName - if not present, tabs will not be rendered */
  setFileName?: Setter<string>;
  /** allow adding a new file, default is true */
  allowNewFile?: boolean;
  /** allow renaming existing files, default is true, if string, will overwrite the default title attribute of file tabs; only works with setFilename */
  allowRenameFile?: boolean | string;
  /** files that should be visible (either array, RegExp or (name: string) => boolean) */
  fileIsVisible?: string[] | RegExp | ((name: string) => boolean);
  /** file system store */
  files?: Record<string, string>;
  /** setter for file system store */
  setFiles?: SetStoreFunction<Record<string, string>>;
  /** overwrite for the loading fallback */
  loading?: JSX.Element;
  /** override ts compiler options */
  tsOptions?: ts.CompilerOptions;
};

/** Editor for the solid.js playground based on code mirror 6 and typescript's virtual environment */
export const Editor = (props: EditorProps) => {
  const [ref, setRef] = createSignal<HTMLDivElement>();
  const [tabListRef, setTabListRef] = createSignal<HTMLDivElement>();
  const [fs, env] = createEnv(props.files, props.tsOptions);
  const [editFileName, setEditFileName] = createSignal<string>();
  createEffect((notFirst) => {
    props.files;
    if (notFirst && props.files && fs()) {
      Object.entries(props.files).forEach(([fileName, fileData]) => {
        fs()?.has(fileName) || fs()?.set(fileName, fileData);
      });
    }
    return true;
  });
  const fileIsVisible: (name: string) => boolean = Array.isArray(
    props.fileIsVisible
  )
    ? (name: string) => (props.fileIsVisible as string[]).includes(name)
    : props.fileIsVisible instanceof RegExp
    ? (name: string) => (props.fileIsVisible as RegExp).test(name)
    : typeof props.fileIsVisible === "function"
    ? (name: string) => (props.fileIsVisible as (name: string) => boolean)(name)
    : (name: string) => !/(^node_modules\/|^\/lib(\.\w+)*\.d\.ts$)/.test(name);
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
                override: [createCompletionSource(env()!, props.fileName)],
              })
            : autocompletion(),
          ...(/\.[jt]sx?$/i.test(props.fileName)
            ? [
                javascript({
                  jsx: props.fileName.endsWith("x"),
                  typescript: /\.tsx?$/i.test(props.fileName),
                }),
                ((lintDiagnostics) => linter(lintDiagnostics))(
                  createLintDiagnostics(env()!, props.fileName)
                ),
                hoverTooltip(createHoverTooltipSource(env()!, props.fileName)),
              ]
            : /\.(postcss|sass|scss|css)$/i.test(props.fileName)
            ? [css()]
            : /\.json5?$/i.test(props.fileName)
            ? [json()]
            : /\.html?$/i.test(props.fileName)
            ? [html()]
            : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const data = view.state.doc.toString();
              env()!.updateFile(props.fileName, data);
              props.setFiles?.(props.fileName, data);
            }
          }),
        ],
      });
      onCleanup(() => view.destroy());
    }
  });
  const id = createUniqueId();
  const visibleFiles = () => [...(fs()?.keys() || [])].filter(fileIsVisible);
  return (
    <Show
      when={fs()?.has(props.fileName)}
      fallback={
        props.loading || <div class="editor loading">{"Loading..."}</div>
      }
    >
      <section
        class="editor"
        ref={setRef}
        onClick={(ev) => {
          if (
            editFileName() !== undefined &&
            tabListRef() &&
            !tabListRef()?.contains(ev.target)
          ) {
            setEditFileName(undefined);
          }
        }}
      >
        <Show when={!!props.setFileName}>
          <div
            role="tablist"
            ref={setTabListRef}
            aria-label="Files"
            id={`editor-files-panel-${id}`}
          >
            <For each={(editFileName(), visibleFiles())}>
              {(file) => (
                <div
                  role="tab"
                  tabIndex={0}
                  aria-selected={file === props.fileName || undefined}
                  title={
                    typeof props.allowRenameFile === "string"
                      ? props.allowRenameFile
                      : (props.allowRenameFile !== false &&
                          "Click right to rename; press enter or click outside to finish") ||
                        undefined
                  }
                  onClick={() => {
                    if (file !== editFileName()) {
                      setEditFileName(undefined);
                    }
                    props.setFileName?.(file);
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    props.setFileName?.(file);
                    setEditFileName(file);
                  }}
                >
                  <Show
                    when={
                      props.allowRenameFile !== false &&
                      file === editFileName() &&
                      props.setFileName
                    }
                    fallback={file}
                  >
                    <input
                      ref={(node) =>
                        setTimeout(() => {
                          node.focus();
                          const pos = file.lastIndexOf(".");
                          node.setSelectionRange(pos, pos);
                        }, 50)
                      }
                      onInput={(ev) => {
                        const newFilename = ev.currentTarget.value;
                        const fsMap = fs();
                        if (
                          props.setFileName &&
                          fsMap &&
                          props.fileName !== newFilename
                        ) {
                          const fileData = fsMap.get(props.fileName) ?? "";
                          props.setFiles?.(newFilename, fileData);
                          // removing a property requires some typecasting here:
                          props.setFiles?.(
                            props.fileName,
                            undefined as any as string
                          );
                          fsMap.set(newFilename, fileData);
                          fsMap.delete(props.fileName);
                          props.setFileName(newFilename);
                        }
                      }}
                      onKeyDown={(ev) =>
                        ev.key === "Enter" && setEditFileName(undefined)
                      }
                      value={/*@once*/ editFileName()}
                    />
                  </Show>
                </div>
              )}
            </For>
            <Show when={props.allowNewFile !== false}>
              <div
                role="button"
                onClick={() => {
                  const newName = `tab${visibleFiles().length}`;
                  fs()?.set(newName, "");
                  props.setFiles?.(newName, "");
                  props.setFileName?.(newName);
                  setTimeout(() => setEditFileName(newName), 50);
                }}
              >
                +
              </div>
            </Show>
          </div>
        </Show>
      </section>
    </Show>
  );
};
