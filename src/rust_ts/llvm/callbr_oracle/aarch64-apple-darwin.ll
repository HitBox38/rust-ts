; ModuleID = 'a64.5a35b6fa43f114eb-cgu.0'
source_filename = "a64.5a35b6fa43f114eb-cgu.0"
target datalayout = "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32"
target triple = "arm64-apple-macosx11.0.0"

module asm(target_features: "+aes,+crc,+dit,+dotprod,+ccpp,+ccdp,+complxnum,+fp16fml,+flagm,+altnzcv,+fp-armv8,+fullfp16,+fptoint,+jsconv,+lor,+lse,+lse2,+neon,+fp-armv8,+pauth,+pauth,+pan,+perfmon,+ras,+rcpc,+rcpc-immo,+rdm,+sb,+sha2,+sha3,+ssbs,+v8.1a,+v8.2a,+v8.3a,+v8.4a,+vh", target_cpu: "apple-m1")
    ".section __TEXT,__text,regular,pure_instructions"
    ".balign 4"
    ".globl raw_name"
    "raw_name:"
    "ret"
    ".Lfunc_end_raw_name:"
    ".section __TEXT,__text,regular,pure_instructions"
    ".balign 4"
    ".globl _?question"
    "_?question:"
    "ret"
    ".Lfunc_end__?question:"
module asm(target_cpu: "apple-m1")
    ".globl _naked_no_mangle"
    ".set _naked_no_mangle_alias, __RNvCs7Kbsgs9NgSd_3a646STATIC"
    "// __RNvCs7Kbsgs9NgSd_3a646STATIC __RNSCs7Kbsgs9NgSd_3a643cgu.0 _STATIC_NM"
    "// _STATIC_NM __RNvCs7Kbsgs9NgSd_3a648goto_one"
module asm(target_features: "+aes,+crc,+dit,+dotprod,+ccpp,+ccdp,+complxnum,+fp16fml,+flagm,+altnzcv,+fp-armv8,+fullfp16,+fptoint,+jsconv,+lor,+lse,+lse2,+neon,+fp-armv8,+pauth,+pauth,+pan,+perfmon,+ras,+rcpc,+rcpc-immo,+rdm,+sb,+sha2,+sha3,+ssbs,+v8.1a,+v8.2a,+v8.3a,+v8.4a,+vh", target_cpu: "apple-m1")
    ".section __TEXT,__text,regular,pure_instructions"
    ".balign 4"
    ".globl __RNvCs7Kbsgs9NgSd_3a6411naked_plain"
    "__RNvCs7Kbsgs9NgSd_3a6411naked_plain:"
    "mov x0, #1"
    "ret"
    ".Lfunc_end___RNvCs7Kbsgs9NgSd_3a6411naked_plain:"
    ".section __TEXT,__text,regular,pure_instructions"
    ".balign 4"
    ".globl __RNvCs7Kbsgs9NgSd_3a6413naked_private"
    ".private_extern __RNvCs7Kbsgs9NgSd_3a6413naked_private"
    "__RNvCs7Kbsgs9NgSd_3a6413naked_private:"
    "ret"
    ".Lfunc_end___RNvCs7Kbsgs9NgSd_3a6413naked_private:"
    ".section __TEXT,__text,regular,pure_instructions"
    ".balign 4"
    ".globl _naked_no_mangle"
    "_naked_no_mangle:"
    "b __RNvCs7Kbsgs9NgSd_3a6411naked_plain"
    ".Lfunc_end__naked_no_mangle:"

@STATIC_NM = constant [8 x i8] c"\08\00\00\00\00\00\00\00", align 8, !guid !0
@_RNSCs7Kbsgs9NgSd_3a643cgu.0 = internal unnamed_addr constant [3 x i8] c"\01\02\03", align 1, !guid !1
@_RNvCs7Kbsgs9NgSd_3a646STATIC = constant [8 x i8] c"\07\00\00\00\00\00\00\00", align 8, !guid !2
@llvm.compiler.used = appending global [9 x ptr] [ptr @naked_no_mangle, ptr @naked_no_mangle, ptr @_RNvCs7Kbsgs9NgSd_3a646STATIC, ptr @_RNvCs7Kbsgs9NgSd_3a646STATIC, ptr @_RNSCs7Kbsgs9NgSd_3a643cgu.0, ptr @STATIC_NM, ptr @STATIC_NM, ptr @_RNvCs7Kbsgs9NgSd_3a648goto_one, ptr @_RNvCs7Kbsgs9NgSd_3a6411naked_plain], section "llvm.metadata", !guid !3

; a64::use_private
; Function Attrs: uwtable
define i64 @_RNvCs7Kbsgs9NgSd_3a6411use_private() unnamed_addr #0 !guid !8 {
start:
; call a64::naked_private
  %_0 = call i64 @_RNvCs7Kbsgs9NgSd_3a6413naked_private() #2
  ret i64 %_0
}

; a64::goto_noreturn
; Function Attrs: uwtable
define i64 @_RNvCs7Kbsgs9NgSd_3a6413goto_noreturn(i64 %x) unnamed_addr #0 !guid !9 {
start:
  %_0 = alloca [8 x i8], align 8
  callbr void asm sideeffect alignstack "cbz ${0}, ${1:l}\0Ab ${2:l}", "r,!i,!i,~{cc},~{memory}"(i64 %x)
          to label %unreachable [label %bb1, label %bb2], !srcloc !10

bb1:                                              ; preds = %start
  store i64 5, ptr %_0, align 8
  br label %bb3

bb2:                                              ; preds = %start
  store i64 6, ptr %_0, align 8
  br label %bb3

unreachable:                                      ; preds = %start
  unreachable

bb3:                                              ; preds = %bb2, %bb1
  %0 = load i64, ptr %_0, align 8
  ret i64 %0
}

; a64::goto_one
; Function Attrs: uwtable
define i64 @_RNvCs7Kbsgs9NgSd_3a648goto_one(i64 %x) unnamed_addr #0 !guid !11 {
start:
  %_0 = alloca [8 x i8], align 8
  callbr void asm sideeffect alignstack "cbz ${0}, ${1:l}", "r,!i,~{cc},~{memory}"(i64 %x)
          to label %bb1 [label %bb2], !srcloc !12

bb2:                                              ; preds = %start
  store i64 1, ptr %_0, align 8
  br label %bb3

bb1:                                              ; preds = %start
  store i64 2, ptr %_0, align 8
  br label %bb3

bb3:                                              ; preds = %bb2, %bb1
  %0 = load i64, ptr %_0, align 8
  ret i64 %0
}

; a64::goto_out
; Function Attrs: uwtable
define i64 @_RNvCs7Kbsgs9NgSd_3a648goto_out(i64 %x) unnamed_addr #0 !guid !13 {
start:
  %y = alloca [8 x i8], align 8
  %_0 = alloca [8 x i8], align 8
  %0 = callbr i64 asm sideeffect alignstack "mov ${0}, ${1}\0Acbz ${1}, ${2:l}", "=&r,r,!i,~{cc},~{memory}"(i64 %x)
          to label %bb1 [label %bb2], !srcloc !14

bb2:                                              ; preds = %start
  store i64 %0, ptr %y, align 8
  store i64 0, ptr %_0, align 8
  br label %bb3

bb1:                                              ; preds = %start
  store i64 %0, ptr %y, align 8
  %1 = load i64, ptr %y, align 8
  store i64 %1, ptr %_0, align 8
  br label %bb3

bb3:                                              ; preds = %bb2, %bb1
  %2 = load i64, ptr %_0, align 8
  ret i64 %2
}

; a64::goto_many
; Function Attrs: uwtable
define i32 @_RNvCs7Kbsgs9NgSd_3a649goto_many(i64 %x) unnamed_addr #0 !guid !15 {
start:
  %r = alloca [4 x i8], align 4
  store i32 0, ptr %r, align 4
  callbr void asm sideeffect alignstack "cbz ${0}, ${1:l}\0Acbnz ${0}, ${2:l}\0Ab ${3:l}", "r,!i,!i,!i,~{cc},~{memory}"(i64 %x)
          to label %bb1 [label %bb2, label %bb3, label %bb4], !srcloc !16

bb2:                                              ; preds = %start
  store i32 10, ptr %r, align 4
  br label %bb1

bb3:                                              ; preds = %start
  store i32 20, ptr %r, align 4
  br label %bb1

bb4:                                              ; preds = %start
  store i32 30, ptr %r, align 4
  br label %bb1

bb1:                                              ; preds = %bb4, %bb3, %bb2, %start
  %_0 = load i32, ptr %r, align 4
  ret i32 %_0
}

; Function Attrs: noinline nounwind uwtable
declare i64 @"\01raw_name"() unnamed_addr #1

; Function Attrs: noinline nounwind uwtable
declare i64 @"?question"() unnamed_addr #1

; Function Attrs: noinline nounwind uwtable
declare i64 @naked_no_mangle() unnamed_addr #1

; a64::naked_plain
; Function Attrs: noinline nounwind uwtable
declare i64 @_RNvCs7Kbsgs9NgSd_3a6411naked_plain() unnamed_addr #1

; a64::naked_private
; Function Attrs: noinline nounwind uwtable
declare hidden i64 @_RNvCs7Kbsgs9NgSd_3a6413naked_private() unnamed_addr #1

attributes #0 = { uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="apple-m1" }
attributes #1 = { noinline nounwind uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="apple-m1" }
attributes #2 = { nounwind }

!llvm.module.flags = !{!4, !5, !6}
!llvm.ident = !{!7}

!0 = !{i64 -8029204499980403853}
!1 = !{i64 -6519782327668001712}
!2 = !{i64 8160923306516583693}
!3 = !{i64 -8836116302723813610}
!4 = !{i32 8, !"PIC Level", i32 2}
!5 = !{i32 7, !"uwtable", i32 2}
!6 = !{i32 7, !"frame-pointer", i32 1}
!7 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!8 = !{i64 4891900147527527145}
!9 = !{i64 -680992565324833211}
!10 = !{i64 3801046057833, i64 3839700763513}
!11 = !{i64 -8042266653763039662}
!12 = !{i64 1245540516118}
!13 = !{i64 8339552379784655556}
!14 = !{i64 3131031159501, i64 3199750636253}
!15 = !{i64 -8604556667679836357}
!16 = !{i64 1915555414450, i64 2040109466062, i64 2130303779307}
