import { useRenderer } from "@opentui/react";
import { useEffect } from "react";
import { useConfig } from "@/app/hooks/useConfig";

/**
 * Applies the configured mouse setting to the terminal renderer.
 *
 * `ui.mouse` is a renderer concern, not a component prop: OpenTUI enables mouse reporting on the
 * renderer, so a configuration change has to be pushed to it. The bootstrap passes the startup value
 * to `createCliRenderer`, and this effect keeps the renderer in step afterwards, which is what makes
 * `app.reloadConfig` take effect without a restart. The effect assigns only on a value change
 * because the renderer already ignores a redundant assignment.
 */
export function useMouseSetting(): void {
  const { config } = useConfig();
  const renderer = useRenderer();
  const enabled = config.ui.mouse;

  useEffect(() => {
    renderer.useMouse = enabled;
  }, [enabled, renderer]);
}
