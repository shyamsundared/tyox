export const reactStarterFiles: Record<string, string> = {
    "package.json": JSON.stringify({
        name: "tyox-react-project",
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: {
            dev: "vite",
            test: "vitest run",
            build: "tsc --noEmit && vite build",
            preview: "vite preview",
        },
        dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
        },
        devDependencies: {
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            "@tailwindcss/vite": "^4.1.11",
            "@vitejs/plugin-react": "^4.3.4",
            "@testing-library/dom": "^10.4.1",
            "@testing-library/jest-dom": "^6.6.4",
            "@testing-library/react": "^16.3.0",
            "@testing-library/user-event": "^14.6.1",
            jsdom: "^26.1.0",
            tailwindcss: "^4.1.11",
            typescript: "^5.7.2",
            vite: "^6.0.0",
            vitest: "^4.0.0",
        },
    }, null, 2) + "\n",
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f4f1ea" />
    <title>React project</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
`,
    "vitest.config.ts": `import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
  },
}));
`,
    "src/test/setup.ts": `import "@testing-library/jest-dom/vitest";
`,
    "tsconfig.json": JSON.stringify({
        compilerOptions: {
            target: "ES2020",
            useDefineForClassFields: true,
            lib: ["ES2020", "DOM", "DOM.Iterable"],
            module: "ESNext",
            skipLibCheck: true,
            moduleResolution: "Bundler",
            allowImportingTsExtensions: true,
            verbatimModuleSyntax: true,
            moduleDetection: "force",
            noEmit: true,
            jsx: "react-jsx",
            strict: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            noFallthroughCasesInSwitch: true,
        },
        include: ["src"],
    }, null, 2) + "\n",
    "src/main.tsx": `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    "src/App.tsx": `export default function App() {
  return (
    <main className="welcome">
      <p className="eyebrow">Your workspace is ready</p>
      <h1>Let’s make something.</h1>
      <p>Ask Tyox to build a React page, or start by editing <code>src/App.tsx</code>.</p>
    </main>
  );
}
`,
    "src/App.test.tsx": `import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the starter page", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Let’s make something." })).toBeInTheDocument();
  });
});
`,
    "src/index.css": `:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #20231f;
  background: #f4f1ea;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

* { box-sizing: border-box; }

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
}

.welcome {
  display: grid;
  align-content: center;
  min-height: 100vh;
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 28px;
}

.eyebrow {
  margin: 0 0 16px;
  color: #68705f;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: clamp(2.5rem, 8vw, 5rem);
  letter-spacing: -0.06em;
  line-height: 0.98;
}

.welcome > p:last-child {
  max-width: 38rem;
  margin-top: 24px;
  color: #65675f;
  font-size: 1.05rem;
  line-height: 1.6;
}

code {
  border-radius: 4px;
  background: #e8e4da;
  padding: 2px 5px;
  color: #34382f;
}
`,
};
