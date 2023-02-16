<p>
  <img width="100%" src="https://assets.solidjs.com/banner?type=Component&background=tiles&project=playground-editor-cm" alt="Solid.js playground editor (codemirror)">
</p>

## Usage

### Installation

```bash
npm add solid-playground-editor-cm
```

### Component

```jsx
// create fileName signal
const [fileName, setFileName] = createSignal("index.tsx");
// create fileSystem store
const [files, setFiles] = createStore({
  "index.tsx": "// Start here",
  "index.css": ".selector { display: block; }",
  "test.json": "{ test: 2 }",
  "index.html": "<!doctype html><html><head><title>Test</title></head><body></body></html>"
} as Record<string, string>);

return (
  <Editor
    files={files}
    setFiles={setFiles}
    fileName={fileName()}
    setFileName={setFileName}
    tsOptions={{ strict: false }}
  />
);
```

## Installation and development

```bash
# install
npm i --legacy-peer-deps
# build
npm run build
# dev
npm run dev
```
