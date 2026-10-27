import type { ReactNode } from "react";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { OverlayProvider } from "@/app/providers/OverlayProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import type { KeymapPlatform } from "@/domain/keymap/keymap.types";
import type { SidebarRegionId } from "@/features/shell/focus.types";
import { SidebarPanelFrame } from "@/features/shell/SidebarPanelFrame";

/**
 * Mounts the providers a shell component needs in tests.
 *
 * Feature tests cannot import app provider modules directly because the feature layer only allows
 * provider hooks. This test-only harness imports them centrally and is itself importable from a
 * colocated `*.test.*` file under any feature folder.
 *
 * @param props - Provider content, optional theme name, and the keymap platform.
 * @returns The provider stack.
 */
export function ShellTestProviders(props: {
  children?: ReactNode;
  platform?: KeymapPlatform;
  themeName?: string;
}): ReactNode {
  return (
    <ConfigProvider>
      <ThemeProvider capability="truecolor" themeName={props.themeName}>
        <KeymapProvider platform={props.platform ?? "linux"}>
          <FocusProvider>
            <OverlayProvider>
              <StatusProvider>
                <ConsoleProvider>{props.children}</ConsoleProvider>
              </StatusProvider>
            </OverlayProvider>
          </FocusProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>
  );
}

/**
 * Renders a panel body inside the real shell frame and its scroll container.
 *
 * Feature tests cannot import another feature folder, so this harness is the test-only seam that
 * lets a panel row be exercised against `SidebarPanelFrame`, including its scrollbar and drawable
 * width contract. The harness adds no production behaviour.
 *
 * @param props - Panel identity, bordered width, frame height, inner content width, and body.
 * @returns The framed panel inside the shell providers.
 */
export function SidebarFrameHarness(props: {
  readonly regionId: SidebarRegionId;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly contentWidth: number;
  readonly content: ReactNode;
}): ReactNode {
  return (
    <ShellTestProviders>
      <box flexDirection="column" width={props.width} height={props.height}>
        <SidebarPanelFrame
          panel={{
            regionId: props.regionId,
            label: props.label,
            content: props.content,
          }}
          contentWidth={props.contentWidth}
          flexGrow={1}
        />
      </box>
    </ShellTestProviders>
  );
}
