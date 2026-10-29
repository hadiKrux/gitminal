import { describe, expect, it } from "bun:test";
import { describeCommandReason } from "@/domain/commands/commands.reasons";

describe("describeCommandReason", () => {
  it("uses the documented top-bar wording", () => {
    expect(describeCommandReason("no-upstream")).toBe("no upstream; use Push to create it first.");
    expect(describeCommandReason("upstream-gone")).toBe("upstream gone; push to recreate it");
    expect(describeCommandReason("no-remote")).toBe("no remote");
    expect(describeCommandReason("detached-head")).toBe("detached HEAD");
    expect(describeCommandReason("no-local-upstreams")).toBe("no local branches with upstreams");
    expect(describeCommandReason("no-current-upstream")).toBe("no upstream for the current branch");
    expect(describeCommandReason("no-commits-yet")).toBe("no commits yet");
    expect(describeCommandReason("operation-in-progress")).toBe("operation in progress");
    expect(describeCommandReason("loading")).toBe("loading repository");
  });

  it("explains how to fix a fetch mapping that could modify local branches", () => {
    expect(describeCommandReason("unsafe-fetch-refspec")).toBe(
      "Fetch refused: configure remote fetch destinations under refs/remotes, not local branches",
    );
  });

  it("keeps the existing wording for the other reasons", () => {
    expect(describeCommandReason("unknown-remote")).toBe("The selected remote is not configured");
    expect(describeCommandReason("command-not-implemented")).toBe(
      "This command is not implemented yet",
    );
  });

  it("uses the documented sidebar panel wording", () => {
    expect(describeCommandReason("checked-out-in-worktree")).toBe(
      "checked out in another worktree",
    );
    expect(describeCommandReason("no-remote-branch")).toBe("no matching remote branch");
    expect(describeCommandReason("nothing-to-stash")).toBe("nothing to stash");
    expect(describeCommandReason("only-untracked-changes")).toBe(
      "only untracked changes; include untracked files to stash",
    );
    expect(describeCommandReason("no-stash-selected")).toBe("no stash selected");
    expect(describeCommandReason("stash-changed-externally")).toBe(
      "stash changed externally; list refreshed",
    );
    expect(describeCommandReason("remote-tag-unknown")).toBe(
      "remote tag state unknown; refresh to retry",
    );
    expect(describeCommandReason("tag-already-on-remote")).toBe("tag exists on a remote");
    expect(describeCommandReason("tag-already-exists")).toBe("tag already exists");
    expect(describeCommandReason("current-worktree")).toBe("current worktree");
    expect(describeCommandReason("worktree-missing")).toBe("worktree no longer exists");
  });
});
