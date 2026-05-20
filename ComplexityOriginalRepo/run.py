import Complexity
import EnrichedComplexity
from argparse import ArgumentParser

parser = ArgumentParser()
parser.add_argument("-f", "--file", dest="file", help="input log file")
parser.add_argument("-v", "--verbose", dest="verbose", default=False, action="store_true")
parser.add_argument("-m", "--measures", dest="measures", default=[], action="append",
    choices=["magnitude","support","variety","level_of_detail","time_granularity",
             "structure","affinity","trace_length","distinct_traces",
             "deviation_from_random","lempel-ziv","pentland","all"])
args = parser.parse_args()

# Log einlesen
pm4py_log = Complexity.generate_pm4py_log(args.file, verbose=args.verbose)

# Verfügbare Attribute anzeigen
print("Verfügbare Attribute:")
print(EnrichedComplexity.list_attributes(pm4py_log))

# Enriched Log und Graph bauen
log = EnrichedComplexity.generate_enriched_log(pm4py_log, verbose=args.verbose)
pa = EnrichedComplexity.build_enriched_graph(log, verbose=args.verbose)

# Entropie berechnen
print("---Entropy measures---")
var_ent = Complexity.graph_complexity(pa)
print("Variant entropy: " + str(var_ent[0]))
print("Normalized variant entropy: " + str(var_ent[1]))

seq_ent = Complexity.log_complexity(pa)
print("Sequence entropy: " + str(seq_ent[0]))
print("Normalized sequence entropy: " + str(seq_ent[1]))

# Weitere Maße falls gewünscht
if args.measures:
    measurements = Complexity.perform_measurements(
        args.measures, log, pm4py_log, pa, quiet=False, verbose=args.verbose)