import type { ReactNode } from "react";
import { ConfigProvider } from "@/app/providers/ConfigProvider";
import { ConsoleProvider } from "@/app/providers/ConsoleProvider";
import { DraftProvider } from "@/app/providers/DraftProvider";
import { FocusProvider } from "@/app/providers/FocusProvider";
import { KeymapProvider } from "@/app/providers/KeymapProvider";
import { OverlayProvider } from "@/app/providers/OverlayProvider";
import { RepositoryProvider } from "@/app/providers/RepositoryProvider";
import { StatusProvider } from "@/app/providers/StatusProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import type { GitminalConfig } from "@/domain/config/config.types";
import type { GitClient } from "@/domain/git/git.types";
import type { KeymapPlatform } from "@/domain/keymap/keymap.types";

/**
 * Mounts the full provider stack a feature needs when it reads repository and command state.
 *
 * Feature tests cannot import app provider components directly, so this test-only harness owns the
 * nesting. It mirrors the production order and never starts a watcher; the caller injects an inert
 * or fake git client so no test spawns a process.
 *
 * @param props - Provider content, git client, working directory, keymap platform, clock, and config.
 * @returns The provider stack.
 */
export function AppTestProviders(props: {
  readonly children?: ReactNode;
  readonly gitClient?: GitClient;
  readonly cwd?: string;
  readonly platform?: KeymapPlatform;
  readonly now?: () => number;
  readonly initialFollowMode?: boolean;
  readonly config?: GitminalConfig;
}): ReactNode {
  return (
    <ConfigProvider initialConfig={props.config}>
      <ThemeProvider>
        <KeymapProvider platform={props.platform ?? "linux"}>
          <RepositoryProvider
            cwd={props.cwd ?? "/repo"}
            gitClient={props.gitClient}
            enableWatcher={false}
            now={props.now ?? (() => 0)}
          >
            <DraftProvider>
              <FocusProvider>
                <OverlayProvider>
                  <StatusProvider>
                    <ConsoleProvider initialFollowMode={props.initialFollowMode}>
                      {props.children}
                    </ConsoleProvider>
                  </StatusProvider>
                </OverlayProvider>
              </FocusProvider>
            </DraftProvider>
          </RepositoryProvider>
        </KeymapProvider>
      </ThemeProvider>
    </ConfigProvider>
  );
}
