// rust-ts: plays a script of recorded LLVM C API calls (record.ts) against the model through ffi.ts, the way the ported codegen
// will call it (lane llir-core-a). Tests only.
//
// Every recorded answer is checked as it is replayed: a returned handle that the script saw before must be the same model
// object (types and constants are uniqued, as in LLVM); a returned integer, boolean, enum or string must equal the oracle's. The
// first disagreement throws, naming the script line. Calls to functions the model leaves to another lane are skipped when
// nothing later uses their result; a later use of such a result throws, naming the function.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as L from "./ffi.ts";
import * as T from "./ffi_types.ts";
import { FFI_PATH, type FfiFn, type FfiItems, parseFfi, tsType } from "./ffi_gen.ts";
import { rustAttributeKindOf } from "./core.ts";
import { Function as IrFunction, Module } from "./ir.ts";

type Arg = { k: "h"; id: number } | { k: "null" } | { k: "int"; v: bigint } | { k: "dbl"; bits: bigint } | { k: "str"; b: Uint8Array } | { k: "arr"; items: Arg[] } | { k: "skip" };

/** One recorded call, parsed. */
export interface Call {
  line: number;
  thread: number;
  text: string;
  /** `?global`, `?triple`, `?flag`, or the C function. */
  fn: string;
  args: Arg[];
  ret: Arg | undefined;
  retStr: Uint8Array | undefined;
}

function parseString(s: string, i: number): [Uint8Array, number] {
  const out: number[] = [];
  i++; // opening quote
  while (s[i] !== '"') {
    if (s[i] === "\\") {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 3;
    } else out.push(s.charCodeAt(i++));
  }
  return [new Uint8Array(out), i + 1];
}

function parseArg(s: string, i: number): [Arg, number] {
  if (s[i] === '"') {
    const [b, j] = parseString(s, i);
    return [{ k: "str", b }, j];
  }
  if (s[i] === "[") {
    const items: Arg[] = [];
    i++;
    while (s[i] !== "]") {
      const [a, j] = parseArg(s, i);
      items.push(a);
      i = s.startsWith(", ", j) ? j + 2 : j;
    }
    return [{ k: "arr", items }, i + 1];
  }
  const m = /^(%\d+|null|d0x[0-9A-F]+|-?\d+|\?)/.exec(s.slice(i))!;
  const t = m[1]!;
  const j = i + t.length;
  if (t.startsWith("%")) return [{ k: "h", id: Number(t.slice(1)) }, j];
  if (t === "null") return [{ k: "null" }, j];
  if (t === "?") return [{ k: "skip" }, j];
  if (t.startsWith("d0x")) return [{ k: "dbl", bits: BigInt(`0x${t.slice(3)}`) }, j];
  return [{ k: "int", v: BigInt(t) }, j];
}

/** Space-separated arguments (inferred lines). */
function parseWords(s: string): Arg[] {
  const out: Arg[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === " ") {
      i++;
      continue;
    }
    // A bare word (`i`, `s`, `type`, `str`, an attribute name): a string argument.
    const w = /^[a-z_][a-z_0-9]*/.exec(s.slice(i));
    if (w !== null && (s[i + w[0].length] === " " || i + w[0].length === s.length)) {
      out.push({ k: "str", b: new TextEncoder().encode(w[0]) });
      i += w[0].length;
      continue;
    }
    const [a, j] = parseArg(s, i);
    out.push(a);
    i = j;
  }
  return out;
}

export function parseScript(text: string): Call[] {
  const calls: Call[] = [];
  text.split("\n").forEach((row, n) => {
    if (row === "") return;
    const tab = row.indexOf("\t");
    const thread = Number(row.slice(0, tab));
    const body = row.slice(tab + 1);
    const base = { line: n + 1, thread, text: body };
    if (body.startsWith("?")) {
      const sp = body.indexOf(" ");
      calls.push({ ...base, fn: body.slice(0, sp), args: parseWords(body.slice(sp + 1)), ret: undefined, retStr: undefined });
      return;
    }
    let i = 0;
    let ret: Arg | undefined;
    const eq = /^(%\d+|null|-?\d+) = /.exec(body);
    if (eq) {
      ret = parseArg(body, 0)[0];
      i = eq[0].length;
    }
    const open = body.indexOf("(", i);
    const fn = body.slice(i, open);
    const args: Arg[] = [];
    i = open + 1;
    while (body[i] !== ")") {
      const [a, j] = parseArg(body, i);
      args.push(a);
      i = body.startsWith(", ", j) ? j + 2 : j;
    }
    let retStr: Uint8Array | undefined;
    if (body.startsWith(" -> ", i + 1)) retStr = body.startsWith('"', i + 5) ? parseString(body, i + 5)[0] : undefined;
    calls.push({ ...base, fn, args, ret, retStr });
  });
  return calls;
}

/** The calls of the thread that creates the first module (the one that builds it), from that thread's first call. */
export function buildingThread(calls: readonly Call[]): Call[] {
  const first = calls.find((c) => c.fn === "LLVMModuleCreateWithNameInContext");
  return first === undefined ? [] : calls.filter((c) => c.thread === first.thread);
}

const SKIPPED = Symbol("skipped");

export interface ReplayResult {
  modules: Module[];
  /** Calls replayed, calls skipped (another lane's), inferred lines applied. */
  replayed: number;
  skipped: Map<string, number>;
  inferred: number;
}

/** Plays `calls` through ffi.ts. Throws on the first answer that differs from the oracle's. */
export function replay(calls: readonly Call[], upstream: string): ReplayResult {
  const items: FfiItems = parseFfi(readFileSync(join(upstream, FFI_PATH), "utf8"));
  const sig = new Map<string, FfiFn>(items.fns.map((f) => [f.name, f]));
  const enumNames = new Set(items.enums.map((e) => e.name));
  const env = new Map<number, unknown>();
  const skippedBy = new Map<number, string>();
  const res: ReplayResult = { modules: [], replayed: 0, skipped: new Map(), inferred: 0 };
  const lib = L as unknown as Record<string, (...a: unknown[]) => unknown>;
  const where = (c: Call): string => `script line ${c.line}: ${c.text.slice(0, 200)}`;

  const handle = (c: Call, a: Arg): unknown => {
    if (a.k === "null") return undefined;
    if (a.k !== "h") throw new Error(`replay: expected a handle at ${where(c)}`);
    if (!env.has(a.id)) {
      if (skippedBy.has(a.id)) throw new Error(`replay: needs %${a.id} from ${skippedBy.get(a.id)}, which llir-core-a does not implement (${where(c)})`);
      throw new Error(`replay: %${a.id} was never defined (made by an unrecorded LLVMRust* wrapper?) at ${where(c)}`);
    }
    const v = env.get(a.id);
    if (v === SKIPPED) throw new Error(`replay: needs %${a.id} from ${skippedBy.get(a.id)}, which llir-core-a does not implement (${where(c)})`);
    return v;
  };
  const bytes = (a: Arg): Uint8Array => (a.k === "str" ? a.b : new Uint8Array());
  const convert = (c: Call, a: Arg, ts: string): unknown => {
    if (a.k === "skip") return ts.startsWith("MutRef<") ? { value: ts.includes("bigint") ? 0n : 0 } : undefined;
    if (ts === "Bool") return L.Bool.of(Number((a as { v: bigint }).v));
    if (ts === "number") return a.k === "dbl" ? new DataView(new BigUint64Array([a.bits]).buffer).getFloat64(0, true) : Number((a as { v: bigint }).v);
    if (ts === "bigint") return (a as { v: bigint }).v;
    if (ts === "boolean") return (a as { v: bigint }).v !== 0n;
    if (ts === "MetadataKindId") return Number((a as { v: bigint }).v);
    if (ts === "PtrLenStr" || ts === "Uint8Array") return bytes(a);
    if (ts === "string") return new TextDecoder().decode(bytes(a));
    if (enumNames.has(ts)) {
      const table = (T as unknown as Record<string, Record<string, number>>)[`${ts}_discriminant`]!;
      const n = Number((a as { v: bigint }).v);
      const name = Object.keys(table).find((k) => table[k] === n);
      if (name === undefined) throw new Error(`replay: ${ts} has no variant ${n} (${where(c)})`);
      return name;
    }
    if (ts.startsWith("readonly ") && ts.endsWith("[]") && a.k === "arr") {
      const elem = ts.slice(9, -2).replace(/^\((.*)\)$/, "$1");
      return a.items.map((x) => convert(c, x, elem));
    }
    if (ts.startsWith("MutRef<")) return { value: ts.includes("bigint") ? 0n : 0 };
    // A handle type (`Value`, `Type | undefined`, ...).
    return handle(c, a);
  };
  const answerOf = (r: unknown): bigint | undefined => {
    if (typeof r === "number") return BigInt(r);
    if (typeof r === "bigint") return r;
    if (typeof r === "boolean") return r ? 1n : 0n;
    if (r instanceof L.Bool) return BigInt(r.value);
    if (r instanceof L.RawEnum) return BigInt(r.value);
    if (typeof r === "string") {
      // An enum returned as its variant name (`LLVMGetConstOpcode`).
      return undefined;
    }
    return undefined;
  };

  /** The creator call that makes the attribute a `?attr` line describes (the wrapper rustc called is not recorded). */
  const inferAttribute = (c: Call): L.Attribute => {
    const [, kindArg, a, b] = c.args as [Arg, Arg, Arg | undefined, Arg | undefined];
    const kind = new TextDecoder().decode(bytes(kindArg));
    const C = (res.modules[0] ?? [...env.values()].find((v) => v instanceof Module)) as Module | undefined;
    if (C === undefined) throw new Error(`replay: an attribute before any module at ${where(c)}`);
    const ctx = C.context;
    const n = a?.k === "int" ? a.v : undefined;
    if (kind === "str") return L.LLVMCreateStringAttribute(ctx, bytes(a!), bytes(a!).length, bytes(b!), bytes(b!).length);
    if (a?.k === "str" && new TextDecoder().decode(a.b) === "type") {
      const ty = handle(c, b!) as L.Type;
      const make = { byval: L.LLVMRustCreateByValAttr, byref: L.LLVMRustCreateByRefAttr, sret: L.LLVMRustCreateStructRetAttr, elementtype: L.LLVMRustCreateElementTypeAttr }[kind];
      if (make === undefined) throw new Error(`replay: cannot recreate type attribute ${kind} (${where(c)})`);
      return make(ctx, ty);
    }
    if (kind === "align") return L.LLVMRustCreateAlignmentAttr(ctx, Number(n));
    if (kind === "dereferenceable") return L.LLVMRustCreateDereferenceableAttr(ctx, Number(n));
    if (kind === "dereferenceable_or_null") return L.LLVMRustCreateDereferenceableOrNullAttr(ctx, Number(n));
    // `UWTableKind` (ffi.rs: must match llvm::UWTableKind): Sync 1, Async 2.
    if (kind === "uwtable" && (n === 1n || n === 2n)) return L.LLVMRustCreateUWTableAttr(ctx, n === 2n);
    const rust = rustAttributeKindOf(kind);
    if (rust !== undefined && n === 0n) return L.LLVMRustCreateAttrNoValue(ctx, rust);
    throw new Error(`replay: cannot recreate attribute ${kind}${n === undefined ? "" : ` ${n}`} (${where(c)})`);
  };

  for (const c of calls) {
    if (c.fn === "?global") {
      const [g, name, ty, m] = c.args as [Arg, Arg, Arg, Arg];
      if (ty.k === "skip") throw new Error(`replay: a global of an unrecorded type at ${where(c)}`);
      const nb = bytes(name);
      const v = L.LLVMRustGetOrInsertGlobal(handle(c, m) as L.Module, nb, nb.length, handle(c, ty) as L.Type);
      const got = new TextEncoder().encode(v.name === "" ? "" : Buffer.from(v.name, "latin1").toString("utf8"));
      if (Buffer.compare(Buffer.from(got), Buffer.from(nb)) !== 0) throw new Error(`replay: global named ${v.name}, the oracle's is ${new TextDecoder().decode(nb)} (${where(c)})`);
      env.set((g as { id: number }).id, v);
      res.inferred++;
      continue;
    }
    if (c.fn === "?attr") {
      env.set((c.args[0] as { id: number }).id, inferAttribute(c));
      res.inferred++;
      continue;
    }
    if (c.fn === "?attrs") {
      const f = handle(c, c.args[0]!) as IrFunction;
      const list = (c.args[2] as { items: Arg[] }).items.map((a) => handle(c, a) as L.Attribute);
      L.LLVMRustAddFunctionAttributes(f, Number((c.args[1] as { v: bigint }).v), list, list.length);
      res.inferred++;
      continue;
    }
    if (c.fn === "?datalayout") {
      // The effect of `LLVMRustSetDataLayoutFromTargetMachine` (a driver wrapper the model leaves to the driver lanes): the
      // module's layout string, which is all `Module::setDataLayout` keeps.
      L.LLVMSetDataLayout(handle(c, c.args[0]!) as L.Module, new TextDecoder().decode(bytes(c.args[1]!)));
      res.inferred++;
      continue;
    }
    if (c.fn === "?triple") {
      L.LLVMRustSetNormalizedTarget(handle(c, c.args[0]!) as L.Module, new TextDecoder().decode(bytes(c.args[1]!)));
      res.inferred++;
      continue;
    }
    if (c.fn === "?flag") {
      const [m, b, key, kind, val] = c.args as [Arg, Arg, Arg, Arg, Arg];
      const behavior = convert(c, b, "ModuleFlagMergeBehavior") as T.ModuleFlagMergeBehavior;
      const kb = bytes(key);
      const kindText = new TextDecoder().decode(bytes(kind));
      if (kindText === "i") L.LLVMRustAddModuleFlagU32(handle(c, m) as L.Module, behavior, kb, kb.length, Number((val as { v: bigint }).v));
      else if (kindText === "s") L.LLVMRustAddModuleFlagString(handle(c, m) as L.Module, behavior, kb, kb.length, bytes(val), bytes(val).length);
      else throw new Error(`replay: a module flag whose value the recorder could not read at ${where(c)}`);
      res.inferred++;
      continue;
    }
    const f = sig.get(c.fn);
    if (f === undefined) throw new Error(`replay: ${c.fn} is not an ffi.rs function (${where(c)})`);
    // A function no lane has implemented yet: skip it, and remember what it would have returned.
    if (L.IMPLEMENTED.has(c.fn) === false) {
      res.skipped.set(c.fn, (res.skipped.get(c.fn) ?? 0) + 1);
      if (c.ret?.k === "h" && !env.has(c.ret.id)) {
        env.set(c.ret.id, SKIPPED);
        skippedBy.set(c.ret.id, c.fn);
      }
      continue;
    }
    const args = f.params.map((p, i) => convert(c, c.args[i] ?? { k: "skip" }, tsType(p.rust, p.name, items, false)));
    const r = lib[c.fn]!(...args);
    res.replayed++;
    if (r instanceof Module && !res.modules.includes(r)) res.modules.push(r);
    // Check the answer.
    if (c.ret?.k === "h") {
      if (env.has(c.ret.id) && env.get(c.ret.id) !== SKIPPED) {
        if (env.get(c.ret.id) !== r) throw new Error(`replay: returned a different object than the oracle's %${c.ret.id} (uniquing) at ${where(c)}`);
      } else env.set(c.ret.id, r);
    } else if (c.ret?.k === "null") {
      if (r !== undefined) throw new Error(`replay: returned a value where the oracle returned null at ${where(c)}`);
    } else if (c.ret?.k === "int") {
      const got = answerOf(r);
      if (got !== c.ret.v) throw new Error(`replay: answered ${got}, the oracle ${c.ret.v}, at ${where(c)}`);
    }
    if (c.retStr !== undefined) {
      const got = Buffer.from(String(r ?? ""), "utf8");
      if (Buffer.compare(got, Buffer.from(c.retStr)) !== 0) throw new Error(`replay: answered ${JSON.stringify(String(r))}, the oracle ${JSON.stringify(new TextDecoder().decode(c.retStr))}, at ${where(c)}`);
    }
  }
  return res;
}
