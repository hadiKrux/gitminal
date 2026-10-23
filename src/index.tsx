import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "@/app/App";

const renderer = await createCliRenderer({ exitOnCtrlC: false });

createRoot(renderer).render(<App />);
