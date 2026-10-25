#include "include/SubSyncNative.h"
#include "synchro/synchronizer.h"
#include <cmath>
#include <new>

struct SS2Synchronizer {
    // Canonical defaults from web/src/settings.js. Never relax for iOS.
    Synchronizer engine{1800.0f, 0.9999, 2.0f, 20, 0.6f};
};

uint32_t ss2_abi_version(void) { return 1; }

SS2Synchronizer *ss2_create(void) {
    try { return new SS2Synchronizer(); }
    catch (...) { return nullptr; }
}

void ss2_destroy(SS2Synchronizer *context) { delete context; }

int ss2_add_subtitle(SS2Synchronizer *context, double start, double end) {
    if (!context || !std::isfinite(start) || !std::isfinite(end) || end < start) return -1;
    try { context->engine.addSubtitle(start, end); return 0; }
    catch (...) { return -2; }
}

int ss2_add_word(SS2Synchronizer *context, int reference, float time, float duration, const char *text) {
    if (!context || !text || !*text || !std::isfinite(time)
            || !std::isfinite(duration) || duration < 0 || (reference != 0 && reference != 1)) return -1;
    try {
        const Word word(text, time, duration);
        if (reference) context->engine.addRefWord(word);
        else context->engine.addSubWord(word);
        return 0;
    } catch (...) { return -2; }
}

int ss2_get_stats(SS2Synchronizer *context, SS2Stats *output) {
    if (!context || !output) return -1;
    try {
        const auto stats = context->engine.correlate();
        const bool finite = std::isfinite(stats.formula.a) && std::isfinite(stats.formula.b)
            && std::isfinite(stats.factor) && std::isfinite(stats.maxDistance);
        // Empty evidence can contain a nonfinite provisional fit. It is never
        // export-eligible, even if a future caller misreads the status fields.
        *output = {stats.correlated && finite, stats.points,
            finite ? stats.factor : 0.0, finite ? stats.maxDistance : 0.0,
            finite ? stats.formula.a : 1.0, finite ? stats.formula.b : 0.0};
        return 0;
    } catch (...) { *output = {}; return -2; }
}
