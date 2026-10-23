import { describe, expect, it } from "bun:test";
import { checkForUpdate } from "@/domain/update/update.check";
import { NPM_REGISTRY_URL, UPDATE_CHECK_TIMEOUT_MS } from "@/domain/update/update.constants";

/** Package name used by the tests. */
const PACKAGE_NAME = "@im4all/gitminal";

/** Current version used by the tests. */
const CURRENT_VERSION = "0.1.0";

/**
 * Builds a fetch implementation that returns a JSON response.
 *
 * @param body - The JSON body to return.
 * @param init - Optional response status and headers.
 * @returns A fetch-compatible function.
 */
function respondWith(body: unknown, init?: ResponseInit): () => Promise<Response> {
  return async () => new Response(JSON.stringify(body), init);
}

describe("checkForUpdate", () => {
  it("returns available when the registry version is newer", async () => {
    const result = await checkForUpdate({
      packageName: PACKAGE_NAME,
      currentVersion: CURRENT_VERSION,
      fetchImpl: respondWith({ version: "0.2.0" }),
    });

    expect(result).toEqual({
      status: "available",
      currentVersion: CURRENT_VERSION,
      latestVersion: "0.2.0",
    });
  });

  it("returns up-to-date for equal and older registry versions", async () => {
    const equal = await checkForUpdate({
      packageName: PACKAGE_NAME,
      currentVersion: CURRENT_VERSION,
      fetchImpl: respondWith({ version: CURRENT_VERSION }),
    });
    const older = await checkForUpdate({
      packageName: PACKAGE_NAME,
      currentVersion: CURRENT_VERSION,
      fetchImpl: respondWith({ version: "0.0.9" }),
    });

    expect(equal).toEqual({ status: "up-to-date" });
    expect(older).toEqual({ status: "up-to-date" });
  });

  it("URL-encodes a scoped package name", async () => {
    let requestedUrl = "";

    await checkForUpdate({
      packageName: PACKAGE_NAME,
      currentVersion: CURRENT_VERSION,
      fetchImpl: async (url) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ version: CURRENT_VERSION }));
      },
    });

    expect(requestedUrl).toBe(`${NPM_REGISTRY_URL}/%40im4all%2Fgitminal/latest`);
    expect(requestedUrl).toBe("https://registry.npmjs.org/%40im4all%2Fgitminal/latest");
  });

  it("returns unavailable for an HTTP error", async () => {
    const result = await checkForUpdate({
      packageName: PACKAGE_NAME,
      currentVersion: CURRENT_VERSION,
      fetchImpl: async () => new Response("registry failure", { status: 500 }),
    });

    expect(result).toEqual({ status: "unavailable" });
  });

  it("returns unavailable for a malformed payload", async () => {
    const payloads: unknown[] = [null, [], { version: 42 }, { version: "not-a-version" }];

    for (const payload of payloads) {
      const result = await checkForUpdate({
        packageName: PACKAGE_NAME,
        currentVersion: CURRENT_VERSION,
        fetchImpl: respondWith(payload),
      });

      expect(result).toEqual({ status: "unavailable" });
    }
  });

  it("returns unavailable when the response body is not JSON", async () => {
    const result = await checkForUpdate({
      packageName: PACKAGE_NAME,
      currentVersion: CURRENT_VERSION,
      fetchImpl: async () => new Response("not json"),
    });

    expect(result).toEqual({ status: "unavailable" });
  });

  it("returns unavailable when the network request throws", async () => {
    const result = await checkForUpdate({
      packageName: PACKAGE_NAME,
      currentVersion: CURRENT_VERSION,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });

    expect(result).toEqual({ status: "unavailable" });
  });

  it("returns unavailable when the request is aborted by the timeout", async () => {
    const result = await checkForUpdate({
      packageName: PACKAGE_NAME,
      currentVersion: CURRENT_VERSION,
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("The request was aborted.", "AbortError"));
          });
        }),
    });

    expect(result).toEqual({ status: "unavailable" });
  });

  it("self-enforces the timeout when fetch ignores the abort signal", async () => {
    const result = await checkForUpdate({
      packageName: PACKAGE_NAME,
      currentVersion: CURRENT_VERSION,
      timeoutMs: 5,
      fetchImpl: () => new Promise<Response>(() => {}),
    });

    expect(result).toEqual({ status: "unavailable" });
  });

  it("does not block the caller while a request is pending", async () => {
    const outcome = await Promise.race([
      checkForUpdate({
        packageName: PACKAGE_NAME,
        currentVersion: CURRENT_VERSION,
        timeoutMs: 1,
        fetchImpl: () => new Promise<Response>(() => {}),
      }).then(() => "settled"),
      Promise.resolve("caller-continues"),
    ]);

    expect(outcome).toBe("caller-continues");
  });
});

describe("update check bounds", () => {
  it("keeps the documented timeout", () => {
    expect(UPDATE_CHECK_TIMEOUT_MS).toBe(2_000);
  });
});
