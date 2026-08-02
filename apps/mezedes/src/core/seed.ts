/**
 * The tree a mezes starts from when `create` is called with no files. It is tiny
 * on purpose: a scaffold is read back by the next `inspect`, so every line in it
 * is context the model pays for.
 */

/**
 * The compiler options the language service is constructed with, and the ones
 * the fallback declarations of `react-lib.ts` are written against.
 *
 * No `include` and no `exclude`. TypeScript's default file set is what puts the
 * injected `__mezedes_lib__` declarations in the program when an install fails,
 * and what guarantees every path `diagnose` asks for diagnostics on is a program
 * root rather than a file the service has never heard of.
 *
 * `moduleDetection: "force"` keeps `isolatedModules` from rejecting a file with
 * no import or export, and does not apply to declaration files — the injected
 * `declare module "react"` stays ambient.
 *
 * Strict, but not pedantic: the check gates a one-shot submission, so it must
 * reject code that is broken without rejecting code that is merely terse.
 */
export const SEED_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "types": [],
    "allowJs": true,
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  }
}
`;

/**
 * Both halves matter. `react` and `react-dom` are runtime dependencies because
 * they are bundled into the client; the `@types` are devDependencies because
 * `installDependencies` is called with `{ dev: true }` and sees them, while
 * `createApp` installs with the default and never bundles a declaration.
 */
const SEED_PACKAGE_JSON = `{
  "name": "mezes",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.4"
  }
}
`;

/** The bundle is emitted next to the page, so the script src is relative. A
 *  root-absolute `/client.js` resolves against the wrong origin and the page
 *  silently never mounts. */
const SEED_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>mezes</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./client.js"></script>
  </body>
</html>
`;

const SEED_CLIENT = `import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const mount = document.getElementById("root");
if (mount === null) throw new Error("public/index.html has no #root to mount into");

createRoot(mount).render(<App />);
`;

const SEED_APP = `export const App = () => (
  <main>
    <h1>a new mezes</h1>
    <p>Edit src/App.tsx and publish a new version.</p>
  </main>
);
`;

export const SEED_FILES: Readonly<Record<string, string>> = {
  "package.json": SEED_PACKAGE_JSON,
  "tsconfig.json": SEED_TSCONFIG,
  "public/index.html": SEED_INDEX_HTML,
  "src/client.tsx": SEED_CLIENT,
  "src/App.tsx": SEED_APP,
};
