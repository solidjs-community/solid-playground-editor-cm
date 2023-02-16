import solid from "vite-plugin-solid";
import { defineConfig } from "vite";
export default defineConfig({
    plugins: [solid()],
    build: {
        cssCodeSplit: true,
        emptyOutDir: false,
        lib: {
            entry: "src/editor.tsx",
            formats: ["es", "cjs"],
            name: "editor",
            fileName: "editor"
        },
        rollupOptions: {
            external: ["solid-js"],
        },
        sourcemap: true,
        target: "modules",
    }
});
