// Deterministic case generator for the source_map / margin / styled_buffer probe.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const ri = (n: number) => Math.floor(rnd() * n);
const pick = <T>(a: T[]) => a[ri(a.length)]!;
const hex = (s: string) => (s === "" ? "-" : Buffer.from(s, "utf8").toString("hex"));
const enc = new TextEncoder();
const out: string[] = [];
const toks = ["a", "b", "x", " ", "  ", "\n", "\n", "\r\n", "\t", "é", "日", "😀", "//", "///", "{", "}", "(", ")", "fn", "‍", "\u0007", "// c", ";"];
function boundaries(s: string): number[] {
  const b = [0]; let n = 0; for (const c of s) { n += enc.encode(c).length; b.push(n); } return b;
}
function addCase(src: string, line_start: number, nann: number, npatch: number, fold: boolean) {
  const bs = boundaries(src);
  const len = bs[bs.length - 1]!;
  const pos = () => (rnd() < 0.05 ? len + 1 : rnd() < 0.02 ? len + 3 : pick(bs));
  out.push(`source ${hex(src)} ${line_start}`);
  for (let i = 0; i < nann; i++) {
    let a = pos(), b = pos(); if (a > b && rnd() < 0.9) [a, b] = [b, a];
    const label = rnd() < 0.3 ? "~" : hex(pick(["", "label", "expected `u8`", "日本"]));
    out.push(`ann ${pick(["P", "P", "C", "C", "V"])} ${a} ${b} ${label} ${rnd() < 0.2 ? 1 : 0}`);
  }
  for (let i = 0; i < npatch; i++) {
    let a = pick(bs), b = pick(bs); if (a > b) [a, b] = [b, a];
    if (rnd() < 0.03) b = len + 2;
    const orig = Buffer.from(enc.encode(src).slice(a, b)).toString("utf8");
    const rep = pick(["", "x", "foo", " ", "\n", "a\nb", "\tz\n", orig + "y", "y" + orig, orig.slice(0, 1) + "Q" + orig.slice(1), "日", orig]);
    out.push(`patch ${a} ${b} ${hex(rep)}`);
  }
  for (let i = 0; i < 4; i++) { let a = pick(bs), b = pick(bs); if (a > b && rnd() < 0.9) [a, b] = [b, a]; out.push(`span ${a} ${b}`); }
  out.push(`run ${fold ? 1 : 0}`);
}
// hand cases
addCase("", 1, 1, 1, true);
addCase("fn main() {\n    let x = 1;\n}\n", 1, 3, 2, true);
addCase("foo(\n  bar,\n  baz\n);\n// c\n{\n}\nend", 5, 4, 2, false);
addCase("a\r\nb\r\nc", 1, 3, 2, true);
for (let i = 0; i < 400; i++) {
  let src = ""; const n = ri(25); for (let k = 0; k < n; k++) src += pick(toks);
  addCase(src, pick([0, 1, 1, 7]), ri(6), ri(4), rnd() < 0.7);
}
// multi-line heavy cases
for (let i = 0; i < 100; i++) {
  let src = ""; const n = 3 + ri(10); for (let k = 0; k < n; k++) src += pick(["fn x() {", "  a,", "", "  // c", "}", "(", "  b", "///d", "\t\tq"]) + pick(["\n", "\n", "\r\n"]);
  addCase(src, 1, 2 + ri(6), ri(3), rnd() < 0.5);
}
for (const [a, b] of [["abc", "abcde"], ["abc", "xabc"], ["AACC", "AABBCC"], ["abc", "abx"], ["", "x"], ["日本", "日x本"], ["é", "e"], ["aa", "a"]]) out.push(`substr ${hex(a!)} ${hex(b!)}`);
for (let i = 0; i < 300; i++) {
  const v = [ri(200), ri(300), ri(400), ri(500), pick([10, 40, 80, 140]), ri(600), ri(700)];
  out.push(`margin ${v.join(" ")}`);
}
const styles = ["NoStyle", "Quotation", "LineNumber", "UnderlinePrimary", "LabelSecondary", "Addition"];
for (let i = 0; i < 60; i++) {
  out.push("sbnew");
  const n = 1 + ri(12);
  for (let k = 0; k < n; k++) {
    const op = ri(6);
    const text = pick(["a", "bc", "日x", "", "  ", "|", "😀z"]);
    if (op === 0) out.push(`putc ${ri(4)} ${ri(8)} ${hex(pick(["a", "日", "^", "😀"]))} ${pick(styles)}`);
    else if (op === 1) out.push(`puts ${ri(4)} ${ri(8)} ${hex(text)} ${pick(styles)}`);
    else if (op === 2) out.push(`append ${ri(5)} ${hex(text)} ${pick(styles)}`);
    else if (op === 3) out.push(`prepend ${ri(5)} ${hex(text)} ${pick(styles)}`);
    else if (op === 4) out.push(`replace ${ri(3)} ${ri(6)} ${ri(6)} ${hex(text)}`);
    else out.push(`setstyle ${ri(4)} ${ri(5)} ${ri(9)} ${pick(styles)} ${ri(2)}`);
  }
  out.push("sbdump");
}
console.log(out.join("\n"));
