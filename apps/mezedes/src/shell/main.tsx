import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyStoredTheme } from "./components/theme.ts";
import "./theme.css";

// Before the first render: index.html paints the token set, and a stored theme
// has to be on the root element by then or the wrong one shows for a frame.
applyStoredTheme();

const host = document.getElementById("root");
if (host === null) throw new Error("index.html is missing #root");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
