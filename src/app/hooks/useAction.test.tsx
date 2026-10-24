import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import {
  getActionRegistryVersion,
  hasRegisteredAction,
  registerAction,
  resetActionRegistry,
  resolveActionHandler,
  subscribeActionRegistry,
  useAction,
} from "@/app/hooks/useAction";
import type { ActionRegistrationOptions } from "@/app/hooks/useAction.types";

/**
 * Registers one action handler for the lifetime of the probe.
 *
 * @param props - Action id, registration options, and handler.
 * @returns A marker element.
 */
function RegistrationProbe(props: {
  actionId: string;
  options: ActionRegistrationOptions;
  handler: () => void;
}): ReactNode {
  useAction(props.actionId, props.options, props.handler);

  return <text>probe</text>;
}

/**
 * Renders the supplied probe.
 *
 * @param probe - Probe element.
 * @returns The renderer setup.
 */
async function renderProbe(probe: ReactNode): Promise<Awaited<ReturnType<typeof testRender>>> {
  return testRender(<box>{probe}</box>, { width: 40, height: 10 });
}

/**
 * Restores the module registry and silences expected development errors.
 *
 * @returns The console error spy.
 */
function prepareRegistry(): ReturnType<typeof spyOn> {
  resetActionRegistry();

  return spyOn(console, "error").mockImplementation(() => {});
}

beforeEach(() => {
  resetActionRegistry();
});

describe("useAction", () => {
  it("registers one handler and resolves it by scope", async () => {
    const consoleError = prepareRegistry();
    const handler = () => {};
    const setup = await renderProbe(
      <RegistrationProbe
        actionId="branch.create"
        options={{ scope: "branches" }}
        handler={handler}
      />,
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(hasRegisteredAction("branch.create", "branches")).toBe(true);
    expect(resolveActionHandler("branch.create", "branches")).toBeFunction();
    expect(resolveActionHandler("branch.create", "global")).toBeUndefined();
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects a duplicate registration instead of replacing the first handler", async () => {
    const consoleError = prepareRegistry();
    const first = () => {};
    const second = () => {};
    const setup = await renderProbe(
      <box>
        <RegistrationProbe
          actionId="branch.delete"
          options={{ scope: "branches" }}
          handler={first}
        />
        <RegistrationProbe
          actionId="branch.delete"
          options={{ scope: "branches" }}
          handler={second}
        />
      </box>,
    );

    await act(async () => {
      await setup.renderOnce();
    });

    const resolved = resolveActionHandler("branch.delete", "branches");

    expect(resolved).toBeFunction();
    expect(resolved).not.toBe(second);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("Duplicate action handler");

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("keeps the focused scope and global registrations separate", async () => {
    const consoleError = prepareRegistry();
    const globalHandler = () => {};
    const regionHandler = () => {};
    const setup = await renderProbe(
      <box>
        <RegistrationProbe
          actionId="app.quit"
          options={{ scope: "global", owner: "app" }}
          handler={globalHandler}
        />
        <RegistrationProbe
          actionId="app.quit"
          options={{ scope: "branches" }}
          handler={regionHandler}
        />
      </box>,
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(resolveActionHandler("app.quit", "global")).not.toBe(
      resolveActionHandler("app.quit", "branches"),
    );
    expect(resolveActionHandler("app.quit", "global")).toBeFunction();
    expect(resolveActionHandler("app.quit", "branches")).toBeFunction();

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects global registrations without a designated owner", async () => {
    const consoleError = prepareRegistry();
    const setup = await renderProbe(
      <RegistrationProbe actionId="app.quit" options={{ scope: "global" }} handler={() => {}} />,
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(hasRegisteredAction("app.quit", "global")).toBe(false);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("must declare a designated owner");

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("rejects a global action outside the owner namespace", async () => {
    const consoleError = prepareRegistry();
    const setup = await renderProbe(
      <RegistrationProbe
        actionId="remote.pull"
        options={{ scope: "global", owner: "app" }}
        handler={() => {}}
      />,
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(hasRegisteredAction("remote.pull", "global")).toBe(false);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("cannot register global action");

    consoleError.mockRestore();
    await act(async () => {
      await setup.dispose();
    });
  });

  it("removes the registration on unmount", async () => {
    const consoleError = prepareRegistry();
    const setup = await renderProbe(
      <RegistrationProbe actionId="tag.create" options={{ scope: "tags" }} handler={() => {}} />,
    );

    await act(async () => {
      await setup.renderOnce();
    });

    expect(hasRegisteredAction("tag.create", "tags")).toBe(true);

    await act(async () => {
      await setup.dispose();
    });

    expect(hasRegisteredAction("tag.create", "tags")).toBe(false);

    consoleError.mockRestore();
  });
});

describe("registerAction", () => {
  it("returns a cleanup that only removes its own handler", () => {
    resetActionRegistry();

    const first = registerAction("diff.stage", { scope: "diff" }, () => {});

    first();

    const second = registerAction("diff.stage", { scope: "diff" }, () => {});

    first();
    expect(hasRegisteredAction("diff.stage", "diff")).toBe(true);

    second();
    expect(hasRegisteredAction("diff.stage", "diff")).toBe(false);
  });

  it("reports registry changes to subscribers", () => {
    resetActionRegistry();

    const versions: number[] = [];
    const unsubscribe = subscribeActionRegistry(() => versions.push(getActionRegistryVersion()));
    const cleanup = registerAction("tag.push", { scope: "tags" }, () => {});

    cleanup();
    unsubscribe();

    expect(versions).toHaveLength(2);
    expect(versions[1]).toBeGreaterThan(versions[0] ?? 0);
  });
});
