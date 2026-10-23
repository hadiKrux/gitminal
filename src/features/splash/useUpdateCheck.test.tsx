import { describe, expect, it } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode, useState } from "react";
import type { CheckForUpdate, UpdateCheckResult } from "@/domain/update/update.types";
import { useUpdateCheck } from "@/features/splash/useUpdateCheck";
import type { UpdateCheckState } from "@/features/splash/useUpdateCheck.types";

/** Latest state rendered by the probe, captured outside React for assertions. */
let latestState: UpdateCheckState | undefined;

/** Visibility setter exposed by the unmount harness. */
let setVisible: ((visible: boolean) => void) | undefined;

/** Rerender trigger exposed by the inline-checker harness. */
let rerender: (() => void) | undefined;

/** Number of inline checker calls observed by the inline-checker harness. */
let inlineRequestCount = 0;

/** Package-name setter exposed by the identity harness. */
let setPackageName: ((packageName: string) => void) | undefined;

/** A check that never settles. */
const pendingCheck = new Promise<UpdateCheckResult>(() => {});

/**
 * Reads the latest state captured by the probe.
 *
 * @returns The last rendered update state, or `undefined` before the first render.
 */
function readLatestState(): UpdateCheckState | undefined {
  return latestState;
}

/**
 * Renders the hook state so a test can inspect it.
 *
 * @param props - The injected update checker.
 * @returns The current update status as text.
 */
function UpdateProbe(props: { checker: CheckForUpdate }): ReactNode {
  const state = useUpdateCheck("@im4all/gitminal", "0.1.0", props.checker);
  latestState = state;

  return <text>{state.status}</text>;
}

/**
 * Renders the hook state for an arbitrary package identity so a test can change it.
 *
 * @param props - The package name, version, and injected checker.
 * @returns The current update status as text.
 */
function IdentityProbe(props: {
  packageName: string;
  currentVersion: string;
  checker: CheckForUpdate;
}): ReactNode {
  const state = useUpdateCheck(props.packageName, props.currentVersion, props.checker);
  latestState = state;

  return <text>{state.status}</text>;
}

/**
 * Lets a test change the package name after the first check settles.
 *
 * @param props - The injected update checker.
 * @returns The probe with a mutable package identity.
 */
function IdentityHarness(props: { checker: CheckForUpdate }): ReactNode {
  const [packageName, setPackageNameState] = useState("first-package");
  setPackageName = setPackageNameState;

  return <IdentityProbe packageName={packageName} currentVersion="0.1.0" checker={props.checker} />;
}

/**
 * Mounts the probe behind a visibility flag so a test can unmount it.
 *
 * @param props - The injected update checker.
 * @returns The probe while visible, otherwise a dismissed marker.
 */
function VisibilityHarness(props: { checker: CheckForUpdate }): ReactNode {
  const [visible, setVisibleState] = useState(true);
  setVisible = setVisibleState;

  return visible ? <UpdateProbe checker={props.checker} /> : <text>dismissed</text>;
}

/**
 * Passes a fresh inline checker on every render to prove the hook runs once per mount.
 *
 * @returns The probe with a new checker identity each render.
 */
function InlineCheckerHarness(): ReactNode {
  const [, setTick] = useState(0);
  rerender = () => setTick((tick) => tick + 1);

  const checker: CheckForUpdate = () => {
    inlineRequestCount += 1;
    return pendingCheck;
  };

  return <UpdateProbe checker={checker} />;
}

describe("useUpdateCheck", () => {
  it("treats a rejected checker as unavailable while active", async () => {
    latestState = undefined;
    const checker: CheckForUpdate = () =>
      new Promise<UpdateCheckResult>((_resolve, reject) => {
        setTimeout(() => reject(new Error("offline")), 0);
      });
    const setup = await testRender(<UpdateProbe checker={checker} />, {
      width: 40,
      height: 10,
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await setup.renderOnce();
    });

    expect(readLatestState()).toEqual({ status: "unavailable" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("discards a late result after unmount", async () => {
    latestState = undefined;
    let resolveCheck: ((result: UpdateCheckResult) => void) | undefined;
    const checker: CheckForUpdate = () =>
      new Promise<UpdateCheckResult>((resolve) => {
        resolveCheck = resolve;
      });
    const setup = await testRender(<VisibilityHarness checker={checker} />, {
      width: 40,
      height: 10,
    });

    await act(async () => {
      await setup.renderOnce();
    });
    expect(readLatestState()).toEqual({ status: "checking" });

    await act(async () => {
      setVisible?.(false);
    });
    await act(async () => {
      await setup.renderOnce();
    });
    expect(setup.captureCharFrame()).toContain("dismissed");

    await act(async () => {
      resolveCheck?.({
        status: "available",
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
      });
      await setup.renderOnce();
    });

    expect(readLatestState()).toEqual({ status: "checking" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("resets to checking when the package identity changes", async () => {
    latestState = undefined;
    const resolvers: ((result: UpdateCheckResult) => void)[] = [];
    const checker: CheckForUpdate = () =>
      new Promise<UpdateCheckResult>((resolve) => {
        resolvers.push(resolve);
      });
    const setup = await testRender(<IdentityHarness checker={checker} />, {
      width: 40,
      height: 10,
    });

    await act(async () => {
      await setup.renderOnce();
    });
    expect(readLatestState()).toEqual({ status: "checking" });

    await act(async () => {
      resolvers[0]?.({
        status: "available",
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
      });
      await setup.renderOnce();
    });
    expect(readLatestState()).toEqual({
      status: "available",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
    });

    await act(async () => {
      setPackageName?.("second-package");
      await setup.renderOnce();
    });
    expect(readLatestState()).toEqual({ status: "checking" });
    expect(resolvers).toHaveLength(2);

    await act(async () => {
      resolvers[1]?.({ status: "up-to-date" });
      await setup.renderOnce();
    });
    expect(readLatestState()).toEqual({ status: "up-to-date" });

    await act(async () => {
      await setup.dispose();
    });
  });

  it("runs once per mount even when the parent passes a new inline checker", async () => {
    inlineRequestCount = 0;
    const setup = await testRender(<InlineCheckerHarness />, {
      width: 40,
      height: 10,
    });

    await act(async () => {
      await setup.renderOnce();
    });
    expect(inlineRequestCount).toBe(1);

    await act(async () => {
      rerender?.();
    });
    await act(async () => {
      await setup.renderOnce();
    });

    expect(inlineRequestCount).toBe(1);

    await act(async () => {
      await setup.dispose();
    });
  });
});
