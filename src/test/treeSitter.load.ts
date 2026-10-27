import { registerSyntaxParsers } from "@/app/syntax.parsers";

// Tests exercise the same vendored grammars as the app. Registration has to happen before OpenTUI's
// tree-sitter client initializes on the first highlighted block, which any test file may trigger.
registerSyntaxParsers(new URL("../../assets/parsers/", import.meta.url));
