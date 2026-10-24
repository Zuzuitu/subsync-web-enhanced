#include "SubSyncNative.h"
#include "synchro/synchronizer.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <limits>
#include <string>

int main() {
    assert(ss2_abi_version() == 1);
    assert(ss2_get_stats(nullptr, nullptr) != 0);
    auto *adapter = ss2_create();
    assert(adapter);
    SS2Stats result{};
    assert(ss2_get_stats(adapter, &result) == 0 && !result.correlated);
    assert(ss2_add_word(adapter, 1, NAN, 0, "invalid") != 0);
    assert(ss2_add_subtitle(adapter, 2, 1) != 0);
    Synchronizer direct(1800.0f, 0.9999, 2.0f, 20, 0.6f);
    for (int i = 0; i < 24; ++i) {
        const float time = 100 + 80 * i;
        const std::string word(8, 'a' + i);
        assert(ss2_add_subtitle(adapter, time, time + 5) == 0);
        direct.addSubtitle(time, time + 5);
        assert(ss2_add_word(adapter, 0, time + 1, 0, word.c_str()) == 0);
        direct.addSubWord(Word(word, time + 1, 0));
        assert(ss2_add_word(adapter, 1, time + 1 - 8.125f, 0, word.c_str()) == 0);
        direct.addRefWord(Word(word, time + 1 - 8.125f, 0));
        assert(ss2_get_stats(adapter, &result) == 0);
        const auto expected = direct.correlate();
        assert(result.correlated == expected.correlated);
        assert(result.points == expected.points);
        assert(result.a == expected.formula.a && result.b == expected.formula.b);
        assert(result.factor == expected.factor && result.max_distance == expected.maxDistance);
        if (i < 19) assert(!result.correlated); // 19 cues must never pass.
    }
    assert(result.correlated && result.points == 24);
    assert(std::abs(result.a - 1) < 1e-6 && std::abs(result.b + 8.125) < 1e-6);
    ss2_destroy(adapter);

    adapter = ss2_create();
    assert(ss2_add_subtitle(adapter, 0, 4000) == 0);
    for (int i = 0; i < 24; ++i) {
        const float time = 100 + 80 * i;
        const std::string word(8, 'a' + i);
        assert(ss2_add_word(adapter, 0, time, 0, word.c_str()) == 0);
        assert(ss2_add_word(adapter, 1, time - 8, 0, word.c_str()) == 0);
    }
    assert(ss2_get_stats(adapter, &result) == 0);
    assert(!result.correlated && result.points < 20); // 24 words in ONE cue.
    ss2_destroy(adapter);
    ss2_destroy(nullptr);
    std::cout << "C ABI / direct canonical C++ agreement and acceptance gates: PASS\n";
}
