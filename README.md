# Gitminal

A keyboard-first terminal git client.

![Gitminal UI reference](gitminal.png)

The screenshot above is the authoritative UI reference. The app must match it.

Requires [Bun](https://bun.sh/) 1.3.0 or later.

To install dependencies:

```bash
bun install
```

To run:

```bash
bun dev
```

To typecheck:

```bash
bun run typecheck
```

To lint and format with [Biome](https://biomejs.dev/):

```bash
bun run check        # lint, format, and import checks
bun run check:fix    # apply safe fixes and formatting
bun run lint         # lint only
bun run format       # format only
```

To check code health with [Fallow](https://fallow.tools/):

```bash
bun run audit        # dead code, complexity, duplication, and styling on changed files
```

`bun install` installs the [Husky](https://typicode.github.io/husky/) Git hooks. The pre-commit hook runs `fallow audit` against the merge base of the branch upstream, so commits that introduce dead code, duplication, or complex functions are blocked. Use `git commit --no-verify` only when you deliberately need to bypass it.

This project was created using `bun create tui`. [create-tui](https://github.com/msmps/create-tui) is the easiest way to get started with OpenTUI.

## License

MIT - see [LICENSE](LICENSE).
