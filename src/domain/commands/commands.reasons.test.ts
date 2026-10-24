import { describe, expect, it } from "bun:test";
import { describeCommandReason } from "@/domain/commands/commands.reasons";

describe("describeCommandReason", () => {
  it("uses the documented top-bar wording", () => {
    expect(describeCommandReason("no-upstream")).toBe("no upstream; use Push to create it first.");
    expect(describeCommandReason("upstream-gone")).toBe("upstream gone; push to recreate it");
    expect(describeCommandReason("no-remote")).toBe("no remote");
    expect(describeCommandReason("detached-head")).toBe("detached HEAD");
    expect(describeCommandReason("no-local-upstreams")).toBe("no local branches with upstreams");
    expect(describeCommandReason("no-commits-yet")).toBe("no commits yet");
    expect(describeCommandReason("operation-in-progress")).toBe("operation in progress");
    expect(describeCommandReason("loading")).toBe("loading repository");
  });

  it("keeps the existing wording for the other reasons", () => {
    expect(describeCommandReason("unknown-remote")).toBe("The selected remote is not configured");
    expect(describeCommandReason("command-not-implemented")).toBe(
      "This command is not implemented yet",
    );
  });
});
