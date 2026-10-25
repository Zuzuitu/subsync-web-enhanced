#ifndef SUBSYNC2_MEDIA_H
#define SUBSYNC2_MEDIA_H
#include "SubSyncNative.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct SS2Media SS2Media;
typedef struct {
    double duration;
    double position;
    uint64_t reference_words;
    uint64_t subtitle_words;
    uint64_t cues;
    int done;
    SS2Stats fit;
} SS2MediaStatus;
typedef struct { int number; char language[32]; char codec[64]; } SS2AudioStream;

SS2Media *ss2_media_create(void);
void ss2_media_destroy(SS2Media *context);
// Only cancel is thread-safe. Destroy only after the worker has returned.
void ss2_media_cancel(SS2Media *context);
int ss2_media_set_param(SS2Media *context, const char *key, const char *value);
int ss2_media_open(SS2Media *context, const char *subtitle, const char *reference, const char *dictionary);
int ss2_media_audio_count(SS2Media *context);
int ss2_media_audio_info(SS2Media *context, int index, SS2AudioStream *stream);
// -1 selects the unique English stream, or the only audio stream. Ambiguity fails.
int ss2_media_start(SS2Media *context, int stream, int sample_rate);
// Returns 0 on progress, 1 on finished (possibly inconclusive), -2 on cancellation.
int ss2_media_step(SS2Media *context, int milliseconds, SS2MediaStatus *status);
// Stable stage/category only, no movie paths, words or raw exception dumps.
int ss2_media_error_stage(SS2Media *context);
#ifdef __cplusplus
}
#endif
#endif
