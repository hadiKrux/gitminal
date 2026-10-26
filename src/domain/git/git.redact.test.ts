import { describe, expect, it } from "bun:test";
import { redactArgv, redactText } from "@/domain/git/git.redact";

describe("redactText", () => {
  it("redacts credentials in https URLs", () => {
    expect(redactText("fatal: unable to access 'https://user:secret@example.com/repo.git/'")).toBe(
      "fatal: unable to access 'https://[redacted]@example.com/repo.git/'",
    );
  });

  it("redacts a token used as the URL user", () => {
    expect(redactText("remote: https://ghp_abc123@github.com/org/repo")).toBe(
      "remote: https://[redacted]@github.com/org/repo",
    );
  });

  it("keeps a URL without credentials untouched", () => {
    expect(redactText("https://github.com/org/repo.git")).toBe("https://github.com/org/repo.git");
  });

  it("redacts authorization headers", () => {
    expect(redactText("Authorization: Bearer abc.def")).toBe("Authorization: [redacted]");
    expect(redactText("proxy-authorization: Basic dXNlcjpwYXNz")).toBe(
      "proxy-authorization: [redacted]",
    );
  });

  it("redacts credential environment assignments", () => {
    expect(redactText("GITHUB_TOKEN=ghp_secret")).toBe("GITHUB_TOKEN=[redacted]");
    expect(redactText("MY_PASSWORD='correct horse'")).toBe("MY_PASSWORD=[redacted]");
    expect(redactText("AWS_SECRET_ACCESS_KEY=abc/def")).toBe("AWS_SECRET_ACCESS_KEY=[redacted]");
  });

  it("redacts a bare bearer token", () => {
    expect(redactText("sent bearer eyJhbGciOiJIUzI1NiJ9 to the server")).toBe(
      "sent bearer [redacted] to the server",
    );
  });

  it("is idempotent", () => {
    const once = redactText("https://user:pass@host/repo");

    expect(redactText(once)).toBe(once);
  });

  it("leaves unrelated text untouched", () => {
    expect(redactText("fatal: not a git repository (or any of the parent directories)")).toBe(
      "fatal: not a git repository (or any of the parent directories)",
    );
  });
});

describe("redactArgv", () => {
  it("redacts every argument", () => {
    expect(redactArgv(["git", "remote", "add", "origin", "https://token@host/repo"])).toEqual([
      "git",
      "remote",
      "add",
      "origin",
      "https://[redacted]@host/repo",
    ]);
  });
});

describe("redaction coverage table", () => {
  it("redacts every documented credential shape", () => {
    const cases = [
      {
        name: "URL userinfo with a token",
        raw: "fatal: unable to access 'https://x-access-token:ghp_ab@github.com/org/repo.git/'",
        expected: "fatal: unable to access 'https://[redacted]@github.com/org/repo.git/'",
      },
      {
        name: "Proxy-Authorization header",
        raw: "Proxy-Authorization: Basic dXNlcjpwYXNz",
        expected: "Proxy-Authorization: [redacted]",
      },
      {
        name: "lowercase credential environment name",
        raw: "github_token=ghp_lowercase",
        expected: "github_token=[redacted]",
      },
      {
        name: "bearer token in a single argument",
        raw: "Bearer abc.def",
        expected: "Bearer [redacted]",
      },
    ] as const;

    for (const testCase of cases) {
      expect(redactText(testCase.raw), testCase.name).toBe(testCase.expected);
    }
  });

  it("redacts a bearer token inside argv", () => {
    expect(redactArgv(["git", "http.extraHeader=Authorization: Bearer abc.def"])).toEqual([
      "git",
      "http.extraHeader=Authorization: [redacted]",
    ]);
    expect(redactArgv(["git", "credential", "Bearer abc.def"])).toEqual([
      "git",
      "credential",
      "Bearer [redacted]",
    ]);
  });
});
