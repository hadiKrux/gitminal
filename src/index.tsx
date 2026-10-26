import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "@/app/App";
import { createConfigSource } from "@/app/providers/config.source";

// Configuration loads once, before the first render, so the shell never shows a loading state. The
// same source is handed to `ConfigProvider`, which uses it when `app.reloadConfig` runs.
const configSource = createConfigSource();
const configSnapshot = await configSource.load();
const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useMouse: configSnapshot.config.ui.mouse,
});

createRoot(renderer).render(<App configSource={configSource} configSnapshot={configSnapshot} />);
