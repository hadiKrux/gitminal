import { describe, expect, it } from "bun:test";
import { getCommandDescriptor, listCommandDescriptors } from "@/domain/commands/commands.registry";

describe("command registry", () => {
  it("indexes every listed descriptor exactly once", () => {
    const descriptors = listCommandDescriptors();
    const ids = descriptors.map((descriptor) => descriptor.id);

    expect(descriptors.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);

    for (const descriptor of descriptors) {
      expect(getCommandDescriptor(descriptor.id)).toBe(descriptor);
      expect(Object.isFrozen(descriptor)).toBeTrue();
      expect(Object.isFrozen(descriptor.keywords)).toBeTrue();
    }
  });

  it("returns undefined for an unknown command", () => {
    expect(getCommandDescriptor("nope.nothing")).toBeUndefined();
  });

  it("requires a branch target for pull and every push variant", () => {
    for (const commandId of [
      "remote.pull",
      "remote.push",
      "remote.pushForceSafe",
      "remote.pushForceOverwrite",
      "remote.pushNoVerify",
    ]) {
      expect(getCommandDescriptor(commandId)?.targetKind).toBe("branch");
    }
  });

  it("keeps fetch, fetch-prune, and the More menu scope-wide", () => {
    for (const commandId of ["remote.fetch", "remote.fetchPrune", "remote.more"]) {
      expect(getCommandDescriptor(commandId)?.targetKind).toBe("none");
    }
  });

  it("keeps remote.more a navigation command", () => {
    expect(getCommandDescriptor("remote.more")?.kind).toBe("navigation");
  });

  it("declares the global handler scope for every remote command", () => {
    for (const commandId of [
      "remote.fetch",
      "remote.fetchPrune",
      "remote.pull",
      "remote.push",
      "remote.pushForceSafe",
      "remote.pushForceOverwrite",
      "remote.pushNoVerify",
      "remote.more",
    ]) {
      expect(getCommandDescriptor(commandId)?.scope, commandId).toBe("global");
    }
  });
});
