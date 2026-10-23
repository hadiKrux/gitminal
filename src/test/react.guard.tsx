import { spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Component, type ReactNode } from "react";

/** State of the guard boundary. */
interface GuardBoundaryState {
  failed: boolean;
}

/** Error message captured when a guard hook runs outside its provider. */
let guardError: string | undefined;

/**
 * Reads the guard error captured by the boundary.
 *
 * @returns The captured error message, or `undefined` before a probe render fails.
 */
export function readGuardError(): string | undefined {
  return guardError;
}

/**
 * Catches a guard error thrown during a probe render and records its message.
 *
 * This is a test-only harness that turns a thrown context guard into an assertion value instead of
 * letting React surface an unhandled render error.
 */
class GuardBoundary extends Component<{ children: ReactNode }, GuardBoundaryState> {
  override state: GuardBoundaryState = { failed: false };

  /**
   * Switches the boundary to its fallback after a render error.
   *
   * @returns The next boundary state.
   */
  static getDerivedStateFromError(): GuardBoundaryState {
    return { failed: true };
  }

  /**
   * Records the caught guard message for assertions.
   *
   * @param error - Error thrown by the probe render.
   */
  override componentDidCatch(error: unknown): void {
    guardError = error instanceof Error ? error.message : String(error);
  }

  /**
   * Renders the probe until it throws, then a fallback marker.
   *
   * @returns The probe children or the fallback marker.
   */
  override render(): ReactNode {
    return this.state.failed ? <text>guard error</text> : this.props.children;
  }
}

/**
 * Renders a guard probe inside the boundary with React's caught-error log muted.
 *
 * @param probe - Probe element that calls a guard hook outside its provider.
 * @returns The rendered setup.
 */
export async function renderGuard(
  probe: ReactNode,
): Promise<Awaited<ReturnType<typeof testRender>>> {
  guardError = undefined;
  const consoleError = spyOn(console, "error").mockImplementation(() => {});

  try {
    return await testRender(<GuardBoundary>{probe}</GuardBoundary>, { width: 40, height: 10 });
  } finally {
    consoleError.mockRestore();
  }
}
