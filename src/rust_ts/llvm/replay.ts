// rust-ts: plays a script of recorded LLVM C API calls (record.ts) against the model through ffi.ts, the way the ported codegen
// will call it (lane llir-core-a). Tests only.
//
// Every recorded answer is checked as it is replayed. Handles and model objects must correspond one to one: a handle the script
// saw before must come back as the same object (types, constants and attributes are uniqued, as in LLVM), and an object the
// model returned before must not come back for a new handle (over-uniquing). A returned integer, boolean, enum or string, and
// every out-parameter the recorder logged (`&<value>`), must equal the oracle's. The first disagreement throws, naming the
// script line. Calls to functions the model leaves to another lane are skipped when nothing later uses their result; a later
// use of such a result throws, naming the function.
//
// Each inferred line (record.ts) is replayed as a call of **the wrapper that produces that effect in rustc** at the pin, from a
// table of rustc's call sites below; an effect no call site of rustc produces throws. A wrapper the model leaves to another
// lane (`LLVMRustSetDataLayoutFromTargetMachine`) has its effect applied to the model directly and is listed in
// `ReplayResult.stubbedEffects`, so a proof can assert which those are.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as L from "./ffi.ts";
import * as T from "./ffi_types.ts";
import { FFI_PATH, type FfiFn, type FfiItems, parseFfi, tsType } from "../../../tools/llir/ffi_gen.ts";
import { rustAttributeKindOf } from "./core.ts";
import { BasicBlock, IRBuilder, Inst } from "./inst.ts";
import { Attribute, Constant, ConstantInt, Function as IrFunction, Module, stringOfBstr } from "./ir.ts";

type Arg =
  | { k: "h"; id: number }
  | { k: "null" }
  | { k: "int"; v: bigint }
  | { k: "dbl"; bits: bigint }
  | { k: "str"; b: Uint8Array }
  | { k: "arr"; items: Arg[] }
  | { k: "skip" }
  /** An integer constant no recorded call made (`#<value>`, in `?inst` lines). */
  | { k: "cint"; v: bigint }
  /** An out-parameter's value after the call (`&<value>`). */
  | { k: "out"; v: Arg };

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
  /** Where a builder put the instruction it returned (` @ %BB <next or end>`). */
  at?: { bb: Arg; next: Arg | undefined };
  /** `?inst`'s call-site attributes, by index. */
  attrs?: Map<number, Arg[]>;
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
  if (s[i] === "&") {
    const [v, j] = parseArg(s, i + 1);
    return [{ k: "out", v }, j];
  }
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
  if (s[i] === "#") {
    const d = /^#(\d+)/.exec(s.slice(i))!;
    return [{ k: "cint", v: BigInt(d[1]!) }, i + d[0].length];
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
    if (body.startsWith("?inst ")) {
      // `?inst %I %BB <next|end> <opcode> [operands] {<index>:[attributes] ...}`.
      const m = /^\?inst (%\d+) (%\d+) (%\d+|end) (\d+) (\[.*?\])(?: \{(.*)\})?$/.exec(body);
      if (m === null) throw new Error(`replay: malformed ?inst at script line ${n + 1}`);
      const h = (t: string): Arg => parseArg(t, 0)[0];
      const attrs = new Map<number, Arg[]>();
      for (const g of (m[6] ?? "").matchAll(/(\d+):(\[[^\]]*\])/g)) attrs.set(Number(g[1]), (parseArg(g[2]!, 0)[0] as { items: Arg[] }).items);
      const args = [h(m[1]!), h(m[2]!), m[3] === "end" ? { k: "null" as const } : h(m[3]!), { k: "int" as const, v: BigInt(m[4]!) }, parseArg(m[5]!, 0)[0]];
      calls.push({ ...base, fn: "?inst", args, ret: undefined, retStr: undefined, attrs });
      return;
    }
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
    let at: Call["at"];
    if (body.startsWith(" @ ", i + 1)) {
      const [bb, j] = parseArg(body, i + 4);
      const next = body.startsWith(" end", j) ? undefined : parseArg(body, j + 1)[0];
      at = { bb, next };
    }
    if (body.startsWith(" -> ", i + 1)) retStr = body.startsWith('"', i + 5) ? parseString(body, i + 5)[0] : undefined;
    calls.push({ ...base, fn, args, ret, retStr, ...(at ? { at } : {}) });
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
  /** Inferred effects, by the rustc wrapper they are replayed as. */
  inferredBy: Map<string, number>;
  /** Inferred effects of wrappers the model leaves to another lane, applied to the model directly. */
  stubbedEffects: Map<string, number>;
  /** `?attrs` lines of an intrinsic declaration a hidden wrapper made in the same gap: `Intrinsic::getAttributes`, which the
   * model leaves to the parser (plan-m7 §1b; llir-core-a PORT decision 5), so they are counted, not applied. */
  intrinsicAttributeSets: number;
}

export interface ReplayOptions {
  /** Module flag keys that come from outside rustc's literal call sites: the case's `-Z llvm-module-flag=<key>:...` keys and the
   * target's small-data flag key (context.rs:593, :514). An integer flag matching no call site must be one of these (review R1). */
  flagKeys?: readonly string[];
}

// ---- which rustc wrapper produces each inferred effect (rustc_codegen_llvm at the pin) -------------------------------------

/** Module flags with a wrapper of their own: the flag `Module::set*` adds (Module.cpp), its behaviour and, for a fixed one,
 * its value. A flag of one of these keys that does not match is not that wrapper's (it would be `-Z llvm-module-flag`'s). */
const FLAG_WRAPPERS: Readonly<Record<string, { wrapper: string; behavior: T.ModuleFlagMergeBehavior; value?: bigint; site: string }>> = {
  // `setPICLevel(PICLevel::BigPIC)`: Min, 2 (PassWrapper.cpp:1202, Module.cpp:637, CodeGen.h:36).
  "PIC Level": { wrapper: "LLVMRustSetModulePICLevel", behavior: "Min", value: 2n, site: "context.rs:240" },
  // `setPIELevel(PIELevel::Large)`: Max, 2 (PassWrapper.cpp:1206, Module.cpp:653, CodeGen.h:40).
  "PIE Level": { wrapper: "LLVMRustSetModulePIELevel", behavior: "Max", value: 2n, site: "context.rs:248" },
  // `setCodeModel(CM)`: Error, the CodeModel::Model (PassWrapper.cpp:1210, Module.cpp:667). Absent for CodeModel::None.
  "Code Model": { wrapper: "LLVMRustSetModuleCodeModel", behavior: "Error", site: "context.rs:259" },
  // `setLargeDataThreshold(T)`: Error, an i64 (PassWrapper.cpp:1218, Module.cpp:685).
  "Large Data Threshold": { wrapper: "LLVMRustSetModuleLargeDataThreshold", behavior: "Error", site: "context.rs:264" },
};

/** `llvm::add_module_flag_u32` / `add_module_flag_str` call sites with a literal key: key -> behaviours (u32 or str). */
const FLAG_SITES: readonly [key: string, behavior: T.ModuleFlagMergeBehavior, kind: "u32" | "str", site: string][] = [
  ["RtLibUseGOT", "Warning", "u32", "context.rs:271"],
  ["CFI Canonical Jump Tables", "Override", "u32", "context.rs:276"],
  ["cfi-normalize-integers", "Override", "u32", "context.rs:287"],
  ["EnableSplitLTOUnit", "Override", "u32", "context.rs:298"],
  ["uwtable", "Max", "u32", "context.rs:314"],
  ["kcfi", "Override", "u32", "context.rs:327"],
  ["kcfi-offset", "Override", "u32", "context.rs:333"],
  ["kcfi-arity", "Override", "u32", "context.rs:344"],
  ["cfguard", "Warning", "u32", "context.rs:363"],
  ["cfguard", "Warning", "u32", "context.rs:372"],
  ["NumRegisterParameters", "Error", "u32", "context.rs:383"],
  ["branch-target-enforcement", "Min", "u32", "context.rs:393"],
  ["sign-return-address", "Min", "u32", "context.rs:399"],
  ["branch-protection-pauth-lr", "Min", "u32", "context.rs:410"],
  ["sign-return-address-all", "Min", "u32", "context.rs:416"],
  ["sign-return-address-with-bkey", "Min", "u32", "context.rs:422"],
  ["guarded-control-stack", "Min", "u32", "context.rs:428"],
  ["cf-protection-branch", "Override", "u32", "context.rs:444"],
  ["cf-protection-return", "Override", "u32", "context.rs:452"],
  ["Virtual Function Elim", "Error", "u32", "context.rs:461"],
  ["ehcontguard", "Warning", "u32", "context.rs:471"],
  ["function_return_thunk_extern", "Override", "u32", "context.rs:477"],
  ["frame-pointer", "Max", "u32", "context.rs:488"],
  ["indirect_branch_cs_prefix", "Override", "u32", "context.rs:501"],
  ["target-abi", "Error", "str", "context.rs:541"],
  ["float-abi", "Error", "str", "context.rs:552"],
  ["thread-model", "Error", "str", "context.rs:562"],
  ["exception-model", "Error", "str", "context.rs:570"],
  ["ptrauth-elf-got", "Error", "u32", "context.rs:770"],
  ["ptrauth-sign-personality", "Error", "u32", "context.rs:779"],
  ["aarch64-elf-pauthabi-platform", "Error", "u32", "context.rs:796"],
  ["aarch64-elf-pauthabi-version", "Error", "u32", "context.rs:802"],
  ["Objective-C Version", "Error", "u32", "context.rs:816"],
  ["Objective-C Image Info Version", "Error", "u32", "context.rs:823"],
  ["Objective-C Image Info Section", "Error", "str", "context.rs:830"],
  ["Objective-C Is Simulated", "Error", "u32", "context.rs:842"],
  ["Objective-C Class Properties", "Error", "u32", "context.rs:850"],
  ["Dwarf Version", "Max", "u32", "debuginfo/mod.rs:75"],
  ["CodeView", "Warning", "u32", "debuginfo/mod.rs:88"],
  ["Debug Info Version", "Warning", "u32", "debuginfo/mod.rs:98"],
  ["openmp", "Max", "u32", "builder/gpu_offload.rs:46"],
];
// Two more call sites take their key from elsewhere, both u32: the target's small-data flag (context.rs:514, Error) and
// `-Z llvm-module-flag=<key>:<u32>:<behaviour>` (context.rs:593, any behaviour). An integer flag matching nothing above is
// attributed to them; a string flag matching nothing above throws.

/** `CodeModel::Model`'s order (llvm/Support/CodeGen.h:31) -> ffi.rs's `CodeModel` of the same name (`fromRust`). */
const LLVM_CODE_MODELS: readonly T.CodeModel[] = ["Tiny", "Small", "Kernel", "Medium", "Large"];

/** Plays `calls` through ffi.ts. Throws on the first answer that differs from the oracle's. */
export function replay(calls: readonly Call[], upstream: string, opts: ReplayOptions = {}): ReplayResult {
  const items: FfiItems = parseFfi(readFileSync(join(upstream, FFI_PATH), "utf8"));
  const sig = new Map<string, FfiFn>(items.fns.map((f) => [f.name, f]));
  const enumNames = new Set(items.enums.map((e) => e.name));
  const flagNames = new Set(items.flags.map((f) => f.name));
  const env = new Map<number, unknown>();
  /** The reverse of `env` for objects: one handle per model object. */
  const ids = new Map<object, number>();
  const skippedBy = new Map<number, string>();
  const res: ReplayResult = { modules: [], replayed: 0, skipped: new Map(), inferred: 0, inferredBy: new Map(), stubbedEffects: new Map(), intrinsicAttributeSets: 0 };
  /** `?attr` lines not yet needed: an attribute is recreated (and its creator counted) when a later line uses it. */
  const pendingAttrs = new Map<number, Call>();
  /** `?function` lines of memory intrinsics, bound when the `?inst` of the hidden wrapper that declared them replays. */
  const pendingIntrinsics = new Map<number, { name: string; m: Module }>();
  const lib = L as unknown as Record<string, (...a: unknown[]) => unknown>;
  const where = (c: Call): string => `script line ${c.line}: ${c.text.slice(0, 200)}`;
  const count = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
  const inferred = (wrapper: string): void => {
    res.inferred++;
    count(res.inferredBy, wrapper);
  };

  /** Binds handle `id` to `v`, or checks it: handles and objects correspond one to one. */
  const bind = (c: Call, id: number, v: unknown): void => {
    const had = env.get(id);
    if (env.has(id) && had !== SKIPPED) {
      if (had === v) return;
      // LLVM frees a constant that `handleOperandChange` replaced (`destroyConstant`) and may reuse its address for a new one;
      // the handle then names the new object (review llir-core-a R6).
      if (!(had instanceof Constant && had.destroyed)) throw new Error(`replay: returned a different object than the oracle's %${id} (under-uniquing) at ${where(c)}`);
      ids.delete(had);
    }
    if (typeof v === "object" && v !== null) {
      const other = ids.get(v);
      if (other !== undefined && other !== id) throw new Error(`replay: returned the object of %${other} where the oracle returned a new handle %${id} (over-uniquing) at ${where(c)}`);
      ids.set(v, id);
    }
    env.set(id, v);
  };
  const handle = (c: Call, a: Arg): unknown => {
    if (a.k === "null") return undefined;
    if (a.k !== "h") throw new Error(`replay: expected a handle at ${where(c)}`);
    const pa = pendingAttrs.get(a.id);
    if (pa !== undefined && !env.has(a.id)) {
      pendingAttrs.delete(a.id);
      const [attr, wrapper] = inferAttribute(pa);
      bind(pa, a.id, attr);
      inferred(wrapper);
    }
    if (!env.has(a.id)) throw new Error(`replay: %${a.id} was never defined (made by an unrecorded LLVMRust* wrapper?) at ${where(c)}`);
    const v = env.get(a.id);
    if (v === SKIPPED) throw new Error(`replay: needs %${a.id} from ${skippedBy.get(a.id)}, which llir-core-a does not implement (${where(c)})`);
    return v;
  };
  const bytes = (a: Arg): Uint8Array => (a.k === "str" ? a.b : new Uint8Array());
  const intOf = (a: Arg): bigint => {
    if (a.k !== "int") throw new Error(`replay: expected an integer, got ${a.k}`);
    return a.v;
  };
  const convert = (c: Call, a: Arg, tsFull: string): unknown => {
    const nullable = tsFull.endsWith(" | undefined");
    const ts = nullable ? tsFull.slice(0, -" | undefined".length) : tsFull;
    if (a.k === "null") {
      if (!nullable) throw new Error(`replay: null passed where the contract has a non-null ${ts} (${where(c)})`);
      return undefined;
    }
    if (ts.startsWith("MutRef<")) return { value: ts.includes("bigint") ? 0n : ts.includes("number") ? 0 : undefined };
    if (a.k === "skip") return undefined;
    if (a.k === "out") return ts.endsWith("[]") ? [] : undefined;
    if (ts === "Bool") return L.Bool.of(Number(intOf(a)));
    if (ts === "number") return a.k === "dbl" ? new DataView(new BigUint64Array([a.bits]).buffer).getFloat64(0, true) : Number(intOf(a));
    if (ts === "bigint") return intOf(a);
    if (ts === "boolean") return intOf(a) !== 0n;
    if (ts === "MetadataKindId") return Number(intOf(a));
    // A bitflags type (`GEPNoWrapFlags`, ...): its bits.
    if (flagNames.has(ts)) return Number(intOf(a));
    if (ts === "PtrLenStr" || ts === "Uint8Array") return bytes(a);
    if (ts === "string") return new TextDecoder().decode(bytes(a));
    if (enumNames.has(ts)) {
      const table = (T as unknown as Record<string, Record<string, number>>)[`${ts}_discriminant`]!;
      const n = Number(intOf(a));
      const name = Object.keys(table).find((k) => table[k] === n);
      if (name === undefined) throw new Error(`replay: ${ts} has no variant ${n} (${where(c)})`);
      return name;
    }
    if (ts.startsWith("readonly ") && ts.endsWith("[]") && a.k === "arr") {
      const elem = ts.slice(9, -2).replace(/^\((.*)\)$/, "$1");
      return a.items.map((x) => convert(c, x, elem));
    }
    // A handle type (`Value`, `Type`, ...).
    return handle(c, a);
  };
  const answerOf = (r: unknown): bigint | undefined => {
    if (typeof r === "number") return BigInt(r);
    if (typeof r === "bigint") return r;
    if (typeof r === "boolean") return r ? 1n : 0n;
    if (r instanceof L.Bool) return BigInt(r.value);
    if (r instanceof L.RawEnum) return BigInt(r.value);
    return undefined;
  };
  /** Checks an out-parameter's value after the call against the recorded `&<value>`. */
  const checkOut = (c: Call, i: number, want: Arg, got: unknown): void => {
    const v = got !== null && typeof got === "object" && "value" in got ? (got as { value: unknown }).value : got;
    if (want.k === "int") {
      if (answerOf(v) !== want.v) throw new Error(`replay: out-parameter ${i} is ${String(v)}, the oracle's ${want.v} (${where(c)})`);
    } else if (want.k === "h" || want.k === "null") {
      if (want.k === "null" ? v !== undefined : handle(c, want) !== v) throw new Error(`replay: out-parameter ${i} differs from the oracle's (${where(c)})`);
    } else if (want.k === "arr") {
      const arr = v as unknown[];
      if (arr.length !== want.items.length || want.items.some((w, k) => handle(c, w) !== arr[k])) throw new Error(`replay: out-array ${i} differs from the oracle's (${where(c)})`);
    }
  };

  const moduleOf = (c: Call): Module => {
    const m = res.modules[0] ?? [...env.values()].find((v) => v instanceof Module);
    if (!(m instanceof Module)) throw new Error(`replay: an attribute before any module at ${where(c)}`);
    return m;
  };

  /** The creator that makes the attribute a `?attr` line describes. rustc's creators (llvm/mod.rs): `AttributeKind::create_attr`
   * -> LLVMRustCreateAttrNoValue (:232), `CreateAlignmentAttr` (:110), `CreateDereferenceable[OrNull]Attr` (:114, :118),
   * `CreateByValAttr` / `CreateByRefAttr` / `CreateStructRetAttr` (:122-:131), `CreateUWTableAttr` (:134). String attributes
   * come from LLVMCreateStringAttribute, a recorded C call, so a `?attr str` has no rustc producer and throws. The others rustc
   * has (`CreateAllocSizeAttr`, `CreateAllocKindAttr`, `CreateRangeAttr`, memory effects) are not decodable from the C API's
   * view yet and throw. A function-level `elementtype` is decodable (a type attribute) but has no rustc producer: rustc puts it
   * only on call sites (abi.rs:754, `apply_to_callsite`), so it throws too (review llir-core-a R5). */
  const inferAttribute = (c: Call): [L.Attribute, string] => {
    const [, kindArg, a, b] = c.args as [Arg, Arg, Arg | undefined, Arg | undefined];
    const kind = new TextDecoder().decode(bytes(kindArg));
    const ctx = moduleOf(c).context;
    const n = a?.k === "int" ? a.v : undefined;
    if (a?.k === "str" && new TextDecoder().decode(a.b) === "type") {
      const ty = handle(c, b!) as L.Type;
      const make = { byval: "LLVMRustCreateByValAttr", byref: "LLVMRustCreateByRefAttr", sret: "LLVMRustCreateStructRetAttr" }[kind];
      if (make === undefined) throw new Error(`replay: no rustc creator recreates type attribute ${kind} (${where(c)})`);
      return [lib[make]!(ctx, ty) as L.Attribute, make];
    }
    if (kind === "align") return [L.LLVMRustCreateAlignmentAttr(ctx, n!), "LLVMRustCreateAlignmentAttr"];
    if (kind === "dereferenceable") return [L.LLVMRustCreateDereferenceableAttr(ctx, n!), "LLVMRustCreateDereferenceableAttr"];
    if (kind === "dereferenceable_or_null") return [L.LLVMRustCreateDereferenceableOrNullAttr(ctx, n!), "LLVMRustCreateDereferenceableOrNullAttr"];
    // `UWTableKind` (ffi.rs: must match llvm::UWTableKind): Sync 1, Async 2.
    if (kind === "uwtable" && (n === 1n || n === 2n)) return [L.LLVMRustCreateUWTableAttr(ctx, n === 2n), "LLVMRustCreateUWTableAttr"];
    const rust = rustAttributeKindOf(kind);
    if (rust !== undefined && n === 0n) return [L.LLVMRustCreateAttrNoValue(ctx, rust), "LLVMRustCreateAttrNoValue"];
    throw new Error(`replay: no rustc creator recreates attribute ${kind}${n === undefined ? "" : ` ${n}`} (${where(c)})`);
  };

  /** The attribute set an inferred line describes must be the model's whole set at that index (order aside). */
  const checkAttrSet = (c: Call, set: Map<string, L.Attribute> | undefined, list: readonly L.Attribute[]): void => {
    const got = [...(set?.values() ?? [])];
    if (got.length !== list.length || list.some((a) => !got.includes(a))) throw new Error(`replay: the attribute set differs from the oracle's (${got.length} attributes, the oracle ${list.length}) at ${where(c)}`);
  };
  const placeOf = (c: Call, at: NonNullable<Call["at"]>): [BasicBlock, Inst | undefined] => [handle(c, at.bb) as BasicBlock, at.next === undefined ? undefined : (handle(c, at.next) as Inst)];

  /** Before a builder call: the builder must insert where the oracle's did. If it would not, a hidden wrapper positioned it:
   * `LLVMRustPositionBuilderAtStart` (builder.rs:1638, `position_at_start`, which `alloca` uses) when the place is the block's
   * first insertion point, `LLVMRustPositionBuilderPastAllocas` (gpu_offload.rs) when it is past the entry block's allocas;
   * no other wrapper of rustc positions a builder, so anything else throws. */
  const positionFor = (c: Call, B: IRBuilder, at: NonNullable<Call["at"]>): void => {
    const [bb, next] = placeOf(c, at);
    if (B.block === bb && B.insertBefore === next) return;
    const idx = next === undefined ? bb.insts.length : bb.insts.indexOf(next);
    if (idx < 0) throw new Error(`replay: the oracle inserted before an instruction of another block at ${where(c)}`);
    if (idx === bb.getFirstInsertionPt()) {
      L.LLVMRustPositionBuilderAtStart(B, bb);
      inferred("LLVMRustPositionBuilderAtStart");
    } else if (bb.isEntryBlock() && idx === bb.getFirstNonPHIOrDbgOrAlloca()) {
      L.LLVMRustPositionBuilderPastAllocas(B, bb.parentFn!);
      inferred("LLVMRustPositionBuilderPastAllocas");
    } else throw new Error(`replay: the builder inserts where no rustc wrapper positions one at ${where(c)}`);
  };
  /** After a builder call: the instruction is where the oracle put it. */
  const checkPlaced = (c: Call, r: unknown, at: NonNullable<Call["at"]>): void => {
    const [bb, next] = placeOf(c, at);
    if (!(r instanceof Inst) || r.parent !== bb || bb.insts[bb.insts.indexOf(r) + 1] !== next) throw new Error(`replay: the instruction is not where the oracle put it at ${where(c)}`);
  };

  /** A `?inst` line: an instruction a hidden wrapper made. rustc's hidden instruction makers are the memory-intrinsic wrappers
   * (`memcpy` / `memmove` / `memset` in builder.rs:1179, :1213, :1236), each a call of the intrinsic it declares; the builder is
   * the one positioned where the call went. Anything else throws. */
  const replayHiddenInst = (c: Call): void => {
    const [iA, bbA, nextA, opA, opsA] = c.args as [Arg, Arg, Arg, Arg, Arg];
    const op = Number(intOf(opA));
    if (op !== 45) throw new Error(`replay: an instruction (opcode ${op}) made by a hidden wrapper at ${where(c)}`);
    const ops = (opsA as { items: Arg[] }).items;
    const calleeArg = ops[ops.length - 1]!;
    const pend = calleeArg.k === "h" ? pendingIntrinsics.get(calleeArg.id) : undefined;
    const calleeName = pend?.name ?? stringOfBstr((handle(c, calleeArg) as IrFunction).name);
    const kind = /^llvm\.(memcpy|memmove|memset)\./.exec(calleeName)?.[1];
    if (kind === undefined) throw new Error(`replay: a call of ${calleeName} made by a hidden wrapper at ${where(c)}`);
    const at = { bb: bbA, next: nextA.k === "null" ? undefined : nextA };
    const [bb, next] = placeOf(c, at);
    const builders = [...env.values()].filter((v): v is IRBuilder => v instanceof IRBuilder && v.block === bb && v.insertBefore === next);
    if (builders.length === 0) throw new Error(`replay: no builder is positioned where the hidden ${kind} call went at ${where(c)}`);
    // `MaybeAlign(N)`: the `align` parameter attribute the wrapper adds, decoded from its `?attr` line (not recreated: the
    // wrapper makes it, not one of rustc's creators); 0 when there is none.
    const alignAt = (index: number): number => {
      const list = c.attrs?.get(index) ?? [];
      for (const a of list) {
        if (a.k !== "h") continue;
        const pa = pendingAttrs.get(a.id);
        if (pa !== undefined && new TextDecoder().decode(bytes(pa.args[1]!)) === "align") return Number(intOf(pa.args[2]!));
        const known = env.get(a.id);
        if (known instanceof Attribute && known.key === "Alignment") return Number(known.print(false).split(" ")[1]);
      }
      return 0;
    };
    const intArg = (a: Arg): bigint => (a.k === "cint" ? a.v : (handle(c, a) as ConstantInt).value);
    const isVolatile = intArg(ops[3]!) !== 0n;
    const B = builders[0]!;
    let r: unknown;
    if (kind === "memset") r = L.LLVMRustBuildMemSet(B, handle(c, ops[0]!) as L.Value, alignAt(1), handle(c, ops[1]!) as L.Value, handle(c, ops[2]!) as L.Value, isVolatile);
    else {
      const make = kind === "memcpy" ? L.LLVMRustBuildMemCpy : L.LLVMRustBuildMemMove;
      r = make(B, handle(c, ops[0]!) as L.Value, alignAt(1), handle(c, ops[1]!) as L.Value, alignAt(2), handle(c, ops[2]!) as L.Value, isVolatile);
    }
    checkPlaced(c, r, at);
    const call = r as Inst;
    bind(c, (iA as { id: number }).id, call);
    if (pend !== undefined) {
      bind(c, (calleeArg as { id: number }).id, call.callee);
      pendingIntrinsics.delete((calleeArg as { id: number }).id);
      if (stringOfBstr(call.callee.name) !== pend.name) throw new Error(`replay: the wrapper declared ${call.callee.name}, the oracle ${pend.name}, at ${where(c)}`);
    }
    // Its call-site attributes are the wrapper's: bind the oracle's handles to the model's and compare the sets.
    for (const [index, list] of c.attrs ?? []) {
      const got = [...(call.attributes.get(index)?.values() ?? [])];
      if (got.length !== list.length) throw new Error(`replay: the hidden call's attributes at ${index} differ from the oracle's at ${where(c)}`);
      list.forEach((a, k) => {
        if (a.k === "h" && pendingAttrs.has(a.id)) {
          pendingAttrs.delete(a.id);
          bind(c, a.id, got[k]);
        } else if (a.k !== "h" || !got.includes(handle(c, a) as L.Attribute)) throw new Error(`replay: the hidden call's attributes at ${index} differ from the oracle's at ${where(c)}`);
      });
    }
    inferred(kind === "memcpy" ? "LLVMRustBuildMemCpy" : kind === "memmove" ? "LLVMRustBuildMemMove" : "LLVMRustBuildMemSet");
  };

  for (const c of calls) {
    if (c.fn === "?global") {
      // A global variable no recorded call made: `declare_global` (declare.rs:97, LLVMRustGetOrInsertGlobal) in the default
      // globals address space, `declare_global_in_addrspace` (declare.rs:113, LLVMRustGetOrInsertGlobalInAddrspace) in another.
      // (Coverage's `LLVMRustCoverageCreatePGOFuncNameVar` also makes one; coverage is out of M7 and stubbed.)
      const [g, name, ty, m, as] = c.args as [Arg, Arg, Arg, Arg, Arg];
      if (ty.k === "skip") throw new Error(`replay: a global of an unrecorded type at ${where(c)}`);
      const M = handle(c, m) as Module;
      const nb = bytes(name);
      const addrspace = Number(intOf(as));
      const def = M.layoutAddressSpace("G");
      const v =
        addrspace === def
          ? L.LLVMRustGetOrInsertGlobal(M, nb, nb.length, handle(c, ty) as L.Type)
          : L.LLVMRustGetOrInsertGlobalInAddrspace(M, nb, nb.length, handle(c, ty) as L.Type, addrspace);
      if (Buffer.compare(Buffer.from(v.name, "latin1"), Buffer.from(nb)) !== 0) throw new Error(`replay: global named ${v.name}, the oracle's is ${new TextDecoder().decode(nb)} (${where(c)})`);
      bind(c, (g as { id: number }).id, v);
      inferred(addrspace === def ? "LLVMRustGetOrInsertGlobal" : "LLVMRustGetOrInsertGlobalInAddrspace");
      continue;
    }
    if (c.fn === "?function") {
      // A function no recorded call made. Its hidden producers in rustc: the memory-intrinsic wrappers (LLVMRustBuildMemCpy,
      // ...MemMove, ...MemSet declare `llvm.memcpy.*` etc. through `Intrinsic::getOrInsertDeclaration`), bound when their
      // `?inst` replays; and `LLVMRustUpgradeIntrinsicFunction`'s `NewFn` (intrinsic.rs:1308), which the model stubs.
      const [fa, nameArg, m] = c.args as [Arg, Arg, Arg];
      const name = new TextDecoder().decode(bytes(nameArg));
      if (/^llvm\.(memcpy|memmove|memset)\./.test(name)) {
        pendingIntrinsics.set((fa as { id: number }).id, { name, m: handle(c, m) as Module });
        continue;
      }
      throw new Error(`replay: a function made by a hidden wrapper (LLVMRustUpgradeIntrinsicFunction, stubbed) at ${where(c)}`);
    }
    if (c.fn === "?attr") {
      // Recreated when first used (`handle`), so an intrinsic declaration's attributes, which no rustc creator makes, are not.
      pendingAttrs.set((c.args[0] as { id: number }).id, c);
      continue;
    }
    if (c.fn === "?attrs") {
      if (c.args[0]!.k === "h" && pendingIntrinsics.has(c.args[0].id)) {
        res.intrinsicAttributeSets++;
        continue;
      }
      // `llvm::AddFunctionAttributes` (llvm/mod.rs:43) is rustc's one caller of LLVMRustAddFunctionAttributes.
      const f = handle(c, c.args[0]!) as IrFunction;
      const index = Number(intOf(c.args[1]!));
      const list = (c.args[2] as { items: Arg[] }).items.map((a) => handle(c, a) as L.Attribute);
      L.LLVMRustAddFunctionAttributes(f, index, list, list.length);
      checkAttrSet(c, f.attributes.get(index), list);
      inferred("LLVMRustAddFunctionAttributes");
      continue;
    }
    if (c.fn === "?csattrs") {
      // `llvm::AddCallSiteAttributes` (llvm/mod.rs:61) is rustc's one caller of LLVMRustAddCallSiteAttributes.
      const I = handle(c, c.args[0]!) as Inst;
      const index = Number(intOf(c.args[1]!));
      const list = (c.args[2] as { items: Arg[] }).items.map((a) => handle(c, a) as L.Attribute);
      L.LLVMRustAddCallSiteAttributes(I, index, list, list.length);
      checkAttrSet(c, I.attributes.get(index), list);
      inferred("LLVMRustAddCallSiteAttributes");
      continue;
    }
    if (c.fn === "?inst") {
      replayHiddenInst(c);
      continue;
    }
    if (c.fn === "?datalayout") {
      // `LLVMRustSetDataLayoutFromTargetMachine` (context.rs:209) is rustc's one hidden producer of a data layout; it needs a
      // TargetMachine, which is the driver lanes'. Its effect is the module's layout string (all `Module::setDataLayout`
      // keeps), applied to the model directly.
      (handle(c, c.args[0]!) as Module).dataLayout = Buffer.from(bytes(c.args[1]!)).toString("latin1");
      res.inferred++;
      count(res.stubbedEffects, "LLVMRustSetDataLayoutFromTargetMachine");
      continue;
    }
    if (c.fn === "?dsolocal") {
      // The final `dso_local` of a global or function, where it is not implied (record.ts reads it before the context goes).
      // rustc's one producer is `llvm::set_dso_local` -> LLVMRustSetDSOLocal (llvm/mod.rs), called from `should_assume_dso_local`
      // users (mono_item.rs, consts.rs, callee.rs).
      L.LLVMRustSetDSOLocal(handle(c, c.args[0]!) as L.Value, true);
      inferred("LLVMRustSetDSOLocal");
      continue;
    }
    if (c.fn === "?triple") {
      // `LLVMRustSetNormalizedTarget` (context.rs:234), rustc's one hidden producer of a triple.
      L.LLVMRustSetNormalizedTarget(handle(c, c.args[0]!) as L.Module, new TextDecoder().decode(bytes(c.args[1]!)));
      inferred("LLVMRustSetNormalizedTarget");
      continue;
    }
    if (c.fn === "?flag") {
      const [m, b, keyArg, kindArg, val] = c.args as [Arg, Arg, Arg, Arg, Arg];
      const M = handle(c, m) as L.Module;
      const behavior = convert(c, b, "ModuleFlagMergeBehavior") as T.ModuleFlagMergeBehavior;
      const kb = bytes(keyArg);
      const key = new TextDecoder().decode(kb);
      const kind = new TextDecoder().decode(bytes(kindArg));
      if (kind !== "i" && kind !== "s") throw new Error(`replay: a module flag whose value the recorder could not read at ${where(c)}`);
      const own = FLAG_WRAPPERS[key];
      if (own !== undefined && kind === "i" && own.behavior === behavior && (own.value === undefined || own.value === intOf(val))) {
        if (own.wrapper === "LLVMRustSetModulePICLevel") L.LLVMRustSetModulePICLevel(M);
        else if (own.wrapper === "LLVMRustSetModulePIELevel") L.LLVMRustSetModulePIELevel(M);
        else if (own.wrapper === "LLVMRustSetModuleCodeModel") {
          const cm = LLVM_CODE_MODELS[Number(intOf(val))];
          if (cm === undefined) throw new Error(`replay: Code Model ${intOf(val)} is no CodeModel::Model (${where(c)})`);
          L.LLVMRustSetModuleCodeModel(M, cm);
        } else L.LLVMRustSetModuleLargeDataThreshold(M, intOf(val));
        inferred(own.wrapper);
        continue;
      }
      const site = FLAG_SITES.find(([k, bh, kd]) => k === key && bh === behavior && kd === (kind === "i" ? "u32" : "str"));
      if (kind === "s") {
        if (site === undefined) throw new Error(`replay: no rustc call site adds string flag ${key} (${behavior}) at ${where(c)}`);
        L.LLVMRustAddModuleFlagString(M, behavior, kb, kb.length, bytes(val), bytes(val).length);
        inferred("LLVMRustAddModuleFlagString");
        continue;
      }
      const v = intOf(val);
      if (v > 0xffffffffn) throw new Error(`replay: flag ${key} = ${v} does not fit add_module_flag_u32's u32 (${where(c)})`);
      // A literal call site, or one of the two whose key comes from elsewhere (context.rs:514, :593), which the case names.
      if (site === undefined && !(opts.flagKeys ?? []).includes(key)) throw new Error(`replay: no rustc call site adds integer flag ${key} (${behavior}), and the case names no such -Z llvm-module-flag or small-data key, at ${where(c)}`);
      L.LLVMRustAddModuleFlagU32(M, behavior, kb, kb.length, Number(v));
      inferred(site === undefined ? "LLVMRustAddModuleFlagU32 (key from the target or -Z llvm-module-flag)" : "LLVMRustAddModuleFlagU32");
      continue;
    }
    const f = sig.get(c.fn);
    if (f === undefined) throw new Error(`replay: ${c.fn} is not an ffi.rs function (${where(c)})`);
    // A function no lane has implemented yet: skip it, and remember what it would have returned.
    if (L.IMPLEMENTED.has(c.fn) === false) {
      count(res.skipped, c.fn);
      if (c.ret?.k === "h" && !env.has(c.ret.id)) {
        env.set(c.ret.id, SKIPPED);
        skippedBy.set(c.ret.id, c.fn);
      }
      continue;
    }
    const args = f.params.map((p, i) => convert(c, c.args[i] ?? { k: "skip" }, tsType(p.rust, p.name, items, false)));
    if (c.at !== undefined && args[0] instanceof IRBuilder) positionFor(c, args[0], c.at);
    const r = lib[c.fn]!(...args);
    res.replayed++;
    if (c.at !== undefined) checkPlaced(c, r, c.at);
    if (r instanceof Module && !res.modules.includes(r)) res.modules.push(r);
    // Check the answer and the out-parameters.
    if (c.ret?.k === "h") bind(c, c.ret.id, r);
    else if (c.ret?.k === "null") {
      if (r !== undefined) throw new Error(`replay: returned a value where the oracle returned null at ${where(c)}`);
    } else if (c.ret?.k === "int") {
      const got = answerOf(r);
      if (got !== c.ret.v) throw new Error(`replay: answered ${got}, the oracle ${c.ret.v}, at ${where(c)}`);
    }
    if (c.retStr !== undefined) {
      const got = Buffer.from(String(r ?? ""), "utf8");
      if (Buffer.compare(got, Buffer.from(c.retStr)) !== 0) throw new Error(`replay: answered ${JSON.stringify(String(r))}, the oracle ${JSON.stringify(new TextDecoder().decode(c.retStr))}, at ${where(c)}`);
    }
    c.args.forEach((a, i) => {
      if (a.k === "out") checkOut(c, i, a.v, args[i]);
    });
  }
  return res;
}
