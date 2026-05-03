"""Cost analysis — skeleton; backend implementation planned later.

See INSTRUCTIONS.md §11 for scope: activity-based costing — requires a
`cost` column on events.
"""

from flows_funds.sdk import Module


class CostAnalysisModule(Module):
    id = "cost_analysis"
