// The C++ function definitions of a source file, for the markers that point at C++ (lane scope-m7, review plan-m7 F6):
// `// llvm: <path>:<line> <name>` (the LLVM sources of harness/llvm-manifest.json) and
// `// rustc: compiler/rustc_llvm/llvm-wrapper/<file>:<line> <name>` (rustc's C++ wrappers, in the checkout at the pin).
// The `// rustc:` finder (scripts/coverage.ts `upstreamFns`) lexes Rust; this is its C++ counterpart. No import of common.ts.
//
// What counts as a definition: a `<name>(<params>) <qualifiers> {` whose `{` opens at namespace, `extern "C" {` or class /
// struct / union scope (so not a lambda, a control-flow block or anything inside a function body), where `<qualifiers>` is
// empty or `const`, `noexcept`, `override`, `final`, `&`, `&&`, `volatile`, `try`, or starts a trailing return type (`->`)
// or a constructor's initializer list (`:`). `<name>` is the name as written, qualified (`ConstantInt::get`,
// `IRBuilderBase::CreateCall`, `~Foo`, `operator==`), and its line is the line of the name's last segment.
// Comments, strings, character and raw string literals are skipped; preprocessor lines are skipped, and the branches of an
// `#if` / `#elif` / `#else` chain are each read from the state at the `#if` (ctags' rule), so alternative headers of one
// definition do not unbalance the braces and each branch's definitions are found (both lines are then valid for a marker).
// Not handled (none in the files read today): a macro that expands to a definition, `template<...>` arguments that hold a
// `(`, K&R definitions.

export interface CppFn {
  path: string;
  line: number;
  /** As written: `LLVMBuildAdd`, `ConstantInt::get`, `IRBuilderBase::~IRBuilderBase`, `operator==`. */
  name: string;
}

interface Tok {
  t: string;
  k: "id" | "str" | "num" | "p";
  line: number;
}

const NOT_A_NAME = new Set([
  "if", "for", "while", "switch", "return", "sizeof", "alignof", "decltype", "alignas", "__attribute__", "__declspec",
  "static_assert", "catch", "new", "delete", "case", "typeid", "noexcept", "throw", "defined", "co_return", "co_await",
]);
const SUFFIX_OK = new Set(["const", "noexcept", "override", "final", "&", "&&", "volatile"]);

const isId = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || (c >= 0x30 && c <= 0x39) || c === 0x24;
const isIdStart = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f || c === 0x24;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

/** Index of the `)` matching the `(` at `i`, or -1. */
function closeParen(toks: readonly Tok[], i: number): number {
  let d = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j]!.t === "(") d++;
    else if (toks[j]!.t === ")" && --d === 0) return j;
  }
  return -1;
}

/** The qualified name ending at token `end` (the token before the `(`), as written, or undefined if it is no name. */
function nameBefore(toks: readonly Tok[], end: number): { name: string; line: number } | undefined {
  let i = end;
  let last: Tok;
  let name: string;
  // `operator==`, `operator()`, `operator[]`, `operator new`, `operator bool`.
  const op = (() => {
    for (let j = end; j >= 0 && j >= end - 3; j--) if (toks[j]!.t === "operator") return j;
    return -1;
  })();
  if (op >= 0 && toks.slice(op + 1, end + 1).every((t) => t.k === "p" || t.k === "id")) {
    name = `operator${toks.slice(op + 1, end + 1).map((t) => (t.k === "id" ? ` ${t.t}` : t.t)).join("")}`;
    last = toks[op]!;
    i = op - 1;
  } else {
    const t = toks[end];
    if (t === undefined || t.k !== "id" || NOT_A_NAME.has(t.t)) return undefined;
    name = t.t;
    last = t;
    i = end - 1;
    if (toks[i]?.t === "~") {
      name = `~${name}`;
      i--;
    }
  }
  // Qualifiers: `A::B<T>::name`.
  while (toks[i]?.t === "::") {
    let j = i - 1;
    let tmpl = "";
    if (toks[j]?.t === ">") {
      let d = 0;
      const k0 = j;
      for (; j >= 0; j--) {
        if (toks[j]!.t === ">") d++;
        else if (toks[j]!.t === "<" && --d === 0) break;
      }
      if (j < 0) break;
      tmpl = toks.slice(j, k0 + 1).map((t) => t.t).join("");
      j--;
    }
    const q = toks[j];
    if (q === undefined || q.k !== "id") break;
    name = `${q.t}${tmpl}::${name}`;
    i = j - 1;
  }
  return { name, line: last.line };
}

/** The definition a `{` at namespace / class scope opens, given the tokens since the last `;`, `{` or `}` there. */
function fnOf(toks: readonly Tok[]): { name: string; line: number } | undefined {
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!.t;
    if (t === ")") depth--;
    if (t !== "(") continue;
    if (depth++ !== 0) continue;
    const close = closeParen(toks, i);
    if (close < 0) return undefined;
    const name = i > 0 ? nameBefore(toks, i - 1) : undefined;
    if (name !== undefined && suffixOk(toks.slice(close + 1))) return name;
    // Not this one (a macro call before the declaration, `decltype(...)` in the return type): look further on.
    i = close;
    depth = 0;
  }
  return undefined;
}

function suffixOk(rest: readonly Tok[]): boolean {
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!.t;
    if (t === "->" || t === ":" || t === "try") return true;
    if (t === "noexcept" && rest[i + 1]?.t === "(") {
      const c = closeParen(rest, i + 1);
      if (c < 0) return false;
      i = c;
      continue;
    }
    if (t === "throw" && rest[i + 1]?.t === "(") {
      const c = closeParen(rest, i + 1);
      if (c < 0) return false;
      i = c;
      continue;
    }
    if (!SUFFIX_OK.has(t)) return false;
  }
  return true;
}

type Brace = "container" | "fn" | "other";

function classify(toks: readonly Tok[]): { kind: Brace; fn?: { name: string; line: number } } {
  const fn = fnOf(toks);
  if (fn) return { kind: "fn", fn };
  if (toks.some((t) => t.t === "namespace")) return { kind: "container" };
  if (toks.length === 2 && toks[0]!.t === "extern" && toks[1]!.k === "str") return { kind: "container" };
  if (toks.some((t) => t.t === "class" || t.t === "struct" || t.t === "union") && !toks.some((t) => t.t === "=" || t.t === "enum")) return { kind: "container" };
  return { kind: "other" };
}

/** Every C++ function definition of `text`; `path` is copied into each result. */
export function cppFns(text: string, path: string): CppFn[] {
  const out: CppFn[] = [];
  let stack: Brace[] = [];
  let buf: Tok[] = [];
  // `#if` chains: the state at the `#if`, and the state at the end of its first branch once an `#elif` / `#else` is seen.
  const conds: { at: { stack: Brace[]; buf: Tok[] }; end?: { stack: Brace[]; buf: Tok[] } }[] = [];
  const atTop = () => stack.every((b) => b === "container");
  const n = text.length;
  let i = 0;
  let line = 1;
  let lineStart = true;
  // Open parens in `buf`: braces inside them are a default argument or brace-init (`ArrayRef<T> Ops = {}`), not a block.
  const parens = () => buf.reduce((d, t) => d + (t.t === "(" ? 1 : t.t === ")" ? -1 : 0), 0);
  const push = (tok: Tok) => {
    if (!atTop()) {
      if (tok.t === "{") stack.push("other");
      else if (tok.t === "}") {
        stack.pop();
        if (atTop()) buf = [];
      }
      return;
    }
    if ((tok.t === "{" || tok.t === "}" || tok.t === ";") && parens() > 0) buf.push(tok);
    else if (tok.t === ";") buf = [];
    else if (tok.t === "{") {
      const c = classify(buf);
      if (c.fn) out.push({ path, line: c.fn.line, name: c.fn.name });
      stack.push(c.kind);
      buf = [];
    } else if (tok.t === "}") {
      stack.pop();
      buf = [];
    } else buf.push(tok);
  };
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) {
      line++;
      i++;
      lineStart = true;
      continue;
    }
    if (c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0c || c === 0x0b) {
      i++;
      continue;
    }
    // Preprocessor directive, with `\` continuations.
    if (lineStart && c === 0x23) {
      let j = i;
      let d = "";
      while (j < n) {
        const cj = text.charCodeAt(j);
        if (cj === 0x5c && text.charCodeAt(j + 1) === 0x0a) {
          j += 2;
          line++;
          continue;
        }
        if (cj === 0x5c && text.charCodeAt(j + 1) === 0x0d && text.charCodeAt(j + 2) === 0x0a) {
          j += 3;
          line++;
          continue;
        }
        if (cj === 0x0a) break;
        // A comment that starts on the directive line may run past it.
        if (cj === 0x2f && text.charCodeAt(j + 1) === 0x2a) {
          const e = text.indexOf("*/", j + 2);
          const stop = e < 0 ? n : e + 2;
          for (let k = j; k < stop; k++) if (text.charCodeAt(k) === 0x0a) line++;
          j = stop;
          continue;
        }
        d += text[j];
        j++;
      }
      const dir = /^#\s*(\w+)/.exec(d)?.[1] ?? "";
      const snap = () => ({ stack: [...stack], buf: [...buf] });
      if (dir === "if" || dir === "ifdef" || dir === "ifndef") conds.push({ at: snap() });
      else if (dir === "elif" || dir === "else" || dir === "elifdef" || dir === "elifndef") {
        const top = conds[conds.length - 1];
        if (top) {
          top.end ??= snap();
          stack = [...top.at.stack];
          buf = [...top.at.buf];
        }
      } else if (dir === "endif") {
        const top = conds.pop();
        if (top?.end) {
          stack = [...top.end.stack];
          buf = [...top.end.buf];
        }
      }
      i = j;
      continue;
    }
    lineStart = false;
    // Comments.
    if (c === 0x2f && text.charCodeAt(i + 1) === 0x2f) {
      while (i < n && text.charCodeAt(i) !== 0x0a) i++;
      continue;
    }
    if (c === 0x2f && text.charCodeAt(i + 1) === 0x2a) {
      const e = text.indexOf("*/", i + 2);
      const stop = e < 0 ? n : e + 2;
      for (let k = i; k < stop; k++) if (text.charCodeAt(k) === 0x0a) line++;
      i = stop;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isId(text.charCodeAt(j))) j++;
      const id = text.slice(i, j);
      // Raw string: `R"delim( ... )delim"`, also with an encoding prefix.
      if (text.charCodeAt(j) === 0x22 && /^(?:u8|u|U|L)?R$/.test(id)) {
        const open = text.indexOf("(", j + 1);
        const delim = text.slice(j + 1, open);
        const close = text.indexOf(`)${delim}"`, open + 1);
        const stop = close < 0 ? n : close + delim.length + 2;
        const start = line;
        for (let k = i; k < stop; k++) if (text.charCodeAt(k) === 0x0a) line++;
        push({ t: "R\"\"", k: "str", line: start });
        i = stop;
        continue;
      }
      // An encoding prefix of an ordinary string or character literal.
      if ((text.charCodeAt(j) === 0x22 || text.charCodeAt(j) === 0x27) && /^(?:u8|u|U|L)$/.test(id)) {
        i = j;
        continue;
      }
      push({ t: id, k: "id", line });
      i = j;
      continue;
    }
    if (isDigit(c) || (c === 0x2e && isDigit(text.charCodeAt(i + 1)))) {
      let j = i + 1;
      // Digit separators (`1'000`) and exponents with a sign (`1e-5`).
      while (j < n) {
        const cj = text.charCodeAt(j);
        if (isId(cj) || cj === 0x2e || (cj === 0x27 && isId(text.charCodeAt(j + 1)))) j++;
        else if ((cj === 0x2b || cj === 0x2d) && /[eEpP]/.test(text[j - 1]!)) j++;
        else break;
      }
      push({ t: text.slice(i, j), k: "num", line });
      i = j;
      continue;
    }
    if (c === 0x22 || c === 0x27) {
      let j = i + 1;
      const start = line;
      while (j < n && text.charCodeAt(j) !== c) {
        if (text.charCodeAt(j) === 0x5c) j++;
        if (text.charCodeAt(j) === 0x0a) line++;
        j++;
      }
      push({ t: c === 0x22 ? '""' : "''", k: "str", line: start });
      i = j + 1;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === "::" || two === "->" || two === "&&") {
      push({ t: two, k: "p", line });
      i += 2;
      continue;
    }
    push({ t: text[i]!, k: "p", line });
    i++;
  }
  return out;
}

/** Whether marker name `name` names `fn`: its name as written (`ConstantInt::get`) or the last segment of it (`get`). */
export function cppNameMatches(fn: CppFn, name: string): boolean {
  if (fn.name === name) return true;
  const k = fn.name.lastIndexOf("::");
  return k >= 0 && fn.name.slice(k + 2) === name;
}
