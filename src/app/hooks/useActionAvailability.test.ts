import { beforeEach, describe, expect, it } from "bun:test";
import {
  getActionAvailabilityVersion,
  publishActionAvailability,
  readActionAvailability,
  resetActionAvailability,
  subscribeActionAvailability,
} from "@/app/hooks/useActionAvailability";

beforeEach(() => {
  resetActionAvailability();
});

describe("useActionAvailability", () => {
  it("returns undefined when no surface published a value", () => {
    expect(readActionAvailability("branches", "branch.delete")).toBeUndefined();
  });

  it("stores a value per scope and action id", () => {
    publishActionAvailability("branches", "branch.delete", false);
    publishActionAvailability("tags", "tag.push", true);

    expect(readActionAvailability("branches", "branch.delete")).toBe(false);
    expect(readActionAvailability("tags", "tag.push")).toBe(true);
    expect(readActionAvailability("branches", "tag.push")).toBeUndefined();
  });

  it("removes only the publication its cleanup owns", () => {
    const first = publishActionAvailability("stashes", "stash.pop", false);
    const second = publishActionAvailability("stashes", "stash.pop", true);

    first();
    expect(readActionAvailability("stashes", "stash.pop")).toBe(true);

    second();
    expect(readActionAvailability("stashes", "stash.pop")).toBeUndefined();
  });

  it("notifies subscribers and bumps the version on publish and cleanup", () => {
    const versions: number[] = [];
    const unsubscribe = subscribeActionAvailability(() => {
      versions.push(getActionAvailabilityVersion());
    });
    const versionBefore = getActionAvailabilityVersion();

    const cleanup = publishActionAvailability("worktrees", "worktree.delete", false);

    expect(getActionAvailabilityVersion()).toBe(versionBefore + 1);

    cleanup();

    expect(getActionAvailabilityVersion()).toBe(versionBefore + 2);
    expect(versions).toEqual([versionBefore + 1, versionBefore + 2]);

    unsubscribe();
    publishActionAvailability("worktrees", "worktree.delete", true);

    expect(versions).toHaveLength(2);
  });

  it("clears every publication for test isolation", () => {
    publishActionAvailability("branches", "branch.delete", false);

    resetActionAvailability();

    expect(readActionAvailability("branches", "branch.delete")).toBeUndefined();
  });
});
