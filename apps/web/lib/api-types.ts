/**
 * Manually-mirrored API types — the canonical source is FastAPI's
 * `/openapi.json`. Run `pnpm codegen` against a running backend to refresh.
 *
 * This file holds the minimum the frontend needs at the moment so we don't
 * block on having the backend up during build.
 */

export type EventLogStatus = "importing" | "ready" | "failed";

export interface EventLogSummary {
  id: string;
  name: string;
  status: EventLogStatus | string;
  source_format: string | null;
  source_filename: string | null;
  events_count: number | null;
  cases_count: number | null;
  variants_count: number | null;
  date_min: string | null;
  date_max: string | null;
  error: string | null;
  created_at: string;
  imported_at: string | null;
  last_edited_at: string | null;
}

export interface EventLogDetail extends EventLogSummary {
  detected_schema: Record<string, unknown> | null;
  description: string | null;
  column_overrides: EventLogColumnOverrides | null;
}

export interface EventLogColumnOverrides {
  labels?: Record<string, string>;
  order?: string[];
  hidden?: string[];
  /** Display-only renames for activity values, applied at render time. The
   * underlying parquet keeps the raw activity names so analytics modules
   * continue to operate on canonical values. Managed from the Activities tab.
   */
  activity_labels?: Record<string, string>;
}

export interface EventLogCreateResponse {
  log_id: string;
  job_id: string;
}

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobDetail {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  module_id: string | null;
  payload_json: Record<string, unknown>;
  status: JobStatus | string;
  progress_current: number;
  progress_total: number | null;
  stage: string | null;
  message: string | null;
  error: string | null;
  rate: number | null;
  eta_seconds: number | null;
  priority: number;
  parent_job_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ModuleSummary {
  id: string;
  name: string;
  version: string;
  category: "foundation" | "attribute" | "external_input" | "advanced" | "other" | string;
  description: string | null;
  author: string | null;
  license: string | null;
  provides: string[];
  consumes: string[];
  has_frontend: boolean;
  enabled: boolean;
  availability: { status: "available" | "unavailable" | "degraded"; reasons: string[] } | null;
}

export interface BusEnvelope<T = Record<string, unknown>> {
  topic: string;
  payload: T;
  ts: number;
}

// ── Events / Variants / Data quality / Edits ────────────────────────────────

export type ColumnType = "string" | "number" | "datetime" | "duration" | "enum" | "boolean";

export type ColumnRole =
  | "case_id"
  | "activity"
  | "timestamp"
  | "end_timestamp"
  | "resource"
  | "cost"
  | "role"
  | "lifecycle"
  | "custom";

export interface ColumnSpec {
  name: string;
  label: string;
  role: ColumnRole;
  type: ColumnType;
  nullable: boolean;
  required: boolean;
  enum_values: string[] | null;
}

export interface EventsHeader {
  events_count: number;
  cases_count: number;
  variants_count: number;
  date_min: string | null;
  date_max: string | null;
}

export type EventRow = Record<string, unknown> & { _has_missing?: boolean };

export interface EventsPage {
  rows: EventRow[];
  total: number;
  offset: number;
  limit: number;
  columns: ColumnSpec[];
  header: EventsHeader;
}

export type FilterOp = "contains" | "equals" | "gte" | "lte" | "is_null" | "is_not_null";

export interface FilterEntry {
  field: string;
  op: FilterOp;
  value?: string | number | boolean | null;
}

export interface CellPatch {
  field: string;
  value: unknown;
}

export interface CellPatchResult {
  row: EventRow;
  row_index: number;
  new_row_index: number;
  header: EventsHeader;
}

export interface BulkFillBody {
  row_indices: number[];
  field: string;
  value: unknown;
}

export interface BulkFillResult {
  updated: number;
  header: EventsHeader;
}

export interface VariantRow {
  rank: number;
  variant_id: string;
  activities: string[];
  case_count: number;
  case_pct: number;
  avg_duration_seconds: number | null;
  median_duration_seconds: number | null;
  first_seen: string | null;
  last_seen: string | null;
}

export interface VariantsPage {
  rows: VariantRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface AttributeBreakdownEntry {
  value: unknown;
  count: number;
}

export interface AttributeBreakdown {
  column: string;
  label: string;
  top: AttributeBreakdownEntry[];
}

export interface VariantDetail {
  rank: number;
  variant_id: string;
  activities: string[];
  case_count: number;
  case_pct: number;
  avg_duration_seconds: number | null;
  median_duration_seconds: number | null;
  p90_duration_seconds: number | null;
  first_seen: string | null;
  last_seen: string | null;
  duration_histogram: number[];
  duration_bin_edges_seconds: number[];
  attribute_breakdowns: AttributeBreakdown[];
}

export interface VariantCase {
  case_id: string;
  case_start: string | null;
  case_end: string | null;
  case_duration_seconds: number | null;
  event_count: number;
}

export interface VariantCasesPage {
  rows: VariantCase[];
  total: number;
  offset: number;
  limit: number;
}

export interface ColumnQuality {
  column: string;
  label: string;
  type: ColumnType;
  role: ColumnRole;
  null_count: number;
  null_pct: number;
  distinct_count: number;
}

export interface DataQuality {
  total_events: number;
  columns: ColumnQuality[];
}

export interface ActivityRow {
  activity: string;
  count: number;
}

export interface ActivitiesPage {
  rows: ActivityRow[];
  total: number;
}

export interface EventEditEntry {
  id: number;
  log_id: string;
  row_index: number;
  field: string;
  old_value_json: unknown;
  new_value_json: unknown;
  edited_at: string;
}

export interface EventEditsPage {
  rows: EventEditEntry[];
  total: number;
  offset: number;
  limit: number;
}

export interface EventLogUpdatePayload {
  name?: string;
  description?: string | null;
  column_overrides?: EventLogColumnOverrides | null;
}
