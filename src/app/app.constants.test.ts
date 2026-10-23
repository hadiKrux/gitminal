import { describe, expect, it } from "bun:test";
import manifest from "../../package.json";
import { APP_PACKAGE_NAME, APP_VERSION } from "./app.constants";

describe("app constants", () => {
  it("reads the package name from the manifest", () => {
    expect(APP_PACKAGE_NAME).toBe("@im4all/gitminal");
  });

  it("reads the running version from the manifest", () => {
    expect(APP_VERSION).toBe(manifest.version);
  });
});
