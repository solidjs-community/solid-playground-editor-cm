/** @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { Editor } from "./editor";

const App = () => {
  const [fileName, setFileName] = createSignal("index.tsx");
  const [files, setFiles] = createStore({
    "index.tsx": "// Start here",
    "index.css": ".selector { display: block; }",
    "test.json": "{ test: 2 }",
    "index.html": "<!doctype html><html><head><title>Test</title></head><body></body></html>"
  } as Record<string, string>);
  return <Editor files={files} setFiles={setFiles} fileName={fileName()} setFileName={setFileName} />;
};

render(App, document.getElementById('root')!);
