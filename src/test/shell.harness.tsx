import type { ReactNode } from "react";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { OverlayProvider } from "@/app/providers/OverlayProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import type { KeymapPlatform } from "@/domain/keymap/keymap.types";

/**
 * Mounts the providers a shell component needs in tests.
 *
 * Feature tests cannot import app provider modules directly because the feature layer only allows
 * provider hooks. This test-only harness imports them centrally and is itself importable from a
 * colocated `*.test.*` file under any feature folder.
 *
 * @param props - Provider content and the keymap platform.
 * @returns The provider stack.
 */
export function ShellTestProviders(props: {
  children?: ReactNode;
  platform?: KeymapPlatform;
}): ReactNode {
  return (
    <ConfigProvider>
      <ThemeProvider>
        <KeymapProvider platform={props.platform ?? "linux"}>
          <FocusProvider>
            <OverlayProvider>
              <StatusProvider>{props.children}</StatusProvider>
            </OverlayProvider>
          </FocusProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>
  );
}
