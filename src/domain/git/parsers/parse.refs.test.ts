import { describe, expect, it } from "bun:test";
import { parseLocalTags, parseLsRemoteTags } from "@/domain/git/parsers/parse.refs";

describe("parseLocalTags", () => {
  it("reads an annotated tag through its peeled object and subject", () => {
    const stdout = [
      [
        "v1.0.0",
        "tag",
        "commit-oid",
        "tag-object-oid",
        "Release the first version",
        "annotated tag message",
      ].join("\0"),
      "",
    ].join("\n");

    expect(parseLocalTags(stdout)).toEqual([
      {
        name: "v1.0.0",
        objectType: "tag",
        targetOid: "commit-oid",
        subject: "Release the first version",
      },
    ]);
  });

  it("reads a lightweight tag through the direct object and subject", () => {
    const stdout = ["v0.9.0\0commit\0\0commit-oid\0\0First cut", ""].join("\n");

    expect(parseLocalTags(stdout)).toEqual([
      {
        name: "v0.9.0",
        objectType: "commit",
        targetOid: "commit-oid",
        subject: "First cut",
      },
    ]);
  });

  it("keeps the tag message out of the summary for an annotated tag", () => {
    const stdout = "v2\0tag\0commit-2\0tag-2\0real commit subject\0tag message\n";
    const [tag] = parseLocalTags(stdout);

    expect(tag?.subject).toBe("real commit subject");
    expect(tag?.subject).not.toContain("tag message");
  });

  it("keeps an empty subject when the commit has no message", () => {
    const stdout = "v3\0commit\0\0commit-3\0\0\n";

    expect(parseLocalTags(stdout)[0]?.subject).toBe("");
  });

  it("skips records with an unsupported object type", () => {
    expect(parseLocalTags("tree-tag\0tree\0\0tree-oid\0\0subject\n")).toEqual([]);
  });

  it("skips malformed and short records", () => {
    const stdout = ["v1", "v2\0commit", "", "\0\0\0\0\0\0"].join("\n");

    expect(parseLocalTags(stdout)).toEqual([]);
  });
});

describe("parseLsRemoteTags", () => {
  it("collapses peeled lines into the advertised tag name", () => {
    const stdout = [
      "1111111111111111111111111111111111111111\trefs/tags/v1.0.0",
      "2222222222222222222222222222222222222222\trefs/tags/v1.0.0^{}",
      "3333333333333333333333333333333333333333\trefs/tags/annotated",
      "4444444444444444444444444444444444444444\trefs/tags/annotated^{}",
      "",
    ].join("\n");

    expect(parseLsRemoteTags(stdout)).toEqual(["v1.0.0", "annotated"]);
  });

  it("reports each advertised name once across repeated refs", () => {
    const stdout = ["1111\trefs/tags/v1", "2222\trefs/tags/v1", "3333\trefs/tags/v1^{}", ""].join(
      "\n",
    );

    expect(parseLsRemoteTags(stdout)).toEqual(["v1"]);
  });

  it("ignores branches and malformed lines", () => {
    const stdout = [
      "1111\trefs/heads/main",
      "no-tab-separator",
      "\trefs/tags/v1",
      "2222\trefs/tags/",
      "3333\trefs/tags/v2",
      "",
    ].join("\n");

    expect(parseLsRemoteTags(stdout)).toEqual(["v2"]);
  });

  it("returns an empty list for empty output", () => {
    expect(parseLsRemoteTags("")).toEqual([]);
  });
});
