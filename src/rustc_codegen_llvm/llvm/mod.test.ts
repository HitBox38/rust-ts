// Tests of llvm/mod.ts and macros.ts (lane cg-contract), through the IR model's implemented functions. Upstream has none;
// expectations are read off llvm/mod.rs at the pin (lines cited) and, for printed IR, LLVM's AsmWriter forms that the model
// prints (src/rust_ts/llvm/printer.ts).
import { describe, expect, test } from "bun:test";
import { Panic, Unported } from "../../std/panic.ts";
import { PLAIN } from "../../std/fmt.ts";
import { TryFromU32 } from "../macros.ts";
import { debug_Value } from "../value.ts";
import * as llvm from "./mod.ts";

function module(): [llvm.Context, llvm.Module] {
  const cx = llvm.LLVMContextCreate();
  return [cx, llvm.LLVMModuleCreateWithNameInContext("m", cx)];
}

describe("AttributePlace::as_uint (mod.rs:179)", () => {
  test("ReturnValue 0, Argument(i) 1 + i, Function !0", () => {
    expect(llvm.AttributePlace.as_uint(llvm.AttributePlace.ReturnValue)).toBe(0);
    expect(llvm.AttributePlace.as_uint({ $: "Argument", _0: 0 })).toBe(1);
    expect(llvm.AttributePlace.as_uint({ $: "Argument", _0: 5 })).toBe(6);
    expect(llvm.AttributePlace.as_uint(llvm.AttributePlace.Function)).toBe(0xffffffff);
  });
});

describe("value names (mod.rs:329, :368)", () => {
  test("set_value_name / get_value_name round-trip bytes, including non-ASCII", () => {
    const [cx, m] = module();
    const g = llvm.add_global(m, llvm.LLVMInt8TypeInContext(cx), "a");
    expect(new TextDecoder().decode(llvm.get_value_name(g))).toBe("a");
    llvm.set_value_name(g, new TextEncoder().encode("näme"));
    const bytes = llvm.get_value_name(g);
    expect(bytes.length).toBe(5);
    expect(new TextDecoder().decode(bytes)).toBe("näme");
  });
});

describe("globals", () => {
  test("SetUniqueComdat names the comdat after the value (mod.rs:213)", () => {
    const [cx, m] = module();
    const i8 = llvm.LLVMInt8TypeInContext(cx);
    const g = llvm.add_global(m, i8, "foo");
    llvm.set_initializer(g, llvm.LLVMConstNull(i8));
    llvm.SetUniqueComdat(m, g);
    // A comdat of the global's own name prints as a bare `comdat`. `Debug for Value` is `LLVMRustWriteValueToString`, which
    // writes `(<type>:<value>)` (RustWrapper.cpp).
    expect(debug_Value(g, PLAIN)).toBe("(ptr:@foo = global i8 0, comdat)");
  });

  test("set_comdat with another name, linkage and visibility read back (mod.rs:264-286, :302)", () => {
    const [cx, m] = module();
    const i8 = llvm.LLVMInt8TypeInContext(cx);
    const g = llvm.add_global(m, i8, "g");
    llvm.set_initializer(g, llvm.LLVMConstNull(i8));
    llvm.set_comdat(m, g, "c");
    llvm.set_linkage(g, "LinkOnceODRLinkage");
    llvm.set_visibility(g, "Hidden");
    llvm.set_global_constant(g, true);
    llvm.set_alignment(g, { bytes: () => 8 } as never);
    expect(llvm.get_linkage(g)).toBe("LinkOnceODRLinkage");
    expect(llvm.get_visibility(g)).toBe("Hidden");
    expect(llvm.is_declaration(g)).toBe(false);
    expect(debug_Value(g, PLAIN)).toBe("(ptr:@g = linkonce_odr hidden constant i8 0, comdat($c), align 8)");
  });

  test("a global without an initializer is a declaration (mod.rs:274)", () => {
    const [cx, m] = module();
    expect(llvm.is_declaration(llvm.add_global(m, llvm.LLVMInt8TypeInContext(cx), "d"))).toBe(true);
  });
});

describe("functions", () => {
  test("get_param: in bounds, and its assertion message (mod.rs:314)", () => {
    const [cx, m] = module();
    const i32 = llvm.LLVMInt32TypeInContext(cx);
    const fty = llvm.LLVMFunctionType(llvm.LLVMVoidTypeInContext(cx), [i32, i32], 2, llvm.FALSE);
    const f = llvm.LLVMAddFunction(m, "f", fty);
    expect(llvm.count_params(f)).toBe(2);
    expect(llvm.get_param(f, 1)).toBe(llvm.LLVMGetParam(f, 1));
    expect(() => llvm.get_param(f, 2)).toThrow(new Panic("out of bounds argument access: 2 out of 2 arguments"));
  });
});

describe("attributes (mod.rs:65-108)", () => {
  test("string attributes are uniqued per context", () => {
    const [cx] = module();
    expect(llvm.CreateAttrString(cx, "probe-stack")).toBe(llvm.CreateAttrString(cx, "probe-stack"));
    expect(llvm.CreateAttrStringValue(cx, "target-cpu", "apple-m1")).toBe(llvm.CreateAttrStringValue(cx, "target-cpu", "apple-m1"));
    expect(llvm.CreateAttrStringValue(cx, "target-cpu", "apple-m1")).not.toBe(llvm.CreateAttrStringValue(cx, "target-cpu", "generic"));
  });

  test("HasStringAttribute / RemoveStringAttrFromFn stop: their FFI is enzyme_ffi.rs's (out of M7)", () => {
    const [cx, m] = module();
    const f = llvm.LLVMAddFunction(m, "f", llvm.LLVMFunctionType(llvm.LLVMVoidTypeInContext(cx), [], 0, llvm.FALSE));
    expect(() => llvm.HasStringAttribute(f, "no-sanitize-cfi")).toThrow(Unported);
    expect(() => llvm.RemoveStringAttrFromFn(f, "no-sanitize-cfi")).toThrow(Unported);
  });
});

describe("build_string (mod.rs:372)", () => {
  test("UTF-8 text is Ok", () => {
    const r = llvm.build_string((s) => llvm.LLVMRustStringWriteImpl(s, new TextEncoder().encode("héllo")));
    expect(r).toEqual({ $: "Ok", _0: "héllo" });
  });

  test("invalid UTF-8 is Err(FromUtf8Error), with its derived Debug", () => {
    const r = llvm.build_string((s) => llvm.LLVMRustStringWriteImpl(s, Uint8Array.from([0x61, 0xff])));
    expect(r.$).toBe("Err");
    if (r.$ !== "Err") return;
    expect(llvm.debug_FromUtf8Error(r._0, PLAIN)).toBe("FromUtf8Error { bytes: [97, 255], error: Utf8Error { valid_up_to: 1, error_len: Some(1) } }");
  });
});

describe("LLVMRustResult::into_result (mod.rs:29)", () => {
  test("Success is Ok(()), Failure is Err(())", () => {
    expect(llvm.LLVMRustResult_impl.into_result("Success")).toEqual({ $: "Ok", _0: undefined });
    expect(llvm.LLVMRustResult_impl.into_result("Failure")).toEqual({ $: "Err", _0: undefined });
  });
});

describe("#[derive(TryFromU32)] (macros.rs:14)", () => {
  test("CallConv: every discriminant maps back to its variant; others are Err(value)", () => {
    const try_from = TryFromU32(llvm.CallConv_discriminant);
    for (const [variant, discr] of Object.entries(llvm.CallConv_discriminant)) {
      expect(try_from(discr)).toEqual({ $: "Ok", _0: variant as llvm.CallConv });
    }
    // ffi.rs:163 `CCallConv = 0`, `FastCallConv = 8`.
    expect(try_from(0)).toEqual({ $: "Ok", _0: "CCallConv" });
    expect(try_from(8)).toEqual({ $: "Ok", _0: "FastCallConv" });
    expect(try_from(1)).toEqual({ $: "Err", _0: 1 });
  });
});
