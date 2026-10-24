#include "SubSyncMedia.h"
#include <cstdio>
#include <fstream>
#include <string>

int main(int argc, char **argv) {
    // No ground truth/formula/offset is accepted by this executable.
    if (argc != 7) return 64;
    auto *context = ss2_media_create();
    if (!context) return 70;
    int result = 0;
    SS2MediaStatus status{};
    std::ifstream parameters(argv[4]);
    std::string line;
    while (std::getline(parameters, line)) {
        const auto split = line.find('\t');
        if (split == std::string::npos || ss2_media_set_param(context,
            line.substr(0, split).c_str(), line.substr(split + 1).c_str()) != 0) result = -1;
    }
    if (std::string(argv[6]) == "cancel") ss2_media_cancel(context);
    if (!result) result = ss2_media_open(context, argv[1], argv[2], argv[3]);
    if (!result) result = ss2_media_start(context, -1, std::stoi(argv[5]));
    while (!result) result = ss2_media_step(context, 100, &status);
    const auto &s = status.fit;
    std::printf("{\"done\":%s,\"cancelled\":%s,\"stage\":%d,\"referenceWords\":%llu,\"subtitleWords\":%llu,\"cueCount\":%llu,\"duration\":%.17g,\"correlated\":%s,\"points\":%u,\"factor\":%.17g,\"maxDistance\":%.17g,\"formula\":{\"a\":%.17g,\"b\":%.17g}}\n",
        status.done ? "true" : "false", result == -2 ? "true" : "false", ss2_media_error_stage(context),
        static_cast<unsigned long long>(status.reference_words), static_cast<unsigned long long>(status.subtitle_words),
        static_cast<unsigned long long>(status.cues), status.duration, s.correlated ? "true" : "false", s.points,
        s.factor, s.max_distance, s.a, s.b);
    ss2_media_destroy(context);
    return result == 1 ? (s.correlated ? 0 : 2) : (result == -2 ? 3 : 4);
}
