#include "include/SubSyncMedia.h"
#include "synchro/synchronizer.h"
#include "media/demux.h"
#include "media/audiodec.h"
#include "media/resampler.h"
#include "media/speechrec.h"
#include "media/subdec.h"
#include "text/dictionary.h"
#include "text/translator.h"
#include "text/utf8.h"
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <vector>

struct SS2Media {
    Synchronizer sync{1800.0f, 0.9999, 2.0f, 20, 0.6f};
    CorrelationStats selected;
    std::atomic<bool> cancelled{false};
    std::shared_ptr<SpeechRecognition> speech = std::make_shared<SpeechRecognition>();
    std::shared_ptr<Resampler> resampler = std::make_shared<Resampler>();
    std::shared_ptr<AudioDec> audio = std::make_shared<AudioDec>();
    std::shared_ptr<SubtitleDec> subdec = std::make_shared<SubtitleDec>();
    std::unique_ptr<Demux> sub, ref;
    std::shared_ptr<Dictionary> dictionary;
    std::shared_ptr<Translator> translator;
    std::vector<StreamFormat> tracks;
    uint64_t refWords = 0, subWords = 0, cues = 0;
    int stage = 0;
    bool audioStarted = false, subtitleStarted = false, started = false, done = false;

    void select() {
        const auto candidate = sync.correlate();
        // Same rule as web/src/correlation-status.js; don't lose a valid lock
        // when a later provisional fit is not canonically accepted.
        if (candidate.correlated || !selected.correlated) selected = candidate;
    }
    void check() { if (cancelled.load()) throw std::runtime_error("cancelled"); }
    ~SS2Media() {
        if (audioStarted) { try { audio->stop(); } catch (...) {} }
        if (subtitleStarted) { try { subdec->stop(); } catch (...) {} }
    }
};

static bool localPath(const char *path) { return path && path[0] == '/' && !std::strstr(path, "://"); }

SS2Media *ss2_media_create(void) {
    try { return new SS2Media(); } catch (...) { return nullptr; }
}
void ss2_media_destroy(SS2Media *c) { delete c; }
void ss2_media_cancel(SS2Media *c) { if (c) c->cancelled.store(true); }
int ss2_media_error_stage(SS2Media *c) { return c ? c->stage : 0; }
int ss2_media_set_param(SS2Media *c, const char *key, const char *value) {
    if (!c || !key || !value || c->started) return -1;
    try { c->speech->setParam(key, value); return 0; } catch (...) { c->stage = 1; return -1; }
}

int ss2_media_open(SS2Media *c, const char *subtitle, const char *reference, const char *dictionary) {
    if (!c || c->ref || !localPath(subtitle) || !localPath(reference) || !localPath(dictionary)) return -1;
    try {
        c->stage = 2;
        c->check();
        c->dictionary = std::make_shared<Dictionary>();
        std::ifstream file(dictionary);
        if (!file) throw std::runtime_error("dictionary");
        std::string line;
        while (std::getline(file, line)) {
            c->check();
            if (line.empty() || line[0] == '#') continue;
            const size_t split = line.find('|');
            if (split == std::string::npos) continue;
            const std::string english = line.substr(0, split);
            if (Utf8::size(english) < 5) continue;
            size_t begin = split + 1;
            while (begin <= line.size()) {
                const size_t end = line.find('|', begin);
                const auto romanian = line.substr(begin, end == std::string::npos ? end : end - begin);
                if (Utf8::size(romanian) >= 5) c->dictionary->add(Utf8::toLower(romanian), english);
                if (end == std::string::npos) break;
                begin = end + 1;
            }
        }
        if (c->dictionary->size() == 0) throw std::runtime_error("empty dictionary");
        c->translator = std::make_shared<Translator>(c->dictionary);
        c->translator->setMinWordsSim(0.6f);
        c->translator->addWordsListener([c](const Word &w) {
            c->check(); c->subWords++;
            if (c->sync.addSubWord(w)) c->select();
        });
        c->subdec->setMinWordLen(5);
        c->subdec->setEncoding("UTF-8");
        c->subdec->addWordsListener([c](const Word &w) { c->translator->pushWord(w); });
        c->subdec->addSubsListener([c](double start, double end, const std::string &text) {
            if (text.compare(0, 13, "[Script Info]") != 0) { c->sync.addSubtitle(start, end); c->cues++; }
        });
        c->speech->setParam("-mmap", "0");
        c->speech->setMinWordProb(0.3f);
        c->speech->setMinWordLen(5);
        c->speech->addWordsListener([c](const Word &w) {
            c->check(); c->refWords++;
            if (c->sync.addRefWord(w)) c->select();
        });
        c->stage = 3;
        c->sub.reset(new Demux(subtitle, [c] { return !c->cancelled.load(); }));
        int subStream = -1;
        for (const auto &s : c->sub->getStreamsInfo()) if (s.type == "subtitle/text") { subStream = s.no; break; }
        if (subStream < 0) throw std::runtime_error("no subtitles");
        c->sub->connectDec(c->subdec, subStream);
        c->subtitleStarted = true;
        c->sub->start();
        while (c->sub->step()) c->check();
        c->sub->stop(); c->subtitleStarted = false;
        if (!c->cues || !c->subWords) throw std::runtime_error("no subtitle evidence");
        c->stage = 4;
        c->ref.reset(new Demux(reference, [c] { return !c->cancelled.load(); }));
        for (const auto &s : c->ref->getStreamsInfo()) if (s.type == "audio") c->tracks.push_back(s);
        if (c->tracks.empty()) throw std::runtime_error("no audio");
        c->check(); c->stage = 0; return 0;
    } catch (...) { return c->cancelled.load() ? -2 : -1; }
}

int ss2_media_audio_count(SS2Media *c) { return c ? static_cast<int>(c->tracks.size()) : -1; }
int ss2_media_audio_info(SS2Media *c, int index, SS2AudioStream *stream) {
    if (!c || !stream || index < 0 || static_cast<size_t>(index) >= c->tracks.size()) return -1;
    const auto &s = c->tracks[index];
    *stream = {};
    stream->number = s.no;
    std::snprintf(stream->language, sizeof(stream->language), "%s", s.lang.c_str());
    std::snprintf(stream->codec, sizeof(stream->codec), "%s", s.codec.c_str());
    return 0;
}
int ss2_media_start(SS2Media *c, int stream, int sampleRate) {
    if (!c || !c->ref || c->started || sampleRate < 8000 || sampleRate > 48000) return -1;
    try {
        c->stage = 5; c->check();
        if (stream == -1) {
            int english = 0;
            for (const auto &s : c->tracks) if (s.lang == "eng" || s.lang == "en") { english++; stream = s.no; }
            if (english != 1) {
                if (c->tracks.size() != 1) throw std::runtime_error("ambiguous audio track");
                stream = c->tracks[0].no;
            }
        }
        bool found = false;
        for (const auto &s : c->tracks) if (static_cast<int>(s.no) == stream) found = true;
        if (!found) throw std::runtime_error("invalid audio track");
        c->audio->connectOutput(c->resampler);
        // Match gizmo/wasm/extractor.cpp::resamplerConnectOutput exactly,
        // including its one-channel layout value (1), not an alternate remix.
        c->resampler->connectOutput(c->speech, AudioFormat(AV_SAMPLE_FMT_S16, sampleRate, 1), 32 * 1024);
        c->ref->connectDec(c->audio, stream);
        c->audioStarted = true;
        c->ref->start();
        c->started = true; c->check(); c->stage = 0; return 0;
    } catch (...) { return c->cancelled.load() ? -2 : -1; }
}

int ss2_media_step(SS2Media *c, int milliseconds, SS2MediaStatus *out) {
    if (!c || !out || !c->started || milliseconds < 1 || milliseconds > 2000) return -1;
    try {
        c->stage = 6; c->check();
        const auto start = std::chrono::steady_clock::now();
        while (!c->done) {
            c->check();
            if (!c->ref->step()) {
                c->ref->stop(); c->audioStarted = false; c->done = true; c->select(); break;
            }
            if (std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count() >= milliseconds) break;
        }
        c->check();
        const auto &s = c->selected;
        const bool finite = std::isfinite(s.formula.a) && std::isfinite(s.formula.b)
            && std::isfinite(s.factor) && std::isfinite(s.maxDistance);
        *out = {c->ref->getDuration(), c->ref->getPosition(), c->refWords, c->subWords, c->cues,
            c->done, {s.correlated && finite, s.points, finite ? s.factor : 0.0,
            finite ? s.maxDistance : 0.0, finite ? s.formula.a : 1.0, finite ? s.formula.b : 0.0}};
        c->stage = 0;
        return c->done ? 1 : 0;
    } catch (...) { *out = {}; return c->cancelled.load() ? -2 : -1; }
}
