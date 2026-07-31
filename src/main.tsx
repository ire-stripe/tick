import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyTheme, loadSettings } from "@/lib/userSettings";

applyTheme(loadSettings().theme);

createRoot(document.getElementById("root")!).render(<App />);