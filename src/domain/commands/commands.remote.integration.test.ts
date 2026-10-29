import { describe, expect, it } from "bun:test";
import { executeRemoteFetch } from "@/domain/commands/commands.fetch";
import { executeRemotePush } from "@/domain/commands/commands.remote";
import type { CommandHandlerContext } from "@/domain/commands/commands.types";
import type { GitClient } from "@/domain/git/git.types";
import { isGitAvailable, withGitFixture } from "@/test/git.fixture";

const gitAvailable = isGitAvailable();

/**
 * Builds a push handler context bound to one fixture repository.
 *
 * @param client - Production client from the fixture.
 * @param cwd - Repository root.
 * @param commandId - Push variant.
 * @param branch - Branch target.
 * @returns The handler context with a never-aborted signal.
 */
function createPushContext(
  client: GitClient,
  cwd: string,
  commandId: string,
  branch: string,
): CommandHandlerContext {
  return {
    request: { commandId, target: { kind: "branch", name: branch } },
    target: { kind: "branch", name: branch },
    cwd,
    client,
    signal: new AbortController().signal,
    notifyProgress: () => {},
  };
}

/**
 * Builds a fetch handler context bound to one fixture repository.
 *
 * @param client - Production client from the fixture.
 * @param cwd - Repository root.
 * @param remote - Explicit configured remote selected in the palette.
 * @returns The handler context with a never-aborted signal.
 */
function createFetchContext(client: GitClient, cwd: string, remote: string): CommandHandlerContext {
  return {
    request: { commandId: "remote.fetch", target: { kind: "none" }, formValues: { remote } },
    target: { kind: "none" },
    cwd,
    client,
    signal: new AbortController().signal,
    notifyProgress: () => {},
  };
}

describe.skipIf(!gitAvailable)("remote.push against a real repository", () => {
  it("force-pushes only the current branch when push.default is matching", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        const added = await fixture.run(["remote", "add", "origin", upstream.root], {
          operationClass: "write",
        });
        expect(added.ok).toBeTrue();

        expect(
          (await fixture.run(["push", "-u", "origin", "main"], { operationClass: "network" })).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["checkout", "-b", "feature"], { operationClass: "write" })).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["push", "-u", "origin", "feature"], { operationClass: "network" }))
            .ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["checkout", "main"], { operationClass: "write" })).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["config", "push.default", "matching"], { operationClass: "write" }))
            .ok,
        ).toBeTrue();

        const featureBefore = (
          await upstream.run(["rev-parse", "refs/heads/feature"])
        ).stdout.trim();

        fixture.writeFile("README.md", "rewritten main\n");
        expect(
          (
            await fixture.run(["commit", "--amend", "-m", "Rewritten seed", "--no-gpg-sign"], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        const mainAfter = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();

        const outcome = await executeRemotePush(
          createPushContext(fixture.client, fixture.root, "remote.pushForceOverwrite", "main"),
        );

        expect(outcome.steps).toHaveLength(1);
        expect(outcome.steps[0]?.exitCode).toBe(0);
        expect(outcome.steps[0]?.argv).toContain("--force");
        expect(outcome.steps[0]?.argv).toContain("refs/heads/main:refs/heads/main");
        expect((await upstream.run(["rev-parse", "refs/heads/main"])).stdout.trim()).toBe(
          mainAfter,
        );
        expect((await upstream.run(["rev-parse", "refs/heads/feature"])).stdout.trim()).toBe(
          featureBefore,
        );
      });
    });
  });

  it("pushes to a configured upstream branch whose name differs from the local branch", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        expect(
          (
            await fixture.run(["remote", "add", "origin", upstream.root], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["checkout", "-b", "local-name"], { operationClass: "write" })).ok,
        ).toBeTrue();
        expect(
          (
            await fixture.run(["push", "-u", "origin", "local-name:remote-name"], {
              operationClass: "network",
            })
          ).ok,
        ).toBeTrue();

        fixture.writeFile("README.md", "differently named upstream\n");
        expect(
          (
            await fixture.run(["commit", "-am", "Local commit", "--no-gpg-sign"], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        const localAfter = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();

        const outcome = await executeRemotePush(
          createPushContext(fixture.client, fixture.root, "remote.push", "local-name"),
        );

        expect(outcome.steps).toHaveLength(1);
        expect(outcome.steps[0]?.exitCode).toBe(0);
        expect(outcome.steps[0]?.argv).toContain("refs/heads/local-name:refs/heads/remote-name");
        expect((await upstream.run(["rev-parse", "refs/heads/remote-name"])).stdout.trim()).toBe(
          localAfter,
        );
        expect(
          (await upstream.run(["rev-parse", "--verify", "refs/heads/local-name"])).ok,
        ).toBeFalse();
      });
    });
  });

  it("refuses to push when HEAD moved to another branch than the captured target", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        expect(
          (
            await fixture.run(["remote", "add", "origin", upstream.root], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["push", "-u", "origin", "main"], { operationClass: "network" })).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["checkout", "-b", "other"], { operationClass: "write" })).ok,
        ).toBeTrue();

        fixture.writeFile("README.md", "other branch content\n");
        expect(
          (
            await fixture.run(["commit", "-am", "Other commit", "--no-gpg-sign"], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        const mainTip = (await fixture.run(["rev-parse", "refs/heads/main"])).stdout.trim();
        const otherTip = (await fixture.run(["rev-parse", "refs/heads/other"])).stdout.trim();

        const outcome = await executeRemotePush(
          createPushContext(fixture.client, fixture.root, "remote.push", "main"),
        );

        expect(outcome.steps).toHaveLength(1);
        expect(outcome.steps[0]?.exitCode).toBe(1);
        expect(outcome.steps[0]?.stderr).toContain("current branch changed");
        expect((await upstream.run(["rev-parse", "refs/heads/main"])).stdout.trim()).toBe(mainTip);
        expect((await upstream.run(["rev-parse", "refs/heads/main"])).stdout.trim()).not.toBe(
          otherTip,
        );
        expect((await upstream.run(["rev-parse", "--verify", "refs/heads/other"])).ok).toBeFalse();
      });
    });
  });

  it("pushes the captured branch when it equals the actual current branch", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        expect(
          (
            await fixture.run(["remote", "add", "origin", upstream.root], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["push", "-u", "origin", "main"], { operationClass: "network" })).ok,
        ).toBeTrue();

        fixture.writeFile("README.md", "new main content\n");
        expect(
          (
            await fixture.run(["commit", "-am", "Main commit", "--no-gpg-sign"], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        const localTip = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();

        const outcome = await executeRemotePush(
          createPushContext(fixture.client, fixture.root, "remote.push", "main"),
        );

        expect(outcome.steps[0]?.exitCode).toBe(0);
        expect((await upstream.run(["rev-parse", "refs/heads/main"])).stdout.trim()).toBe(localTip);
      });
    });
  });

  it("pushes to a slash-named upstream remote instead of its prefix remote", async () => {
    await withGitFixture({ bare: true, seed: false }, async (prefix) => {
      await withGitFixture({ bare: true, seed: false }, async (slash) => {
        await withGitFixture({}, async (fixture) => {
          expect(
            (
              await fixture.run(["remote", "add", "a", prefix.root], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();
          // Intentionally configure a legacy overlapping remote directly: newer git rejects
          // remote add for a/b beside a, but existing configurations must remain supported.
          for (const [key, value] of [
            ["remote.a/b.url", slash.root],
            ["remote.a/b.fetch", "+refs/heads/*:refs/remotes/a/b/*"],
          ] as const) {
            expect(
              (await fixture.run(["config", key, value], { operationClass: "write" })).ok,
            ).toBeTrue();
          }
          expect(
            (await fixture.run(["checkout", "-b", "foo"], { operationClass: "write" })).ok,
          ).toBeTrue();

          fixture.writeFile("foo.txt", "foo content\n");
          expect((await fixture.run(["add", "-A"], { operationClass: "write" })).ok).toBeTrue();
          expect(
            (
              await fixture.run(["commit", "-m", "Foo commit", "--no-gpg-sign"], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();
          expect(
            (await fixture.run(["config", "branch.foo.remote", "a/b"], { operationClass: "write" }))
              .ok,
          ).toBeTrue();
          expect(
            (
              await fixture.run(["config", "branch.foo.merge", "refs/heads/main"], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();

          const tip = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();

          const outcome = await executeRemotePush(
            createPushContext(fixture.client, fixture.root, "remote.push", "foo"),
          );

          expect(outcome.steps).toHaveLength(1);
          expect(outcome.steps[0]?.exitCode).toBe(0);
          expect(outcome.steps[0]?.argv).toContain("a/b");
          expect(outcome.steps[0]?.argv).toContain("refs/heads/foo:refs/heads/main");
          expect((await slash.run(["rev-parse", "refs/heads/main"])).stdout.trim()).toBe(tip);
          expect((await prefix.run(["rev-parse", "--verify", "refs/heads/main"])).ok).toBeFalse();
          expect((await prefix.run(["rev-parse", "--verify", "refs/heads/b/main"])).ok).toBeFalse();
        });
      });
    });
  });

  it("fetches a slash-named upstream remote into its own tracking ref", async () => {
    await withGitFixture({ bare: true, seed: false }, async (prefix) => {
      await withGitFixture({ bare: true, seed: false }, async (slash) => {
        await withGitFixture({}, async (fixture) => {
          expect(
            (
              await fixture.run(["remote", "add", "a", prefix.root], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();
          // Intentionally configure a legacy overlapping remote directly: newer git rejects
          // remote add for a/b beside a, but existing configurations must remain supported.
          for (const [key, value] of [
            ["remote.a/b.url", slash.root],
            ["remote.a/b.fetch", "+refs/heads/*:refs/remotes/a/b/*"],
          ] as const) {
            expect(
              (await fixture.run(["config", key, value], { operationClass: "write" })).ok,
            ).toBeTrue();
          }

          const slashTip = (await fixture.run(["rev-parse", "refs/heads/main"])).stdout.trim();

          expect(
            (
              await fixture.run(["push", "a/b", "refs/heads/main:refs/heads/main"], {
                operationClass: "network",
              })
            ).ok,
          ).toBeTrue();

          fixture.writeFile("prefix-only.txt", "prefix only\n");
          expect((await fixture.run(["add", "-A"], { operationClass: "write" })).ok).toBeTrue();
          expect(
            (
              await fixture.run(["commit", "-m", "Prefix commit", "--no-gpg-sign"], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();
          expect(
            (
              await fixture.run(["push", "a", "refs/heads/main:refs/heads/main"], {
                operationClass: "network",
              })
            ).ok,
          ).toBeTrue();

          // A push may update the local remote-tracking ref. Remove both so the fetch below is the
          // only writer and the assertion proves which remote it reached.
          await fixture.run(["update-ref", "-d", "--", "refs/remotes/a/b/main"], {
            operationClass: "write",
          });
          await fixture.run(["update-ref", "-d", "--", "refs/remotes/a/main"], {
            operationClass: "write",
          });

          expect(
            (await fixture.run(["checkout", "-b", "foo"], { operationClass: "write" })).ok,
          ).toBeTrue();
          expect(
            (await fixture.run(["config", "branch.foo.remote", "a/b"], { operationClass: "write" }))
              .ok,
          ).toBeTrue();
          expect(
            (
              await fixture.run(["config", "branch.foo.merge", "refs/heads/main"], {
                operationClass: "write",
              })
            ).ok,
          ).toBeTrue();

          const outcome = await executeRemoteFetch(
            createFetchContext(fixture.client, fixture.root, "a/b"),
          );

          expect(outcome.steps).toHaveLength(1);
          expect(outcome.steps[0]?.exitCode).toBe(0);
          expect(outcome.steps[0]?.argv).toContain("a/b");
          expect(outcome.remoteResults).toEqual([{ remote: "a/b", succeeded: true }]);
          expect((await fixture.run(["rev-parse", "refs/remotes/a/b/main"])).stdout.trim()).toBe(
            slashTip,
          );
          expect(
            (await fixture.run(["rev-parse", "--verify", "refs/remotes/a/main"])).ok,
          ).toBeFalse();
        });
      });
    });
  });

  it("creates origin/<branch> and sets its upstream when none exists", async () => {
    await withGitFixture({ bare: true, seed: false }, async (upstream) => {
      await withGitFixture({}, async (fixture) => {
        expect(
          (
            await fixture.run(["remote", "add", "origin", upstream.root], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();
        expect(
          (await fixture.run(["checkout", "-b", "feature"], { operationClass: "write" })).ok,
        ).toBeTrue();

        fixture.writeFile("feature.txt", "feature content\n");
        expect(
          (
            await fixture.run(["add", "-A"], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();
        expect(
          (
            await fixture.run(["commit", "-m", "Feature commit", "--no-gpg-sign"], {
              operationClass: "write",
            })
          ).ok,
        ).toBeTrue();

        const localTip = (await fixture.run(["rev-parse", "HEAD"])).stdout.trim();

        const outcome = await executeRemotePush(
          createPushContext(fixture.client, fixture.root, "remote.pushNoVerify", "feature"),
        );

        expect(outcome.steps[0]?.exitCode).toBe(0);
        expect((await upstream.run(["rev-parse", "refs/heads/feature"])).stdout.trim()).toBe(
          localTip,
        );
        expect(
          (await fixture.run(["config", "--get", "branch.feature.remote"])).stdout.trim(),
        ).toBe("origin");
        expect((await fixture.run(["config", "--get", "branch.feature.merge"])).stdout.trim()).toBe(
          "refs/heads/feature",
        );
      });
    });
  });
});
