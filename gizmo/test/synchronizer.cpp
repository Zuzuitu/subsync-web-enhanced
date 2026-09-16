#include "catch.hpp"
#include "synchro/synchronizer.h"
#include <string>


TEST_CASE("Synchronizer recomputes retained max distance after pruning")
{
	Synchronizer sync(30.0f, 0.9999, 2.0f, 20, 1.0f);

	// Twenty-one unique subtitle buckets follow y=x-10 except for one raw
	// match that is still close enough to the LineFinder's broad candidate
	// band, but outside the canonical 2 s residual gate. Pruning that match
	// leaves exactly the canonical minimum of 20 buckets on a perfect line.
	for (unsigned i = 0; i < 21; ++i)
	{
		const float subTime = 100.0f + 20.0f * i;
		float refTime = subTime - 10.0f;
		if (i == 20)
			refTime += 4.0f;

		const std::string token = "unique_token_" + std::to_string(i);
		sync.addSubtitle(subTime - 0.5f, subTime + 0.5f);
		sync.addSubWord(Word(token, subTime));
		sync.addRefWord(Word(token, refTime));
	}

	const CorrelationStats stats = sync.correlate();
	REQUIRE(stats.points == 20);
	REQUIRE(stats.factor >= 0.9999);
	REQUIRE(stats.maxDistance <= 2.0f);
	REQUIRE(stats.correlated);
}
