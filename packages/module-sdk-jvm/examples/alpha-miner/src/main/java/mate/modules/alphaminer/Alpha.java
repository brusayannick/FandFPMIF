package mate.modules.alphaminer;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * The classic Alpha algorithm (van der Aalst et al., "Workflow Mining:
 * Discovering Process Models from Event Logs", IEEE TKDE 2004), on plain Java
 * collections.
 *
 * <p>From the ordered (case, activity) rows it derives the footprint relations
 * (direct succession, causality, parallelism, unrelatedness), searches the
 * maximal (A, B) activity-set pairs with A → B causality and internal
 * unrelatedness, and lays them down as the places of a Petri net between the
 * start and end activities.
 */
final class Alpha {

    /** Guardrail for the (worst-case exponential) pair search. */
    static final int MAX_ACTIVITIES = 40;

    private final List<List<String>> traces;
    private final Set<String> activities = new LinkedHashSet<>();
    private final Set<String> starts = new LinkedHashSet<>();
    private final Set<String> ends = new LinkedHashSet<>();
    private final Set<Long> direct = new HashSet<>();
    private final Map<String, Integer> index = new HashMap<>();
    private final Runnable cancelPoll;

    private Alpha(List<List<String>> traces, Runnable cancelPoll) {
        this.traces = traces;
        this.cancelPoll = cancelPoll;
    }

    /**
     * Mine a Petri net from ordered (case_id, activity) rows. {@code cancelPoll}
     * is invoked at phase boundaries and inside the pair search - pass
     * {@code ctx::checkCancelled} so long runs stay cancellable.
     */
    static Map<String, Object> mine(List<List<Object>> rows, Runnable cancelPoll) {
        List<List<String>> traces = tracesFrom(rows);
        return new Alpha(traces, cancelPoll).run();
    }

    private static List<List<String>> tracesFrom(List<List<Object>> rows) {
        Map<String, List<String>> byCase = new LinkedHashMap<>();
        for (List<Object> row : rows) {
            String caseId = String.valueOf(row.get(0));
            String activity = String.valueOf(row.get(1));
            byCase.computeIfAbsent(caseId, k -> new ArrayList<>()).add(activity);
        }
        return new ArrayList<>(byCase.values());
    }

    private Map<String, Object> run() {
        buildFootprint();
        if (activities.size() > MAX_ACTIVITIES) {
            throw new IllegalStateException(
                    "log has "
                            + activities.size()
                            + " distinct activities - the classic Alpha pair search caps at "
                            + MAX_ACTIVITIES
                            + " (use a filtered log)");
        }
        cancelPoll.run();
        List<SetPair> pairs = maximalPairs();
        cancelPoll.run();
        return toPetriNet(pairs);
    }

    // -- footprint ------------------------------------------------------------

    private void buildFootprint() {
        for (List<String> trace : traces) {
            if (trace.isEmpty()) {
                continue;
            }
            starts.add(trace.get(0));
            ends.add(trace.get(trace.size() - 1));
            activities.addAll(trace);
        }
        int i = 0;
        for (String activity : activities) {
            index.put(activity, i++);
        }
        for (List<String> trace : traces) {
            for (int j = 0; j + 1 < trace.size(); j++) {
                direct.add(key(trace.get(j), trace.get(j + 1)));
            }
        }
    }

    private long key(String a, String b) {
        return ((long) index.get(a) << 20) | index.get(b);
    }

    private boolean directlyFollows(String a, String b) {
        return direct.contains(key(a, b));
    }

    private boolean causal(String a, String b) {
        return directlyFollows(a, b) && !directlyFollows(b, a);
    }

    /** The `#` relation: never directly follow each other in either direction. */
    private boolean unrelated(String a, String b) {
        return !directlyFollows(a, b) && !directlyFollows(b, a);
    }

    // -- maximal (A, B) pair search --------------------------------------------

    private record SetPair(TreeSet<String> a, TreeSet<String> b) {
        String canonical() {
            return a + "->" + b;
        }
    }

    private List<SetPair> maximalPairs() {
        // Seed with every causal singleton pair, then grow either side while the
        // Alpha conditions hold; dedup by canonical form, keep only maximal.
        Map<String, SetPair> seen = new LinkedHashMap<>();
        List<SetPair> frontier = new ArrayList<>();
        for (String a : activities) {
            for (String b : activities) {
                if (causal(a, b)) {
                    SetPair seed = new SetPair(new TreeSet<>(List.of(a)), new TreeSet<>(List.of(b)));
                    if (seen.putIfAbsent(seed.canonical(), seed) == null) {
                        frontier.add(seed);
                    }
                }
            }
        }
        List<SetPair> all = new ArrayList<>(frontier);
        int steps = 0;
        while (!frontier.isEmpty()) {
            if (++steps % 64 == 0) {
                cancelPoll.run();
            }
            List<SetPair> next = new ArrayList<>();
            for (SetPair pair : frontier) {
                for (String candidate : activities) {
                    SetPair grownA = tryGrowA(pair, candidate);
                    if (grownA != null && seen.putIfAbsent(grownA.canonical(), grownA) == null) {
                        next.add(grownA);
                        all.add(grownA);
                    }
                    SetPair grownB = tryGrowB(pair, candidate);
                    if (grownB != null && seen.putIfAbsent(grownB.canonical(), grownB) == null) {
                        next.add(grownB);
                        all.add(grownB);
                    }
                }
            }
            frontier = next;
        }
        return keepMaximal(all);
    }

    private SetPair tryGrowA(SetPair pair, String candidate) {
        if (pair.a().contains(candidate)) {
            return null;
        }
        for (String a : pair.a()) {
            if (!unrelated(a, candidate)) {
                return null;
            }
        }
        for (String b : pair.b()) {
            if (!causal(candidate, b)) {
                return null;
            }
        }
        TreeSet<String> grown = new TreeSet<>(pair.a());
        grown.add(candidate);
        return new SetPair(grown, pair.b());
    }

    private SetPair tryGrowB(SetPair pair, String candidate) {
        if (pair.b().contains(candidate)) {
            return null;
        }
        for (String b : pair.b()) {
            if (!unrelated(b, candidate)) {
                return null;
            }
        }
        for (String a : pair.a()) {
            if (!causal(a, candidate)) {
                return null;
            }
        }
        TreeSet<String> grown = new TreeSet<>(pair.b());
        grown.add(candidate);
        return new SetPair(pair.a(), grown);
    }

    private List<SetPair> keepMaximal(List<SetPair> all) {
        List<SetPair> maximal = new ArrayList<>();
        for (SetPair candidate : all) {
            boolean dominated = false;
            for (SetPair other : all) {
                if (other != candidate
                        && other.a().containsAll(candidate.a())
                        && other.b().containsAll(candidate.b())
                        && (other.a().size() > candidate.a().size()
                                || other.b().size() > candidate.b().size())) {
                    dominated = true;
                    break;
                }
            }
            if (!dominated) {
                maximal.add(candidate);
            }
        }
        return maximal;
    }

    // -- Petri net JSON ---------------------------------------------------------

    /** Shape matches the platform's `kind: "petri_net"` dataset adapter. */
    private Map<String, Object> toPetriNet(List<SetPair> pairs) {
        List<Map<String, Object>> places = new ArrayList<>();
        List<Map<String, Object>> transitions = new ArrayList<>();
        List<Map<String, Object>> arcs = new ArrayList<>();

        for (String activity : activities) {
            transitions.add(
                    Map.of("id", "t_" + activity, "name", activity, "label", activity));
        }

        places.add(Map.of("id", "p_source", "label", "start"));
        places.add(Map.of("id", "p_sink", "label", "end"));
        int arcId = 0;
        for (String start : starts) {
            arcs.add(arc(arcId++, "p_source", "t_" + start));
        }
        for (String end : ends) {
            arcs.add(arc(arcId++, "t_" + end, "p_sink"));
        }

        int placeId = 0;
        for (SetPair pair : pairs) {
            String id = "p_" + placeId++;
            places.add(Map.of("id", id, "label", ""));
            for (String a : pair.a()) {
                arcs.add(arc(arcId++, "t_" + a, id));
            }
            for (String b : pair.b()) {
                arcs.add(arc(arcId++, id, "t_" + b));
            }
        }

        Map<String, Object> net = new HashMap<>();
        net.put("kind", "petri_net");
        net.put("places", places);
        net.put("transitions", transitions);
        net.put("arcs", arcs);
        net.put(
                "stats",
                Map.of(
                        "traces", traces.size(),
                        "activities", activities.size(),
                        "places", places.size()));
        return net;
    }

    private static Map<String, Object> arc(int id, String source, String target) {
        return Map.of("id", "a" + id, "source", source, "target", target);
    }
}
