import { describe, expect, it } from "bun:test";
import { isGitAvailable, MINIMUM_GIT_VERSION, readGitVersion } from "@/test/git.fixture";

/**
 * Builds the gate failure message.
 *
 * The gate must say what is actually installed, so a failure on a machine with an old or missing
 * git names the detected version instead of only the boolean it produced. Process spawning stays in
 * the fixture, because the boundary check allows it only there.
 *
 * @returns The message naming the floor and the detected state.
 */
function readGateMessage(): string {
  const version = readGitVersion();

  return version === null
    ? `The integration suite requires git ${MINIMUM_GIT_VERSION} or newer; git is missing or its version could not be parsed`
    : `The integration suite requires git ${MINIMUM_GIT_VERSION} or newer; detected ${version}`;
}

/**
 * Guards the integration gate itself.
 *
 * Every fixture suite skips when git is missing or older than the documented floor, which would
 * let `bun run test:integration` pass on a machine that never ran a real-git proof. This suite is
 * deliberately unskipped, so the gate fails loudly instead of silently skipping everything.
 */
describe("integration gate", () => {
  it("requires an installed git that meets the documented minimum", () => {
    expect(isGitAvailable(), readGateMessage()).toBeTrue();
  });
});
