# makefun-diff-speed-01 — typed-array Myers, 4/4 practice exact, 2.43x faster than baseline on local A/B

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/yudhisutawan77/makefun-diff-speed-01/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/yudhisutawan77/makefun-diff-speed-01/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A fast, dependency-free drop-in for [makefun-diff 1.0.0](https://make.fun/bounty/diff-speed-01-run-20261126), make.fun's own line diff, written for the [Diff two texts faster](https://make.fun/bounty/diff-speed-01-run-20261126) bounty. `solve.js` returns byte-for-byte the same patch as the reference for every input, and does it faster.

## How it works

- **Interned lines.** Every line is interned once to a small integer id (lines ending in `\n` and the one bare last line live in separate maps, so a line never collides with the same text without its newline). The search then compares integers instead of strings.
- **Flat Myers table.** The greedy search keeps its diagonals in one flat `Int32Array` (depth `d` at offset `d*d`, diagonal `k` at slot `k+d`), allocating nothing per step — no path objects, no linked lists, unlike the reference.
- **Same script, exactly.** Common prefix, then common suffix, then Myers's greedy search with the deletion tie-break (a deletion wins when deletion and insertion reach the same point); snakes stop on sentinel ids placed just past the searched region, so no bounds checks in the hot loop. The patch format (header, hunks with 3 lines of context, deletions before insertions, `%` after a line with no trailing newline) matches the reference.
- **Driver.** `main.ts` reads `/input/cases.json`, answers each case alone with `run()`, and writes `/output/answers.json`. Outside a container, `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` stand in for `/input` / `/output`. It turns V8's incremental marking off before importing `solve.js`, as the house baseline does.

## Measured results (local, this machine)

- **Exactness:** practice set 4/4 identical to the reference; 40/40 cases drawn with the kit's own generator (same distribution as the scored set, including CRLF and bare-final-newline cases); 12,035/12,035 edge cases and small random fuzz cases byte-identical.
- **Speed (A/B, same machine, same conditions, median of 7 runs over the 4 practice cases):** this entry 504.8 ms total vs house baseline 1,228.9 ms — **2.43x faster** (per case 2.40x–2.44x).
- **Grade-local:** `passed: 1`, `cases_passed: 4/4`.

## Layout

- `solve.js` — the diff (`run(input)` returns the patch as one string)
- `main.ts` — the harness driver
- `LICENSE` — MIT
