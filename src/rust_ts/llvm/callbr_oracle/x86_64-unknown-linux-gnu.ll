; ModuleID = 'x64.90b9e63a3841b902-cgu.0'
source_filename = "x64.90b9e63a3841b902-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

module asm(target_features: "+fxsr,+sse,+sse2,+x87", target_cpu: "x86-64")
    ".intel_syntax"
    ".pushsection .text.raw_name,\22ax\22, @progbits"
    ".balign 4"
    ".globl raw_name"
    ".type raw_name, @function"
    "raw_name:"
    "ret"
    ".Lfunc_end_raw_name:"
    ".size raw_name, . - raw_name"
    ".popsection"
    ""
    ".att_syntax"
    ".intel_syntax"
    ".pushsection .text.?question,\22ax\22, @progbits"
    ".balign 4"
    ".globl ?question"
    ".type ?question, @function"
    "?question:"
    "ret"
    ".Lfunc_end_?question:"
    ".size ?question, . - ?question"
    ".popsection"
    ""
    ".att_syntax"
module asm(target_cpu: "x86-64")
    ".intel_syntax"
    ".globl naked_no_mangle"
    ".set naked_no_mangle_alias, _RNvCscqnbFm6XfKo_3x646STATIC"
    ".att_syntax"
    ".intel_syntax"
    "// _RNvCscqnbFm6XfKo_3x646STATIC _RNSCscqnbFm6XfKo_3x643cgu.0 STATIC_NM"
    ".att_syntax"
    ".intel_syntax"
    "// STATIC_NM _RNvCscqnbFm6XfKo_3x648goto_two \22naked_vectorcall@@0\22"
    ".att_syntax"
module asm(target_features: "+fxsr,+sse,+sse2,+x87", target_cpu: "x86-64")
    ".intel_syntax"
    ".pushsection .text._RNvCscqnbFm6XfKo_3x6411naked_plain,\22ax\22, @progbits"
    ".balign 4"
    ".globl _RNvCscqnbFm6XfKo_3x6411naked_plain"
    ".type _RNvCscqnbFm6XfKo_3x6411naked_plain, @function"
    "_RNvCscqnbFm6XfKo_3x6411naked_plain:"
    "mov eax, 1"
    "ret"
    ".Lfunc_end__RNvCscqnbFm6XfKo_3x6411naked_plain:"
    ".size _RNvCscqnbFm6XfKo_3x6411naked_plain, . - _RNvCscqnbFm6XfKo_3x6411naked_plain"
    ".popsection"
    ""
    ".att_syntax"
    ".intel_syntax"
    ".pushsection .text.naked_no_mangle,\22ax\22, @progbits"
    ".balign 4"
    ".globl naked_no_mangle"
    ".type naked_no_mangle, @function"
    "naked_no_mangle:"
    "jmp _RNvCscqnbFm6XfKo_3x6411naked_plain"
    ".Lfunc_end_naked_no_mangle:"
    ".size naked_no_mangle, . - naked_no_mangle"
    ".popsection"
    ""
    ".att_syntax"
    ".intel_syntax"
    ".pushsection .text.naked_vectorcall@@0,\22ax\22, @progbits"
    ".balign 4"
    ".globl naked_vectorcall@@0"
    ".type naked_vectorcall@@0, @function"
    "naked_vectorcall@@0:"
    "ret"
    ".Lfunc_end_naked_vectorcall@@0:"
    ".size naked_vectorcall@@0, . - naked_vectorcall@@0"
    ".popsection"
    ""
    ".att_syntax"

@STATIC_NM = constant [8 x i8] c"\08\00\00\00\00\00\00\00", align 8, !guid !0
@_RNSCscqnbFm6XfKo_3x643cgu.0 = internal unnamed_addr constant [3 x i8] c"\01\02\03", align 1, !guid !1
@_RNvCscqnbFm6XfKo_3x646STATIC = constant [8 x i8] c"\07\00\00\00\00\00\00\00", align 8, !guid !2
@llvm.compiler.used = appending global [10 x ptr] [ptr @naked_no_mangle, ptr @naked_no_mangle, ptr @_RNvCscqnbFm6XfKo_3x646STATIC, ptr @_RNvCscqnbFm6XfKo_3x646STATIC, ptr @_RNSCscqnbFm6XfKo_3x643cgu.0, ptr @STATIC_NM, ptr @STATIC_NM, ptr @_RNvCscqnbFm6XfKo_3x648goto_two, ptr @naked_vectorcall, ptr @_RNvCscqnbFm6XfKo_3x6411naked_plain], section "llvm.metadata", !guid !3

; x64::goto_inout
; Function Attrs: nonlazybind uwtable
define i64 @_RNvCscqnbFm6XfKo_3x6410goto_inout(i64 %0) unnamed_addr #0 !guid !8 {
start:
  %_0 = alloca [8 x i8], align 8
  %x = alloca [8 x i8], align 8
  store i64 %0, ptr %x, align 8
  %1 = load i64, ptr %x, align 8
  %2 = callbr i64 asm sideeffect alignstack "dec ${0:q}\0Ajz ${2:l}", "=&r,0,!i,~{dirflag},~{fpsr},~{flags},~{memory}"(i64 %1)
          to label %bb1 [label %bb2], !srcloc !9

bb2:                                              ; preds = %start
  store i64 %2, ptr %x, align 8
  store i64 100, ptr %_0, align 8
  br label %bb3

bb1:                                              ; preds = %start
  store i64 %2, ptr %x, align 8
  %3 = load i64, ptr %x, align 8
  store i64 %3, ptr %_0, align 8
  br label %bb3

bb3:                                              ; preds = %bb2, %bb1
  %4 = load i64, ptr %_0, align 8
  ret i64 %4
}

; x64::goto_unwind_free
; Function Attrs: nonlazybind uwtable
define i8 @_RNvCscqnbFm6XfKo_3x6416goto_unwind_free(ptr %p) unnamed_addr #0 !guid !10 {
start:
  %r = alloca [1 x i8], align 1
  store i8 0, ptr %r, align 1
  callbr void asm sideeffect inteldialect "cmp byte ptr [${0:q}], 0\0Aje ${1:l}", "r,!i,~{dirflag},~{fpsr},~{flags},~{memory}"(ptr %p) #2
          to label %bb1 [label %bb2], !srcloc !11

bb2:                                              ; preds = %start
  store i8 1, ptr %r, align 1
  br label %bb1

bb1:                                              ; preds = %bb2, %start
  %_0 = load i8, ptr %r, align 1
  ret i8 %_0
}

; x64::goto_two
; Function Attrs: nonlazybind uwtable
define i32 @_RNvCscqnbFm6XfKo_3x648goto_two(i64 %x) unnamed_addr #0 !guid !12 {
start:
  %_0 = alloca [4 x i8], align 4
  callbr void asm sideeffect alignstack inteldialect "test ${0:q}, ${0:q}\0Ajz ${1:l}\0Ajmp ${2:l}", "r,!i,!i,~{dirflag},~{fpsr},~{flags},~{memory}"(i64 %x)
          to label %bb1 [label %bb2, label %bb3], !srcloc !13

bb2:                                              ; preds = %start
  store i32 1, ptr %_0, align 4
  br label %bb4

bb3:                                              ; preds = %start
  store i32 2, ptr %_0, align 4
  br label %bb4

bb1:                                              ; preds = %start
  store i32 0, ptr %_0, align 4
  br label %bb4

bb4:                                              ; preds = %bb3, %bb2, %bb1
  %0 = load i32, ptr %_0, align 4
  ret i32 %0
}

; Function Attrs: noinline nounwind nonlazybind uwtable
declare x86_vectorcallcc void @"\01raw_name"() unnamed_addr #1

; Function Attrs: noinline nounwind nonlazybind uwtable
declare i64 @"?question"() unnamed_addr #1

; Function Attrs: noinline nounwind nonlazybind uwtable
declare i64 @naked_no_mangle() unnamed_addr #1

; Function Attrs: noinline nounwind nonlazybind uwtable
declare x86_vectorcallcc void @naked_vectorcall() unnamed_addr #1

; x64::naked_plain
; Function Attrs: noinline nounwind nonlazybind uwtable
declare i64 @_RNvCscqnbFm6XfKo_3x6411naked_plain() unnamed_addr #1

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { noinline nounwind nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #2 = { memory(read, inaccessiblemem: readwrite) }

!llvm.module.flags = !{!4, !5, !6}
!llvm.ident = !{!7}

!0 = !{i64 -8029204499980403853}
!1 = !{i64 7997896826620376784}
!2 = !{i64 -8374111698266311475}
!3 = !{i64 -8836116302723813610}
!4 = !{i32 8, !"PIC Level", i32 2}
!5 = !{i32 2, !"RtLibUseGOT", i32 1}
!6 = !{i32 7, !"uwtable", i32 2}
!7 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!8 = !{i64 -2418294334717620269}
!9 = !{i64 2379411882531, i64 2422361555502}
!10 = !{i64 -3841098071834518400}
!11 = !{i64 0, i64 3238405341917, i64 3281355014902}
!12 = !{i64 -2451864426468753447}
!13 = !{i64 0, i64 1666447311223, i64 1709396984200, i64 1756641624466}
