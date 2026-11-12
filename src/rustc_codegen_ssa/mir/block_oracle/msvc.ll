; ModuleID = 'block.5f01549d810e38c7-cgu.0'
source_filename = "block.5f01549d810e38c7-cgu.0"
target datalayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-pc-windows-msvc"

@alloc_25bed4179d008cfd4477b0632e84ebf6 = private unnamed_addr constant [101 x i8] c"/Users/tomernorman/.t3/worktrees/rust-ts/t3-a29c7b43/src/rustc_codegen_ssa/mir/block_oracle/block.rs\00", align 1, !guid !0
@alloc_33cf5c5d403022e1412a38d6b2ae29e8 = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_25bed4179d008cfd4477b0632e84ebf6, [16 x i8] c"d\00\00\00\00\00\00\00/\00\00\00\09\00\00\00" }>, align 8, !guid !1
@alloc_8018e073b439d6aa08c9eb9fb34d44ce = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_25bed4179d008cfd4477b0632e84ebf6, [16 x i8] c"d\00\00\00\00\00\00\00\92\00\00\00\05\00\00\00" }>, align 8, !guid !2

; block::drop_glue::<block::D>
; Function Attrs: uwtable
define void @_RINvCs89I2US0CO3P_5block9drop_glueNtB2_1DEB2_(ptr %_1) unnamed_addr #0 !guid !6 {
start:
; call <block::D as block::Drop>::drop
  call void @_RNvXs6_Cs89I2US0CO3P_5blockNtB5_1DNtB5_4Drop4drop(ptr align 4 %_1)
  ret void
}

; block::panic_in_cleanup
; Function Attrs: noreturn uwtable
define void @_RNvCs89I2US0CO3P_5block16panic_in_cleanup() unnamed_addr #1 !guid !7 {
start:
  br label %bb1

bb1:                                              ; preds = %bb1, %start
  br label %bb1
}

; block::panic_cannot_unwind
; Function Attrs: noreturn uwtable
define void @_RNvCs89I2US0CO3P_5block19panic_cannot_unwind() unnamed_addr #1 !guid !8 {
start:
  br label %bb1

bb1:                                              ; preds = %bb1, %start
  br label %bb1
}

; block::panic_const_add_overflow
; Function Attrs: noreturn uwtable
define void @_RNvCs89I2US0CO3P_5block24panic_const_add_overflow(ptr align 8 %0) unnamed_addr #1 !guid !9 {
start:
  br label %bb1

bb1:                                              ; preds = %bb1, %start
  br label %bb1
}

; <u32 as block::Add>::add
; Function Attrs: uwtable
define i32 @_RNvXs4_Cs89I2US0CO3P_5blockmNtB5_3Add3add(i32 %self, i32 %rhs) unnamed_addr #0 !guid !10 {
start:
  %_3.0 = add i32 %self, %rhs
  %_3.1 = icmp ult i32 %_3.0, %self
  br i1 %_3.1, label %panic, label %bb1

bb1:                                              ; preds = %start
  ret i32 %_3.0

panic:                                            ; preds = %start
; call block::panic_const_add_overflow
  call void @_RNvCs89I2US0CO3P_5block24panic_const_add_overflow(ptr align 8 @alloc_33cf5c5d403022e1412a38d6b2ae29e8) #4
  unreachable
}

; <block::D as block::Drop>::drop
; Function Attrs: uwtable
define void @_RNvXs6_Cs89I2US0CO3P_5blockNtB5_1DNtB5_4Drop4drop(ptr align 4 %self) unnamed_addr #0 !guid !11 {
start:
  ret void
}

; Function Attrs: uwtable
define i32 @add_u32(i32 %a, i32 %b) unnamed_addr #0 !guid !12 {
start:
  %_3.0 = add i32 %a, %b
  %_3.1 = icmp ult i32 %_3.0, %a
  br i1 %_3.1, label %panic, label %bb1

bb1:                                              ; preds = %start
  ret i32 %_3.0

panic:                                            ; preds = %start
; call block::panic_const_add_overflow
  call void @_RNvCs89I2US0CO3P_5block24panic_const_add_overflow(ptr align 8 @alloc_8018e073b439d6aa08c9eb9fb34d44ce) #4
  unreachable
}

; Function Attrs: uwtable
define i32 @call_copy(i32 %x, ptr align 8 %b) unnamed_addr #0 !guid !13 {
start:
  %_3 = alloca [32 x i8], align 8
  call void @llvm.memcpy.p0.p0.i64(ptr align 8 %_3, ptr align 8 %b, i64 32, i1 false)
  %_0 = call i32 @callee(i32 %x, ptr align 8 %_3)
  ret i32 %_0
}

; Function Attrs: uwtable
define i32 @call_move(i32 %x, ptr align 8 %b) unnamed_addr #0 !guid !14 {
start:
  %0 = alloca [32 x i8], align 8
  call void @llvm.memcpy.p0.p0.i64(ptr align 8 %0, ptr align 8 %b, i64 32, i1 false)
  %_0 = call i32 @callee(i32 %x, ptr align 8 %0)
  ret i32 %_0
}

; Function Attrs: uwtable
define void @drop_one(i32 %0) unnamed_addr #0 !guid !15 {
start:
  %d = alloca [4 x i8], align 4
  store i32 %0, ptr %d, align 4
; call block::drop_glue::<block::D>
  call void @_RINvCs89I2US0CO3P_5block9drop_glueNtB2_1DEB2_(ptr %d)
  ret void
}

; Function Attrs: uwtable
define void @drop_two(i32 %0, i32 %1) unnamed_addr #0 personality ptr @__CxxFrameHandler3 !guid !16 {
start:
  %b = alloca [4 x i8], align 4
  %a = alloca [4 x i8], align 4
  store i32 %0, ptr %a, align 4
  store i32 %1, ptr %b, align 4
; invoke block::drop_glue::<block::D>
  invoke void @_RINvCs89I2US0CO3P_5block9drop_glueNtB2_1DEB2_(ptr %b)
          to label %bb1 unwind label %funclet_bb3

bb3:                                              ; preds = %funclet_bb3
; call block::drop_glue::<block::D>
  call void @_RINvCs89I2US0CO3P_5block9drop_glueNtB2_1DEB2_(ptr %a) #5 [ "funclet"(token %cleanuppad) ]
  cleanupret from %cleanuppad unwind to caller

funclet_bb3:                                      ; preds = %start
  %cleanuppad = cleanuppad within none []
  br label %bb3

bb1:                                              ; preds = %start
; call block::drop_glue::<block::D>
  call void @_RINvCs89I2US0CO3P_5block9drop_glueNtB2_1DEB2_(ptr %a)
  ret void
}

; Function Attrs: uwtable
define i48 @ret_cast(i48 %0) unnamed_addr #0 !guid !17 {
start:
  %_0 = alloca [8 x i8], align 2
  %1 = alloca [8 x i8], align 8
  %t = alloca [6 x i8], align 2
  store i48 %0, ptr %1, align 8
  call void @llvm.memcpy.p0.p0.i64(ptr align 2 %t, ptr align 8 %1, i64 6, i1 false)
  call void @llvm.memcpy.p0.p0.i64(ptr align 2 %_0, ptr align 2 %t, i64 6, i1 false)
  %2 = load i48, ptr %_0, align 2
  ret i48 %2
}

; Function Attrs: uwtable
define i32 @ret_direct(i32 %x) unnamed_addr #0 !guid !18 {
start:
  ret i32 %x
}

; Function Attrs: uwtable
define void @ret_indirect(ptr sret([32 x i8]) align 8 %_0, ptr align 8 %b) unnamed_addr #0 !guid !19 {
start:
  call void @llvm.memcpy.p0.p0.i64(ptr align 8 %_0, ptr align 8 %b, i64 32, i1 false)
  ret void
}

; Function Attrs: uwtable
define { i32, i32 } @ret_pair(i32 %x, i32 %y) unnamed_addr #0 !guid !20 {
start:
  %0 = insertvalue { i32, i32 } poison, i32 %x, 0
  %1 = insertvalue { i32, i32 } %0, i32 %y, 1
  ret { i32, i32 } %1
}

; Function Attrs: uwtable
define i32 @sw_bool(i1 zeroext %b) unnamed_addr #0 !guid !21 {
start:
  %_0 = alloca [4 x i8], align 4
  br i1 %b, label %bb1, label %bb2

bb2:                                              ; preds = %start
  store i32 20, ptr %_0, align 4
  br label %bb3

bb1:                                              ; preds = %start
  store i32 10, ptr %_0, align 4
  br label %bb3

bb3:                                              ; preds = %bb1, %bb2
  %0 = load i32, ptr %_0, align 4
  ret i32 %0
}

; Function Attrs: uwtable
define i32 @sw_int(i32 %x) unnamed_addr #0 !guid !22 {
start:
  %_0 = alloca [4 x i8], align 4
  switch i32 %x, label %bb1 [
    i32 1, label %bb4
    i32 5, label %bb3
    i32 9, label %bb2
  ]

bb1:                                              ; preds = %start
  store i32 0, ptr %_0, align 4
  br label %bb5

bb4:                                              ; preds = %start
  store i32 10, ptr %_0, align 4
  br label %bb5

bb3:                                              ; preds = %start
  store i32 50, ptr %_0, align 4
  br label %bb5

bb2:                                              ; preds = %start
  store i32 90, ptr %_0, align 4
  br label %bb5

bb5:                                              ; preds = %bb1, %bb2, %bb3, %bb4
  %0 = load i32, ptr %_0, align 4
  ret i32 %0
}

; Function Attrs: uwtable
define i32 @sw_one(i32 %x) unnamed_addr #0 !guid !23 {
start:
  %_0 = alloca [4 x i8], align 4
  %0 = icmp eq i32 %x, 7
  br i1 %0, label %bb2, label %bb1

bb2:                                              ; preds = %start
  store i32 1, ptr %_0, align 4
  br label %bb3

bb1:                                              ; preds = %start
  store i32 2, ptr %_0, align 4
  br label %bb3

bb3:                                              ; preds = %bb1, %bb2
  %1 = load i32, ptr %_0, align 4
  ret i32 %1
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #2

; Function Attrs: uwtable
declare i32 @callee(i32, ptr align 8) unnamed_addr #0

declare i32 @__CxxFrameHandler3(...) unnamed_addr #3

attributes #0 = { uwtable "target-cpu"="x86-64" "target-features"="+cx16,+sse,+sse2,+sse3,+sahf" }
attributes #1 = { noreturn uwtable "target-cpu"="x86-64" "target-features"="+cx16,+sse,+sse2,+sse3,+sahf" }
attributes #2 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }
attributes #3 = { "target-cpu"="x86-64" }
attributes #4 = { noreturn }
attributes #5 = { cold }

!llvm.module.flags = !{!3, !4}
!llvm.ident = !{!5}

!0 = !{i64 1814869321277227270}
!1 = !{i64 3202298266623256630}
!2 = !{i64 7552692177077709414}
!3 = !{i32 8, !"PIC Level", i32 2}
!4 = !{i32 7, !"uwtable", i32 2}
!5 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!6 = !{i64 29432607635363621}
!7 = !{i64 2443569440316965416}
!8 = !{i64 5120228888801430929}
!9 = !{i64 -3981118791874703786}
!10 = !{i64 4678982886090426383}
!11 = !{i64 29435476791891269}
!12 = !{i64 1549116562019396878}
!13 = !{i64 4520484608564638732}
!14 = !{i64 4912896266676131356}
!15 = !{i64 6467782483441543979}
!16 = !{i64 -1688083960688983038}
!17 = !{i64 7905635933206587346}
!18 = !{i64 6711172481472684736}
!19 = !{i64 2577710138491247552}
!20 = !{i64 -3035268383016468360}
!21 = !{i64 4202637832380139677}
!22 = !{i64 -3235884174390088799}
!23 = !{i64 4410534068971731308}
