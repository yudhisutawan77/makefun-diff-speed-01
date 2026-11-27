// solve.js — a fast, dependency-free line diff that returns exactly what
// makefun-diff 1.0.0 returns for the same { old, new }.
//
// The shape of the answer (header line, hunks, context of 3, deletions before
// insertions, the "%" line after a line with no trailing newline) follows the
// competition's rule, and the edit script follows Myers's greedy search with
// the deletion tie-break: on every diagonal the path reaching furthest into
// the old text wins, and a deletion wins when both reach the same point.
//
// Speed comes from three choices:
//  - every line is interned once to a small integer id, so the search compares
//    integers instead of strings;
//  - the search keeps its diagonals in one flat Int32Array (depth d lives at
//    offset d*d, diagonal k at slot k+d), allocating nothing per step;
//  - the snake stops on sentinel ids (-1 in the old text, -2 in the new one)
//    placed just past the searched region, so it needs no bounds checks.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** Kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/**
 * One text cut into lines. `parts` is the text split on "\n" (so parts[i] is
 * line i without its newline, and parts[count] is "" when the text ends in a
 * newline, else the bare last line's text). `ids` holds one integer per line
 * plus a trailing sentinel slot, shared across both texts through the two
 * maps: lines that end in "\n" intern in `lined`, the one bare last line in
 * `bare`, so a line with a newline never collides with the same text without
 * one. `counter` hands out fresh ids.
 */
function tokenize(text, lined, bare, counter) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const count = last + (parts[last] !== '' ? 1 : 0);
  const ids = new Int32Array(count + 1);
  for (let i = 0; i < last; i++) {
    const line = parts[i];
    let id = lined.get(line);
    if (id === undefined) {
      id = counter.next++;
      lined.set(line, id);
    }
    ids[i] = id;
  }
  if (parts[last] !== '') {
    const line = parts[last];
    let id = bare.get(line);
    if (id === undefined) {
      id = counter.next++;
      bare.set(line, id);
    }
    ids[last] = id;
  }
  return { parts, ids, count };
}

/**
 * The edit runs of the middle region a[ao .. ao+n) into b[bo .. bo+m), as a
 * flat array [kind, count, kind, count, ...] in order, kinds KEEP/DELETE/
 * INSERT. The caller has trimmed the common prefix and suffix already, so the
 * region starts and ends on a difference (or is empty on one side).
 *
 * This is Myers's greedy search, written on the flat V table: buf holds one
 * snapshot per depth, depth d at offset d*d, diagonal k at slot k+d, each slot
 * the furthest old-lines-consumed count that depth reaches on that diagonal,
 * or -1 when the diagonal has no path. From depth d-1 the deletion candidate
 * comes from diagonal k-1 (one old line further) and the insertion candidate
 * from diagonal k+1 (same old count); the deletion wins ties. A candidate
 * that would step past either text's end is no candidate. The snake then
 * follows equal lines as far as they go, stopping on the sentinel ids.
 */
function searchMiddle(a, b, ao, bo, n, m) {
  if (n === 0) return m === 0 ? [] : [INSERT, m];
  if (m === 0) return [DELETE, n];
  let buf = new Int32Array(1 << 24);
  let x = 0;
  let y = 0;
  while (a[ao + x] === b[bo + y]) {
    x++;
    y++;
  }
  buf[0] = x;
  if (x >= n && y >= m) return [KEEP, x];
  for (let d = 1; ; d++) {
    const need = (d + 1) * (d + 1);
    if (need > buf.length) {
      let grown = buf.length * 2;
      while (grown < need) grown *= 2;
      const next = new Int32Array(grown);
      next.set(buf);
      buf = next;
    }
    const base = d * d;
    const pbase = (d - 1) * (d - 1);
    const lastJ = 2 * d;
    let xr = -1;
    for (let j = 0, k = -d; j <= lastJ; j += 2, k += 2) {
      // xa is this diagonal's insertion candidate, read fresh; xr is the
      // deletion candidate, carried over from the previous diagonal's read.
      const xa = j < lastJ ? buf[pbase + j] : -1;
      const delOk = xr >= 0 && xr < n;
      const insOk = xa >= 0 && xa - k - 1 < m;
      if (!delOk && !insOk) {
        buf[base + j] = -1;
        xr = xa;
        continue;
      }
      let nx = delOk && (!insOk || xr + 1 >= xa) ? xr + 1 : xa;
      let ny = nx - k;
      while (a[ao + nx] === b[bo + ny]) {
        nx++;
        ny++;
      }
      buf[base + j] = nx;
      if (nx >= n && ny >= m) return backtrack(buf, n, m, d, k);
      xr = xa;
    }
  }
}

/**
 * Walk the snapshots back from depth D, diagonal kf, rebuilding the runs the
 * forward search took. At each depth the step is a deletion when the deletion
 * candidate was the one the search chose (same test as the forward loop), else
 * an insertion; the snake after that step is the keep between the step and the
 * stored endpoint. Pairs come out reversed, so they are flipped and merged.
 */
function backtrack(buf, n, m, D, kf) {
  const tmp = new Int32Array(4 * D + 4);
  let t = 0;
  let k = kf;
  let cx = buf[D * D + kf + D];
  for (let d = D; d >= 1; d--) {
    const pbase = (d - 1) * (d - 1);
    const j = k + d;
    const xr = j > 0 ? buf[pbase + j - 2] : -1;
    const xa = j < 2 * d ? buf[pbase + j] : -1;
    const delOk = xr >= 0 && xr < n;
    const insOk = xa >= 0 && xa - k - 1 < m;
    const isDel = delOk && (!insOk || xr + 1 >= xa);
    const afterMove = isDel ? xr + 1 : xa;
    const prevX = isDel ? xr : xa;
    const keep = cx - afterMove;
    if (keep > 0) {
      tmp[t++] = KEEP;
      tmp[t++] = keep;
    }
    tmp[t++] = isDel ? DELETE : INSERT;
    tmp[t++] = 1;
    cx = prevX;
    k = isDel ? k - 1 : k + 1;
  }
  if (cx > 0) {
    tmp[t++] = KEEP;
    tmp[t++] = cx;
  }
  const runs = [];
  for (let i = t - 2; i >= 0; i -= 2) {
    const kind = tmp[i];
    const count = tmp[i + 1];
    if (runs.length > 0 && runs[runs.length - 2] === kind) runs[runs.length - 1] += count;
    else runs.push(kind, count);
  }
  return runs;
}

/**
 * One patch line: the op, the line's text, and a newline; a line that ends
 * its text with no newline gets one newline plus a "%" line of its own. The
 * last line of a text is the only one that can lack the newline, which is
 * what `bare` records.
 */
function pushLine(out, op, parts, at, bare) {
  if (at === parts.length - 1 && bare) out.push(op, parts[at], '\n%\n');
  else out.push(op, parts[at], '\n');
}

/**
 * The patch text for the full runs list: header, then hunks. Change runs at
 * most 2 * CONTEXT kept lines apart share a hunk; each hunk shows up to
 * CONTEXT kept lines before its first run and after its last, and lists each
 * run's deletions before its insertions.
 */
function renderPatch(aParts, bParts, aBare, bBare, oldCount, newCount, runs) {
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const kind = runs[i];
    const count = runs[i + 1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DELETE) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h === undefined ? undefined : h[h.length - 1];
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${oldCount} new=${newCount} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, oldCount - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) pushLine(out, '=', aParts, at, aBare);
      for (let i = 0; i < c.dels; i++) pushLine(out, '-', aParts, c.o + i, aBare);
      for (let i = 0; i < c.ins; i++) pushLine(out, '+', bParts, c.p + i, bBare);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) pushLine(out, '=', aParts, at, aBare);
  }
  return out.join('');
}

/** make.fun's own patch of input.old into input.new, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('solve.js: the input is { old, new }, two strings');
  }
  const lined = new Map();
  const bare = new Map();
  const counter = { next: 0 };
  const a = tokenize(input.old, lined, bare, counter);
  const b = tokenize(input.new, lined, bare, counter);
  const N = a.count;
  const M = b.count;
  const aBare = a.parts[N] !== '';
  const bBare = b.parts[M] !== '';
  // The sentinels at each text's end stop the snakes exactly there.
  a.ids[N] = -1;
  b.ids[M] = -2;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < N && prefix < M && a.ids[prefix] === b.ids[prefix]) prefix++;
  let suffix = 0;
  while (suffix < N - prefix && suffix < M - prefix && a.ids[N - 1 - suffix] === b.ids[M - 1 - suffix]) suffix++;
  const n = N - prefix - suffix;
  const m = M - prefix - suffix;
  // Sentinels just past the searched region stop its snakes exactly there.
  a.ids[prefix + n] = -1;
  b.ids[prefix + m] = -2;
  const middle = searchMiddle(a.ids, b.ids, prefix, prefix, n, m);
  // The full runs: prefix keep, the middle, suffix keep, merged where kinds meet.
  const runs = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    if (runs.length > 0 && runs[runs.length - 2] === kind) runs[runs.length - 1] += count;
    else runs.push(kind, count);
  };
  pushRun(KEEP, prefix);
  for (let i = 0; i < middle.length; i += 2) pushRun(middle[i], middle[i + 1]);
  pushRun(KEEP, suffix);
  return renderPatch(a.parts, b.parts, aBare, bBare, N, M, runs);
}
