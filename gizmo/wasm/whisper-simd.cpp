#include <whisper.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace em = emscripten;
using namespace std;

namespace {
const int SAMPLE_RATE = WHISPER_SAMPLE_RATE;
const size_t CHUNK_SAMPLES = 30 * SAMPLE_RATE;
const size_t MIN_FINAL_SAMPLES = SAMPLE_RATE;

string trimWord(string word) {
    while (!word.empty() && isspace(static_cast<unsigned char>(word.front()))) {
        word.erase(word.begin());
    }
    while (!word.empty() && isspace(static_cast<unsigned char>(word.back()))) {
        word.pop_back();
    }
    while (!word.empty()) {
        const unsigned char ch = static_cast<unsigned char>(word.front());
        if (ch >= 0x80 || isalnum(ch)) break;
        word.erase(word.begin());
    }
    while (!word.empty()) {
        const unsigned char ch = static_cast<unsigned char>(word.back());
        if (ch >= 0x80 || isalnum(ch)) break;
        word.pop_back();
    }
    return word;
}

bool isSpecialToken(const string &text) {
    return text.size() >= 3 && text[0] == '<' && text[1] == '|';
}

size_t utf8Length(const string &text) {
    size_t count = 0;
    for (unsigned char ch : text) {
        if ((ch & 0xC0) != 0x80) ++count;
    }
    return count;
}
}

class RomanianWhisperRecognition {
public:
    RomanianWhisperRecognition() :
        m_whisper(nullptr),
        m_language("ro"),
        m_chunkStartTime(-1.0),
        m_minProb(1.0f),
        m_minLen(0),
        m_wordsCallback(em::val::undefined()),
        m_hasWordsCallback(false) {}

    ~RomanianWhisperRecognition() {
        if (m_whisper) {
            whisper_free(m_whisper);
            m_whisper = nullptr;
        }
    }

    void loadModel(const em::val &bytes) {
        const size_t size = bytes["length"].as<size_t>();
        if (!size) throw runtime_error("Romanian Whisper model is empty");

        vector<uint8_t> buffer(size);
        em::val view = em::val(emscripten::typed_memory_view(buffer.size(), buffer.data()));
        view.call<void>("set", bytes);

        if (m_whisper) {
            whisper_free(m_whisper);
            m_whisper = nullptr;
        }

        whisper_context_params params = whisper_context_default_params();
        params.use_gpu = false;
        m_whisper = whisper_init_from_buffer_with_params(buffer.data(), buffer.size(), params);
        if (!m_whisper) {
            throw runtime_error("can't initialize Romanian Whisper model");
        }
        resetAudio();
    }

    void setLanguage(const string &language) { m_language = language; }
    void setMinWordProb(float minProb) { m_minProb = minProb; }
    void setMinWordLen(unsigned minLen) { m_minLen = minLen; }

    void setWordsCallback(const em::val &callback) {
        m_wordsCallback = callback;
        m_hasWordsCallback = true;
    }

    void feed(const em::val &samples, double startTime) {
        if (!m_whisper) throw runtime_error("Romanian Whisper model is not initialized");

        const size_t count = samples["length"].as<size_t>();
        if (!count) return;

        if (m_chunkStartTime < 0.0) m_chunkStartTime = startTime;

        const size_t offset = m_pcm.size();
        m_pcm.resize(offset + count);
        em::val view = em::val(emscripten::typed_memory_view(count, m_pcm.data() + offset));
        view.call<void>("set", samples);
        processAvailable(false);
    }

    void flush() { processAvailable(true); }

    void discontinuity() {
        processAvailable(true);
        resetAudio();
    }

    void reset() { resetAudio(); }

    string systemInfo() const { return whisper_print_system_info(); }

private:
    void resetAudio() {
        m_pcm.clear();
        m_chunkStartTime = -1.0;
    }

    void processAvailable(bool final) {
        while (m_pcm.size() >= CHUNK_SAMPLES) {
            processChunk(m_pcm.data(), CHUNK_SAMPLES, m_chunkStartTime);
            m_pcm.erase(m_pcm.begin(), m_pcm.begin() + CHUNK_SAMPLES);
            m_chunkStartTime += static_cast<double>(CHUNK_SAMPLES) / SAMPLE_RATE;
        }

        if (final) {
            if (m_pcm.size() >= MIN_FINAL_SAMPLES) {
                processChunk(m_pcm.data(), m_pcm.size(), m_chunkStartTime);
            }
            m_pcm.clear();
            m_chunkStartTime = -1.0;
        }
    }

    void processChunk(const float *samples, size_t samplesNo, double startTime) {
        if (!m_whisper || samplesNo == 0) return;

        whisper_full_params params =
            whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        params.n_threads = 1;
        params.translate = false;
        params.no_context = true;
        params.no_timestamps = false;
        params.single_segment = false;
        params.print_special = false;
        params.print_progress = false;
        params.print_realtime = false;
        params.print_timestamps = false;
        params.token_timestamps = true;
        params.language = m_language.c_str();
        params.detect_language = false;

        const int result = whisper_full(
            m_whisper, params, samples, static_cast<int>(samplesNo));
        if (result != 0) {
            throw runtime_error("Romanian Whisper transcription failed");
        }

        emitWhisperWords(startTime);
    }

    void emitWhisperWords(double startTime) {
        string current;
        double currentBegin = -1.0;
        double currentEnd = -1.0;
        double probabilitySum = 0.0;
        unsigned probabilityCount = 0;

        auto flushCurrent = [&]() {
            if (current.empty()) return;
            const float probability = probabilityCount
                ? static_cast<float>(probabilitySum / probabilityCount)
                : 0.0f;
            emitWord(current, currentBegin, currentEnd, probability);
            current.clear();
            currentBegin = -1.0;
            currentEnd = -1.0;
            probabilitySum = 0.0;
            probabilityCount = 0;
        };

        const int segments = whisper_full_n_segments(m_whisper);
        for (int segment = 0; segment < segments; ++segment) {
            const int tokens = whisper_full_n_tokens(m_whisper, segment);
            for (int token = 0; token < tokens; ++token) {
                const char *raw =
                    whisper_full_get_token_text(m_whisper, segment, token);
                if (!raw) continue;

                string piece(raw);
                if (piece.empty() || isSpecialToken(piece)) continue;

                const whisper_token_data data =
                    whisper_full_get_token_data(m_whisper, segment, token);
                if (data.t0 < 0 || data.t1 < data.t0) continue;

                const bool startsWord =
                    isspace(static_cast<unsigned char>(piece.front())) != 0;
                if (startsWord && !current.empty()) flushCurrent();

                if (currentBegin < 0.0) {
                    currentBegin =
                        startTime + 0.01 * static_cast<double>(data.t0);
                }
                currentEnd =
                    startTime + 0.01 * static_cast<double>(data.t1);
                probabilitySum += data.p;
                probabilityCount += 1;
                current += piece;
            }
        }
        flushCurrent();
    }

    void emitWord(
            const string &rawText,
            double begin,
            double end,
            float probability) {
        const string word = trimWord(rawText);
        if (word.empty() || begin < 0.0 || !isfinite(begin) || !isfinite(end)) {
            return;
        }
        if (utf8Length(word) < m_minLen || probability < m_minProb) {
            return;
        }
        if (!m_hasWordsCallback) return;

        em::val value = em::val::object();
        value.set("text", word);
        value.set("time", static_cast<float>(begin));
        value.set(
            "duration",
            end > begin ? static_cast<float>(end - begin) : 0.0f);
        value.set("score", probability);
        m_wordsCallback(value);
    }

private:
    whisper_context *m_whisper;
    string m_language;
    vector<float> m_pcm;
    double m_chunkStartTime;
    float m_minProb;
    unsigned m_minLen;
    em::val m_wordsCallback;
    bool m_hasWordsCallback;
};

EMSCRIPTEN_BINDINGS(subsync2_whisper_simd) {
    em::class_<RomanianWhisperRecognition>("RomanianWhisperRecognition")
        .constructor<>()
        .function("loadModel", &RomanianWhisperRecognition::loadModel)
        .function("setLanguage", &RomanianWhisperRecognition::setLanguage)
        .function("setMinWordProb", &RomanianWhisperRecognition::setMinWordProb)
        .function("setMinWordLen", &RomanianWhisperRecognition::setMinWordLen)
        .function("setWordsCallback", &RomanianWhisperRecognition::setWordsCallback)
        .function("feed", &RomanianWhisperRecognition::feed)
        .function("flush", &RomanianWhisperRecognition::flush)
        .function("discontinuity", &RomanianWhisperRecognition::discontinuity)
        .function("reset", &RomanianWhisperRecognition::reset)
        .function("systemInfo", &RomanianWhisperRecognition::systemInfo);
}
