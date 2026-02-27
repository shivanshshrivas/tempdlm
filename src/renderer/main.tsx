import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyTheme } from "./utils/theme";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

// Apply the persisted theme before first render to avoid a flash of wrong theme.
window.tempdlm.getSettings().then((settings) => {
  applyTheme(settings.theme);
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
