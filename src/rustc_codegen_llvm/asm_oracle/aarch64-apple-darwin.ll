; ModuleID = 'a64.5a35b6fa43f114eb-cgu.0'
source_filename = "a64.5a35b6fa43f114eb-cgu.0"
target datalayout = "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32"
target triple = "arm64-apple-macosx11.0.0"

@SV = global [8 x i8] c"\03\00\00\00\00\00\00\00", align 8, !guid !0
@alloc_22fc7a4f5d7677e959b3a4311efba523 = private unnamed_addr constant [7 x i8] c"a64.rs\00", align 1, !guid !1
@alloc_beb73627508503491c343df029f40820 = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_22fc7a4f5d7677e959b3a4311efba523, [16 x i8] c"\06\00\00\00\00\00\00\00\17\00\00\00V\00\00\00" }>, align 8, !guid !2
@alloc_aefa89f4ebcdc9616a0d424c83aa20f5 = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_22fc7a4f5d7677e959b3a4311efba523, [16 x i8] c"\06\00\00\00\00\00\00\00\18\00\00\00Y\00\00\00" }>, align 8, !guid !3
@alloc_5819d0f9ae29d11cd57822c9e530a9f5 = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_22fc7a4f5d7677e959b3a4311efba523, [16 x i8] c"\06\00\00\00\00\00\00\00%\00\00\00\05\00\00\00" }>, align 8, !guid !4

; core::ptr::drop_glue::<a64::D>
; Function Attrs: uwtable
define void @_RINvNtCsjerMpi2ttlS_4core3ptr9drop_glueNtCs7Kbsgs9NgSd_3a641DEBD_(ptr %_1) unnamed_addr #0 !guid !9 {
start:
; call <a64::D as core::ops::drop::Drop>::drop
  call void @_RNvXCs7Kbsgs9NgSd_3a64NtB2_1DNtNtNtCsjerMpi2ttlS_4core3ops4drop4Drop4drop(ptr %_1)
  ret void
}

; <a64::D as core::ops::drop::Drop>::drop
; Function Attrs: uwtable
define void @_RNvXCs7Kbsgs9NgSd_3a64NtB2_1DNtNtNtCsjerMpi2ttlS_4core3ops4drop4Drop4drop(ptr %self) unnamed_addr #0 !guid !10 {
start:
  ret void
}

; Function Attrs: nounwind uwtable
define void @helper() unnamed_addr #1 !guid !11 {
start:
  ret void
}

; Function Attrs: uwtable
define void @multi_line() unnamed_addr #0 !guid !12 {
start:
  call void asm sideeffect alignstack "nop\0Anop\0Anop $$ 1", "~{cc},~{memory}"(), !srcloc !13
  ret void
}

; Function Attrs: noreturn uwtable
define void @noreturn() unnamed_addr #2 !guid !14 {
start:
  call void asm sideeffect alignstack "brk #0", "~{cc},~{memory}"(), !srcloc !15
  unreachable
}

; Function Attrs: uwtable
define i64 @reg_classes(i64 %a, i32 %b, double %c, float %d, i8 %e, ptr align 16 %v) unnamed_addr #0 !guid !16 {
start:
  %_42 = alloca [16 x i8], align 1
  %p2 = alloca [8 x i8], align 8
  %p1 = alloca [8 x i8], align 8
  %r = alloca [16 x i8], align 16
  %q = alloca [1 x i8], align 1
  %w = alloca [4 x i8], align 4
  %z = alloca [8 x i8], align 8
  %y = alloca [4 x i8], align 4
  %x = alloca [8 x i8], align 8
  store i64 %a, ptr %x, align 8
  %0 = load i64, ptr %x, align 8
  %1 = call i64 asm sideeffect alignstack "add ${0}, ${0}, ${2}", "=&r,0,r,~{cc},~{memory}"(i64 %0, i64 %a), !srcloc !17
  store i64 %1, ptr %x, align 8
  %2 = call i32 asm sideeffect alignstack "mov ${0:w}, ${1:w}", "=&r,r,~{cc},~{memory}"(i32 %b), !srcloc !18
  store i32 %2, ptr %y, align 4
  %3 = call double asm sideeffect alignstack "fmov ${0:d}, ${1:d}", "=&w,w,~{cc},~{memory}"(double %c), !srcloc !19
  store double %3, ptr %z, align 8
  %4 = insertelement <4 x float> undef, float %d, i32 0
  %5 = call float asm sideeffect alignstack "fmov ${0:s}, ${1:s}", "=w,x,~{cc},~{memory}"(<4 x float> %4), !srcloc !20
  store float %5, ptr %w, align 4
  %6 = call i8 asm sideeffect alignstack "mov ${0:w}, ${1:w}", "=&r,r,~{cc},~{memory}"(i8 %e), !srcloc !21
  store i8 %6, ptr %q, align 1
  %7 = load <16 x i8>, ptr %v, align 16
  %8 = call <16 x i8> asm sideeffect alignstack "mov ${0}.16b, ${1}.16b", "=&w,w,~{cc},~{memory}"(<16 x i8> %7), !srcloc !22
  store <16 x i8> %8, ptr %r, align 16
  %9 = call i32 asm sideeffect "mov x1, x2", "=&{w1},{x2}"(i64 %a) #6, !srcloc !23
  %10 = call i64 asm "mov ${0}, 1", "=&r,~{cc}"() #7, !srcloc !24
  store i64 %10, ptr %p1, align 8
  %_14 = load i64, ptr %p1, align 8
  %11 = load i64, ptr %x, align 8
  %_15.0 = add i64 %11, %_14
  %_15.1 = icmp ult i64 %_15.0, %11
  br i1 %_15.1, label %panic, label %bb9

bb9:                                              ; preds = %start
  store i64 %_15.0, ptr %x, align 8
  %12 = call i64 asm "mov ${0}, 2", "=&r,~{cc},~{memory}"() #8, !srcloc !25
  store i64 %12, ptr %p2, align 8
  %_17 = load i64, ptr %p2, align 8
  %13 = load i64, ptr %x, align 8
  %_18.0 = add i64 %13, %_17
  %_18.1 = icmp ult i64 %_18.0, %13
  br i1 %_18.1, label %panic1, label %bb11

panic:                                            ; preds = %start
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsjerMpi2ttlS_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_beb73627508503491c343df029f40820) #9
  unreachable

bb11:                                             ; preds = %bb9
  store i64 %_18.0, ptr %x, align 8
  call void asm sideeffect alignstack "nop", "~{cc},~{memory}"() #10, !srcloc !26
  call void asm sideeffect alignstack "nop", "~{cc}"() #6, !srcloc !27
  %14 = call i64 asm sideeffect alignstack "ldr ${0}, [${1}]", "=&r,r,~{cc},~{memory}"(ptr @SV), !srcloc !28
  store i64 %14, ptr %x, align 8
  %15 = call i32 asm sideeffect alignstack "adrp ${0}, ${1:c}", "=&r,s,~{cc},~{memory}"(ptr @SV), !srcloc !29
  %16 = call i32 asm sideeffect alignstack "mov ${0}, #42", "=&r,~{cc},~{memory}"(), !srcloc !30
  %17 = call { i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64>, <2 x i64> } asm sideeffect alignstack "bl ${51:c}", "={w0},={w1},={w2},={w3},={w4},={w5},={w6},={w7},={w8},={w9},={w10},={w11},={w12},={w13},={w14},={w15},={w16},={w17},={w30},={q0},={q1},={q2},={q3},={q4},={q5},={q6},={q7},={q8},={q9},={q10},={q11},={q12},={q13},={q14},={q15},={q16},={q17},={q18},={q19},={q20},={q21},={q22},={q23},={q24},={q25},={q26},={q27},={q28},={q29},={q30},={q31},s,~{p0},~{p1},~{p2},~{p3},~{p4},~{p5},~{p6},~{p7},~{p8},~{p9},~{p10},~{p11},~{p12},~{p13},~{p14},~{p15},~{ffr},~{cc},~{memory}"(ptr @helper), !srcloc !31
  %18 = call i32 asm sideeffect alignstack "mov x30, x30", "=&{w30},{d3},~{cc},~{memory}"(double %c), !srcloc !32
  %_21 = load i64, ptr %x, align 8
  %19 = call i64 asm sideeffect alignstack "mov ${0}, ${2}", "=&r,0,r,~{cc},~{memory}"(i64 %_21, i64 1), !srcloc !33
  %20 = load i64, ptr %x, align 8
  %21 = call i64 asm sideeffect alignstack "mov ${0}, ${2}", "=&r,0,r,~{cc},~{memory}"(i64 %20, i64 1), !srcloc !34
  store i64 %21, ptr %x, align 8
  %22 = load i64, ptr %x, align 8
  %23 = call i64 asm sideeffect alignstack "mov x5, ${1}", "=&{x5},r,0,~{cc},~{memory}"(i64 2, i64 %22), !srcloc !35
  store i64 %23, ptr %x, align 8
  %_22 = zext i8 %e to i64
  %24 = call i64 asm sideeffect alignstack "mov ${0:x}, ${1}", "=&r,r,~{cc},~{memory}"(i64 %_22), !srcloc !36
  store i64 %24, ptr %x, align 8
  %_27 = load i64, ptr %x, align 8
  %_29 = load i32, ptr %y, align 4
  %_28 = zext i32 %_29 to i64
  %_30.0 = add i64 %_27, %_28
  %_30.1 = icmp ult i64 %_30.0, %_27
  br i1 %_30.1, label %panic2, label %bb23

panic1:                                           ; preds = %bb9
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsjerMpi2ttlS_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_aefa89f4ebcdc9616a0d424c83aa20f5) #9
  unreachable

bb23:                                             ; preds = %bb11
  %_32 = load double, ptr %z, align 8
  %_31 = call i64 @llvm.fptoui.sat.i64.f64(double %_32)
  %_33.0 = add i64 %_30.0, %_31
  %_33.1 = icmp ult i64 %_33.0, %_30.0
  br i1 %_33.1, label %panic3, label %bb24

panic2:                                           ; preds = %bb11
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsjerMpi2ttlS_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_5819d0f9ae29d11cd57822c9e530a9f5) #9
  unreachable

bb24:                                             ; preds = %bb23
  %_35 = load float, ptr %w, align 4
  %_34 = call i64 @llvm.fptoui.sat.i64.f32(float %_35)
  %_36.0 = add i64 %_33.0, %_34
  %_36.1 = icmp ult i64 %_36.0, %_33.0
  br i1 %_36.1, label %panic4, label %bb25

panic3:                                           ; preds = %bb23
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsjerMpi2ttlS_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_5819d0f9ae29d11cd57822c9e530a9f5) #9
  unreachable

bb25:                                             ; preds = %bb24
  %_38 = load i8, ptr %q, align 1
  %_37 = zext i8 %_38 to i64
  %_39.0 = add i64 %_36.0, %_37
  %_39.1 = icmp ult i64 %_39.0, %_36.0
  br i1 %_39.1, label %panic5, label %bb26

panic4:                                           ; preds = %bb24
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsjerMpi2ttlS_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_5819d0f9ae29d11cd57822c9e530a9f5) #9
  unreachable

bb26:                                             ; preds = %bb25
  %_43 = load <16 x i8>, ptr %r, align 16
  store <16 x i8> %_43, ptr %_42, align 1
  %25 = getelementptr inbounds nuw i8, ptr %_42, i64 0
  %_41 = load i8, ptr %25, align 1
  %_40 = zext i8 %_41 to i64
  %_46.0 = add i64 %_39.0, %_40
  %_46.1 = icmp ult i64 %_46.0, %_39.0
  br i1 %_46.1, label %panic6, label %bb28

panic5:                                           ; preds = %bb25
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsjerMpi2ttlS_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_5819d0f9ae29d11cd57822c9e530a9f5) #9
  unreachable

bb28:                                             ; preds = %bb26
  ret i64 %_46.0

panic6:                                           ; preds = %bb26
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsjerMpi2ttlS_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_5819d0f9ae29d11cd57822c9e530a9f5) #9
  unreachable
}

; Function Attrs: uwtable
define void @unwind_call() unnamed_addr #0 !guid !37 {
start:
  call void asm sideeffect alignstack unwind "", "~{cc},~{memory}"(), !srcloc !38
  ret void
}

; Function Attrs: uwtable
define void @unwind_invoke() unnamed_addr #0 personality ptr @rust_eh_personality !guid !39 {
start:
  %0 = alloca [16 x i8], align 8
  %_1 = alloca [0 x i8], align 1
  invoke void asm sideeffect alignstack unwind "", "~{cc},~{memory}"()
          to label %bb1 unwind label %cleanup, !srcloc !40

bb3:                                              ; preds = %cleanup
; invoke core::ptr::drop_glue::<a64::D>
  invoke void @_RINvNtCsjerMpi2ttlS_4core3ptr9drop_glueNtCs7Kbsgs9NgSd_3a641DEBD_(ptr %_1) #11
          to label %bb4 unwind label %terminate

cleanup:                                          ; preds = %start
  %1 = landingpad { ptr, i32 }
          cleanup
  %2 = extractvalue { ptr, i32 } %1, 0
  %3 = extractvalue { ptr, i32 } %1, 1
  store ptr %2, ptr %0, align 8
  %4 = getelementptr inbounds i8, ptr %0, i64 8
  store i32 %3, ptr %4, align 8
  br label %bb3

bb1:                                              ; preds = %start
; call core::ptr::drop_glue::<a64::D>
  call void @_RINvNtCsjerMpi2ttlS_4core3ptr9drop_glueNtCs7Kbsgs9NgSd_3a641DEBD_(ptr %_1)
  ret void

terminate:                                        ; preds = %bb3
  %5 = landingpad { ptr, i32 }
          filter [0 x ptr] zeroinitializer
; call core::panicking::panic_in_cleanup
  call void @_RNvNtCsjerMpi2ttlS_4core9panicking16panic_in_cleanup() #12
  unreachable

bb4:                                              ; preds = %bb3
  %6 = load ptr, ptr %0, align 8
  %7 = getelementptr inbounds i8, ptr %0, i64 8
  %8 = load i32, ptr %7, align 8
  %9 = insertvalue { ptr, i32 } poison, ptr %6, 0
  %10 = insertvalue { ptr, i32 } %9, i32 %8, 1
  resume { ptr, i32 } %10
}

; core::panicking::panic_const::panic_const_add_overflow
; Function Attrs: cold noinline noreturn uwtable
declare void @_RNvNtNtCsjerMpi2ttlS_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8) unnamed_addr #3

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.fptoui.sat.i64.f64(double) #4

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.fptoui.sat.i64.f32(float) #4

; Function Attrs: nounwind uwtable
declare i32 @rust_eh_personality(i32, i32, i64, ptr, ptr) unnamed_addr #1

; core::panicking::panic_in_cleanup
; Function Attrs: cold minsize noinline noreturn nounwind optsize uwtable
declare void @_RNvNtCsjerMpi2ttlS_4core9panicking16panic_in_cleanup() unnamed_addr #5

attributes #0 = { uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="apple-m1" }
attributes #1 = { nounwind uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="apple-m1" }
attributes #2 = { noreturn uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="apple-m1" }
attributes #3 = { cold noinline noreturn uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="apple-m1" }
attributes #4 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #5 = { cold minsize noinline noreturn nounwind optsize uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="apple-m1" }
attributes #6 = { memory(inaccessiblemem: readwrite) }
attributes #7 = { willreturn memory(none) }
attributes #8 = { willreturn memory(read) }
attributes #9 = { noreturn }
attributes #10 = { memory(read, inaccessiblemem: readwrite) }
attributes #11 = { cold }
attributes #12 = { cold noreturn nounwind }

!llvm.module.flags = !{!5, !6, !7}
!llvm.ident = !{!8}

!0 = !{i64 7462440121104761555}
!1 = !{i64 6357305709385121890}
!2 = !{i64 -676204896490065161}
!3 = !{i64 -1155234471528530761}
!4 = !{i64 6823276640846495849}
!5 = !{i32 8, !"PIC Level", i32 2}
!6 = !{i32 7, !"uwtable", i32 2}
!7 = !{i32 7, !"frame-pointer", i32 1}
!8 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!9 = !{i64 -7677180984738321143}
!10 = !{i64 -3962685970045260502}
!11 = !{i64 -5349029530527406595}
!12 = !{i64 -8581185880840515592}
!13 = !{i64 9698036156623, i64 9728100927702, i64 9775345567965}
!14 = !{i64 -1629280274659692993}
!15 = !{i64 10114647984429}
!16 = !{i64 -661382045581839584}
!17 = !{i64 3427383902989}
!18 = !{i64 3680786973513}
!19 = !{i64 3929895076738}
!20 = !{i64 4187593114558}
!21 = !{i64 4483945858052}
!22 = !{i64 4763118732349}
!23 = !{i64 4990751999104}
!24 = !{i64 5454608467180}
!25 = !{i64 5858335393098}
!26 = !{i64 6189047874974}
!27 = !{i64 6360846566854}
!28 = !{i64 6567004997099}
!29 = !{i64 6850472838702}
!30 = !{i64 7069516170849}
!31 = !{i64 7267084666518}
!32 = !{i64 7524782704332}
!33 = !{i64 7765300872964}
!34 = !{i64 8035883812675}
!35 = !{i64 8280696948605}
!36 = !{i64 8542689953719}
!37 = !{i64 6412824117330435609}
!38 = !{i64 10724533340609}
!39 = !{i64 -5490334316663632464}
!40 = !{i64 11162620004903}
