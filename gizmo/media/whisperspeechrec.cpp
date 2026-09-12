#include "whisperspeechrec.h"
#include "text/utf8.h"
#include "general/exception.h"
#include <whisper.h>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>

using namespace std;

namespace
{
    const int WHISPER_SAMPLE_RATE = 16000;
    const size_t CHUNK_SAMPLES = 30 * WHISPER_SAMPLE_RATE;
    const size_t MIN_FINAL_SAMPLES = WHISPER_SAMPLE_RATE;

    static string trimWord(string word)
    {
        while (!word.empty() && isspace(static_cast<unsigned char>(word.front())))
            word.erase(word.begin());
        while (!word.empty() && isspace(static_cast<unsigned char>(word.back())))
            word.pop_back();

        while (!word.empty())
        {
            const unsigned char ch = static_cast<unsigned char>(word.front());
            if (ch >= 0x80 || isalnum(ch))
                break;
            word.erase(word.begin());
        }
        while (!word.empty())
        {
            const unsigned char ch = static_cast<unsigned char>(word.back());
            if (ch >= 0x80 || isalnum(ch))
                break;
            word.pop_back();
        }
        return word;
    }

    static bool isSpecialToken(const string &text)
    {
        return text.size() >= 3 && text[0] == '<' && text[1] == '|';
    }
}

WhisperSpeechRecognition::WhisperSpeechRecognition() :
    m_whisper(NULL),
    m_language("ro"),
    m_timeBase(0.0),
    m_chunkStartTime(-1.0),
    m_minProb(1.0f),
    m_minLen(0)
{
}

WhisperSpeechRecognition::~WhisperSpeechRecognition()
{
    if (m_whisper)
    {
        whisper_free(m_whisper);
        m_whisper = NULL;
    }
}

void WhisperSpeechRecognition::setModelPath(const string &path)
{
    m_modelPath = path;
}

void WhisperSpeechRecognition::setLanguage(const string &language)
{
    m_language = language;
}

void WhisperSpeechRecognition::setMinWordProb(float minProb)
{
    m_minProb = minProb;
}

void WhisperSpeechRecognition::setMinWordLen(unsigned minLen)
{
    m_minLen = minLen;
}

void WhisperSpeechRecognition::addWordsListener(WordsListener listener)
{
    m_wordsNotifier.addListener(listener);
}

bool WhisperSpeechRecognition::removeWordsListener(WordsListener listener)
{
    return m_wordsNotifier.removeListener(listener);
}

void WhisperSpeechRecognition::start(const AVStream *stream)
{
    if (m_modelPath.empty())
        throw EXCEPTION("Romanian Whisper model path is empty")
            .module("WhisperSpeechRecognition", "start");

    if (m_whisper)
    {
        whisper_free(m_whisper);
        m_whisper = NULL;
    }

    whisper_context_params params = whisper_context_default_params();
    params.use_gpu = false;
    m_whisper = whisper_init_from_file_with_params(m_modelPath.c_str(), params);
    if (!m_whisper)
        throw EXCEPTION("can't initialize Romanian Whisper model")
            .module("WhisperSpeechRecognition", "whisper_init_from_file_with_params")
            .file(m_modelPath);

    m_timeBase = av_q2d(stream->time_base);
    resetAudio();
}

void WhisperSpeechRecognition::stop()
{
    processAvailable(true);
    resetAudio();

    if (m_whisper)
    {
        whisper_free(m_whisper);
        m_whisper = NULL;
    }
}

void WhisperSpeechRecognition::feed(const AVFrame *frame)
{
    if (!m_whisper)
        throw EXCEPTION("Romanian Whisper model is not initialized")
            .module("WhisperSpeechRecognition", "feed");

    if (frame->format != AV_SAMPLE_FMT_FLT || frame->channels != 1 || frame->sample_rate != WHISPER_SAMPLE_RATE)
        throw EXCEPTION("unexpected Romanian Whisper PCM format")
            .module("WhisperSpeechRecognition", "feed")
            .add("format", frame->format)
            .add("channels", frame->channels)
            .add("sampleRate", frame->sample_rate);

    if (m_chunkStartTime < 0.0)
        m_chunkStartTime = m_timeBase * frame->pts;

    const float *data = reinterpret_cast<const float *>(frame->data[0]);
    m_pcm.insert(m_pcm.end(), data, data + frame->nb_samples);
    processAvailable(false);
}

void WhisperSpeechRecognition::flush()
{
    processAvailable(true);
}

void WhisperSpeechRecognition::discontinuity()
{
    processAvailable(true);
    resetAudio();
}

void WhisperSpeechRecognition::processAvailable(bool final)
{
    while (m_pcm.size() >= CHUNK_SAMPLES)
    {
        processChunk(m_pcm.data(), CHUNK_SAMPLES, m_chunkStartTime);
        m_pcm.erase(m_pcm.begin(), m_pcm.begin() + CHUNK_SAMPLES);
        m_chunkStartTime += static_cast<double>(CHUNK_SAMPLES) / WHISPER_SAMPLE_RATE;
    }

    if (final)
    {
        if (m_pcm.size() >= MIN_FINAL_SAMPLES)
            processChunk(m_pcm.data(), m_pcm.size(), m_chunkStartTime);
        m_pcm.clear();
        m_chunkStartTime = -1.0;
    }
}

void WhisperSpeechRecognition::processChunk(const float *samples, size_t samplesNo, double startTime)
{
    if (!m_whisper || samplesNo == 0)
        return;

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
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

    const int result = whisper_full(m_whisper, params, samples, static_cast<int>(samplesNo));
    if (result != 0)
        throw EXCEPTION("Romanian Whisper transcription failed")
            .module("WhisperSpeechRecognition", "whisper_full")
            .add("code", result)
            .time(startTime);

    emitWhisperWords(startTime);
}

void WhisperSpeechRecognition::emitWhisperWords(double startTime)
{
    string current;
    double currentBegin = -1.0;
    double currentEnd = -1.0;
    double probabilitySum = 0.0;
    unsigned probabilityCount = 0;

    auto flushCurrent = [&]()
    {
        if (current.empty())
            return;

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
    for (int segment = 0; segment < segments; ++segment)
    {
        const int tokens = whisper_full_n_tokens(m_whisper, segment);
        for (int token = 0; token < tokens; ++token)
        {
            const char *raw = whisper_full_get_token_text(m_whisper, segment, token);
            if (!raw)
                continue;

            string piece(raw);
            if (piece.empty() || isSpecialToken(piece))
                continue;

            const whisper_token_data data = whisper_full_get_token_data(m_whisper, segment, token);
            if (data.t0 < 0 || data.t1 < data.t0)
                continue;

            const bool startsWord = isspace(static_cast<unsigned char>(piece.front())) != 0;
            if (startsWord && !current.empty())
                flushCurrent();

            if (currentBegin < 0.0)
                currentBegin = startTime + 0.01 * static_cast<double>(data.t0);
            currentEnd = startTime + 0.01 * static_cast<double>(data.t1);
            probabilitySum += data.p;
            probabilityCount += 1;
            current += piece;
        }
    }
    flushCurrent();
}

void WhisperSpeechRecognition::emitWord(
        const string &rawText, double begin, double end, float probability)
{
    const string word = trimWord(rawText);
    if (word.empty() || begin < 0.0 || !isfinite(begin) || !isfinite(end))
        return;

    if (Utf8::size(word) < m_minLen || probability < m_minProb)
        return;

    const float duration = end > begin ? static_cast<float>(end - begin) : 0.0f;
    m_wordsNotifier.notify(Word(
        word,
        static_cast<float>(begin),
        duration,
        probability));
}

void WhisperSpeechRecognition::resetAudio()
{
    m_pcm.clear();
    m_chunkStartTime = -1.0;
}
