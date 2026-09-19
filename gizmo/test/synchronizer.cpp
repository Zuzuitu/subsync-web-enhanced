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

TEST_CASE("Precision refinement gives each subtitle cue one vote")
{
	Synchronizer sync(30.0f, 0.9999, 2.0f, 20, 1.0f);

	// Twenty-two independent cue buckets follow y=x-10. The first four cues
	// also contain several plausible but +1.2 s biased raw matches. Canonical
	// sc0ty acceptance is intentionally unchanged and may use every raw match;
	// the downstream precision candidate must reduce the duplicate-cue leverage.
	for (unsigned i = 0; i < 22; ++i)
	{
		const float base = 100.0f + 200.0f * i;
		const std::string token = "cue_" + std::to_string(i);
		sync.addSubtitle(base - 1.0f, base + 1.0f);
		sync.addSubWord(Word(token, base));
		sync.addRefWord(Word(token, base - 10.0f));

		if (i < 4)
		{
			for (unsigned j = 0; j < 4; ++j)
			{
				const float local = -0.3f + 0.2f * j;
				const std::string duplicate =
					"dup_" + std::to_string(i) + "_" + std::to_string(j);
				sync.addSubWord(Word(duplicate, base + local));
				sync.addRefWord(Word(duplicate, base + local - 8.8f));
			}
		}
	}

	const CorrelationStats canonical = sync.correlate();
	REQUIRE(canonical.correlated);

	const PrecisionStats precision = sync.getPrecisionStats(4400.0);
	REQUIRE(precision.available);
	REQUIRE(precision.rawPoints > precision.buckets);
	REQUIRE(precision.buckets == 22);
	REQUIRE(precision.refinementAvailable);
	REQUIRE(precision.refinementFactor >= 0.9999);
	REQUIRE(precision.refinementMaxDistance <= 2.0);

	const float evalEnd = 4300.0f;
	const double canonicalError = std::max(
		std::abs((double) canonical.formula.getY(0.0f) + 10.0),
		std::abs((double) canonical.formula.getY(evalEnd) - (evalEnd - 10.0f))
	);
	const double refinedError = std::max(
		std::abs((double) precision.refinementFormula.getY(0.0f) + 10.0),
		std::abs((double) precision.refinementFormula.getY(evalEnd) - (evalEnd - 10.0f))
	);

	REQUIRE(precision.refinementMappedDelta > 0.0);
	REQUIRE(refinedError < canonicalError);
}
