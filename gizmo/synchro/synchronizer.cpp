#include "synchronizer.h"
#include "text/translator.h"
#include "general/logger.h"
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <map>
#include <vector>

using namespace std;


PrecisionStats::PrecisionStats() :
	available(false),
	rawPoints(0),
	buckets(0),
	beginningBuckets(0),
	middleBuckets(0),
	endBuckets(0),
	jackknifeSamples(0),
	maxMappedDelta(0.0),
	medianMappedDelta(0.0),
	maxSlopeDeltaPpm(0.0),
	maxOffsetDelta(0.0)
{
}


CorrelationStats::CorrelationStats() :
	correlated(false),
	factor(0.0),
	points(0),
	maxDistance(0.0f)
{
}

string CorrelationStats::toString(const char *prefix, const char *suffix) const
{
	stringstream ss;
	ss << prefix << fixed << setprecision(3)
		<< "correlated=" << std::boolalpha << correlated
		<< ", factor="   << 100.0 * factor << "%"
		<< ", points="   << points
		<< ", maxDist="  << maxDistance
		<< ", formula="  << formula.toString()
		<< suffix;
	return ss.str();
}


Synchronizer::Synchronizer(
		float windowSize,
		double minCorrelation,
		float maxDistance,
		unsigned minPointsNo,
		float minWordsSim) :
	m_lineFinder(5.0f, windowSize),
	m_windowSize(windowSize),
	m_minCorrelation(minCorrelation),
	m_maxDistanceSqr(maxDistance * maxDistance),
	m_minPointsNo(minPointsNo),
	m_minWordsSim(minWordsSim)
{
}

bool Synchronizer::addSubWord(const Word &sub)
{
	m_subs.insert(sub);

	auto first = m_refs.lower_bound(Word(sub.time - m_windowSize, 0.0f, 0.0f));
	auto last  = m_refs.upper_bound(Word(sub.time + m_windowSize, 0.0f, 1.0f));
	if (first == m_refs.end())
		first = m_refs.begin();

	bool newBestLine = false;

	for (auto ref = first; ref != last; ++ref)
	{
		float sim = compareWords(sub.text, ref->text);// * sub.score * ref->score;
		if (sim >= m_minWordsSim)
		{
			newBestLine |= m_lineFinder.addPoint(sub.time, ref->time);
		}
	}

	return newBestLine;
}

bool Synchronizer::addRefWord(const Word &ref)
{
	m_refs.insert(ref);

	auto first = m_subs.lower_bound(Word(ref.time - m_windowSize, 0.0f, 0.0f));
	auto last  = m_subs.upper_bound(Word(ref.time + m_windowSize, 0.0f, 1.0f));
	if (first == m_subs.end())
		first = m_subs.begin();

	bool newBestLine = false;

	for (auto sub = first; sub != last; ++sub)
	{
		float sim = compareWords(ref.text, sub->text);// * ref.score * sub->score;
		if (sim >= m_minWordsSim)
		{
			newBestLine |= m_lineFinder.addPoint(sub->time, ref.time);
		}
	}

	return newBestLine;
}

void Synchronizer::addSubtitle(double startTime, double endTime)
{
	(void) startTime;
	m_buckets.insert(endTime);
}

CorrelationStats Synchronizer::correlate() const
{
	const Line bestLine = m_lineFinder.getBestLine();
	const Points &points = m_lineFinder.getPoints();
	Points hits = bestLine.getPointsInLine(points, 10.0f*m_maxDistanceSqr);

	Line line;
	double factor = line.interpolate(hits);
	float distSqr = line.findFurthestPoint(hits);

	while ((factor < m_minCorrelation || distSqr > m_maxDistanceSqr)
			&& hits.size() > m_minPointsNo
			&& countBuckets(hits, m_minPointsNo + 1) > m_minPointsNo)
	{
		distSqr = line.removeFurthestPoint(hits);
		factor = line.interpolate(hits);
	}

	CorrelationStats stats;
	stats.factor = factor;
	stats.points = countBuckets(hits);
	stats.maxDistance = sqrt(distSqr);
	stats.formula = line;

	stats.correlated =
		factor >= m_minCorrelation &&
		distSqr <= m_maxDistanceSqr &&
		stats.points >= m_minPointsNo;

	return stats;
}

unsigned Synchronizer::countBuckets(const Points &pts, unsigned limit) const
{
	if (m_buckets.empty())
		return pts.size();

	set<float> has;

	for (const Point &pt : pts)
	{
		Buckets::const_iterator it = m_buckets.lower_bound(pt.x);
		if (it != m_buckets.end())
		{
			const bool inserted = has.insert(*it).second;
			if (inserted && has.size() >= limit)
				break;
		}
	}

	return has.size();
}

const Synchronizer::Entrys &Synchronizer::getSubs() const
{
	return m_subs;
}

const Synchronizer::Entrys &Synchronizer::getRefs() const
{
	return m_refs;
}

const Points &Synchronizer::getAllPoints() const
{
	return m_lineFinder.getPoints();
}

Points Synchronizer::getUsedPoints() const
{
	const CorrelationStats stats = correlate();
	const Line line(stats.formula.a, stats.formula.b);
	return line.getPointsInLine(m_lineFinder.getPoints(), m_maxDistanceSqr);
}


PrecisionStats Synchronizer::getPrecisionStats(double duration) const
{
	PrecisionStats precision;
	const CorrelationStats stats = correlate();

	// Precision diagnostics are deliberately downstream of canonical acceptance.
	// They never participate in correlation, point filtering, Save eligibility,
	// or the selected timing formula.
	if (!stats.correlated)
		return precision;

	const Points used = getUsedPoints();
	precision.rawPoints = used.size();
	if (used.size() < 2 || m_buckets.empty())
		return precision;

	// Group every aligned raw match by the same subtitle-end bucket semantics
	// already used by countBuckets(). This prevents repeated words / Romanian
	// context anchors inside one subtitle cue from pretending to be independent
	// evidence in the robustness calculation.
	std::map<float, Points> grouped;
	for (const Point &pt : used)
	{
		Buckets::const_iterator bucket = m_buckets.lower_bound(pt.x);
		if (bucket != m_buckets.end())
			grouped[*bucket].insert(pt);
	}

	precision.buckets = grouped.size();
	if (grouped.empty())
		return precision;

	const double refDuration = duration > 0.0 ? duration : 0.0;
	for (const auto &entry : grouped)
	{
		double refTime = 0.0;
		for (const Point &pt : entry.second)
			refTime += pt.y;
		refTime /= (double) entry.second.size();

		if (refDuration > 0.0)
		{
			const double ratio = std::max(0.0, std::min(1.0, refTime / refDuration));
			if (ratio < 1.0 / 3.0)
				precision.beginningBuckets++;
			else if (ratio < 2.0 / 3.0)
				precision.middleBuckets++;
			else
				precision.endBuckets++;
		}
	}

	const double evalEnd = std::max(
		refDuration,
		m_buckets.empty() ? 0.0 : (double) *m_buckets.rbegin()
	);
	std::vector<double> mappedDeltas;

	for (const auto &entry : grouped)
	{
		Points remaining = used;
		for (const Point &pt : entry.second)
			remaining.erase(pt);

		if (remaining.size() < 2)
			continue;

		Line alternative;
		const double factor = alternative.interpolate(remaining);
		if (!std::isfinite(factor)
				|| !std::isfinite(alternative.a)
				|| !std::isfinite(alternative.b))
		{
			continue;
		}

		const double deltaStart = std::abs(
			(double) alternative.getY(0.0f) - (double) stats.formula.getY(0.0f)
		);
		const double deltaEnd = std::abs(
			(double) alternative.getY((float) evalEnd)
			- (double) stats.formula.getY((float) evalEnd)
		);
		const double mappedDelta = std::max(deltaStart, deltaEnd);
		mappedDeltas.push_back(mappedDelta);

		precision.maxMappedDelta = std::max(
			precision.maxMappedDelta,
			mappedDelta
		);
		precision.maxSlopeDeltaPpm = std::max(
			precision.maxSlopeDeltaPpm,
			std::abs((double) alternative.a - (double) stats.formula.a) * 1000000.0
		);
		precision.maxOffsetDelta = std::max(
			precision.maxOffsetDelta,
			std::abs((double) alternative.b - (double) stats.formula.b)
		);
	}

	precision.jackknifeSamples = mappedDeltas.size();
	if (!mappedDeltas.empty())
	{
		std::sort(mappedDeltas.begin(), mappedDeltas.end());
		const size_t mid = mappedDeltas.size() / 2;
		precision.medianMappedDelta = mappedDeltas.size() % 2
			? mappedDeltas[mid]
			: 0.5 * (mappedDeltas[mid - 1] + mappedDeltas[mid]);
		precision.available = true;
	}

	return precision;
}
