#ifndef SUBSYNC2_NATIVE_H
#define SUBSYNC2_NATIVE_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

// GPLv3: adapter to the SAME gizmo sources compiled by the browser WASM build.
// Contexts are thread-confined. No FFmpeg/ASR or complete movie sync here yet.
typedef struct SS2Synchronizer SS2Synchronizer;
typedef struct {
    int correlated;
    uint32_t points;
    double factor;
    double max_distance;
    double a;
    double b;
} SS2Stats;

uint32_t ss2_abi_version(void);
SS2Synchronizer *ss2_create(void);
void ss2_destroy(SS2Synchronizer *context);
int ss2_add_subtitle(SS2Synchronizer *context, double start, double end);
int ss2_add_word(SS2Synchronizer *context, int reference, float time, float duration, const char *text);
int ss2_get_stats(SS2Synchronizer *context, SS2Stats *output);

#ifdef __cplusplus
}
#endif
#endif
