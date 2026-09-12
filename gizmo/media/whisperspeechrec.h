#ifndef __WHISPER_SPEECH_RECOGNITION_H__
#define __WHISPER_SPEECH_RECOGNITION_H__

#include "avout.h"
#include "text/words.h"
#include <string>
#include <vector>

struct whisper_context;

class WhisperSpeechRecognition : public AVOutput
{
    public:
        WhisperSpeechRecognition();
        virtual ~WhisperSpeechRecognition();

        WhisperSpeechRecognition(const WhisperSpeechRecognition&) = delete;
        WhisperSpeechRecognition(WhisperSpeechRecognition&&) = delete;
        WhisperSpeechRecognition& operator=(const WhisperSpeechRecognition&) = delete;
        WhisperSpeechRecognition& operator=(WhisperSpeechRecognition&&) = delete;

        void setModelPath(const std::string &path);
        void setLanguage(const std::string &language);
        void setMinWordProb(float minProb);
        void setMinWordLen(unsigned minLen);

        void addWordsListener(WordsListener listener);
        bool removeWordsListener(WordsListener listener);

        virtual void start(const AVStream *stream);
        virtual void stop();
        virtual void feed(const AVFrame *frame);
        virtual void flush();
        virtual void discontinuity();

    private:
        void processAvailable(bool final);
        void processChunk(const float *samples, size_t samplesNo, double startTime);
        void emitWhisperWords(double startTime);
        void emitWord(const std::string &text, double begin, double end, float probability);
        void resetAudio();

    private:
        struct whisper_context *m_whisper;
        std::string m_modelPath;
        std::string m_language;
        std::vector<float> m_pcm;
        double m_timeBase;
        double m_chunkStartTime;
        float m_minProb;
        unsigned m_minLen;
        WordsNotifier m_wordsNotifier;
};

#endif
