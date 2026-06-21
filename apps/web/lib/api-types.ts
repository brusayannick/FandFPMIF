/**
 * Manually-mirrored API types — the canonical source is FastAPI's
 * `/openapi.json`. Run `pnpm codegen` against a running backend to refresh.
 *
 * This file holds the minimum the frontend needs at the moment so we don't
 * block on having the backend up during build.
 */

export type EventLogStatus = "importing" | "ready" | "failed";

/** Case-centric (XES/CSV/XML) vs object-centric (OCEL). The two are fully
 * isolated — drives the detail-page tabs, header counts, and which endpoints /
 * modules apply. */
export type LogModel = "case_centric" | "object_centric";

export interface EventLogSummary {
  id: string;
  name: string;
  status: EventLogStatus | string;
  source_format: string | null;
  source_filename: string | null;
  log_model: LogModel;
  events_count: number | null;
  /** Case-centric counts — null for object-centric logs. */
  cases_count: number | null;
  variants_count: number | null;
  /** Object-centric counts — null for case-centric logs. */
  objects_count: number | null;
  object_types_count: number | null;
  relations_count: number | null;
  date_min: string | null;
  date_max: string | null;
  error: string | null;
  folder_id: string | null;
  position: number;
  created_at: string;
  imported_at: string | null;
  last_edited_at: string | null;
  /** The importer had to guess a mandatory column — prompts a settings review. */
  mapping_needs_review?: boolean;
}

// ── Object-centric (OCEL) data shapes (GET /event-logs/{id}/ocel/*) ──────────

export interface OcelObjectTypeEntry {
  type: string;
  count: number;
}

export interface OcelOverview {
  events_count: number;
  objects_count: number;
  object_types_count: number;
  relations_count: number;
  date_min: string | null;
  date_max: string | null;
  object_types: OcelObjectTypeEntry[];
  activities: string[];
}

export interface OcelPage {
  rows: Record<string, unknown>[];
  columns: string[];
  total: number;
  offset: number;
  limit: number;
}

export type OcelObjectsPage = OcelPage;
export type OcelEventsPage = OcelPage;
export type OcelRelationsPage = OcelPage;

export interface FolderSummary {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  created_at: string;
}

export interface ReorderItem {
  kind: "folder" | "log";
  id: string;
  parent_id: string | null;
  position: number;
}

export interface EventLogDetail extends EventLogSummary {
  detected_schema: Record<string, unknown> | null;
  description: string | null;
  column_overrides: EventLogColumnOverrides | null;
  /** The committed Events-tab filter applied to every module's view of the
   * log. `null` means the full dataset. */
  active_filter: FilterEntry[] | null;
  /** Resolved role → source-column mapping (case_id / activity / timestamp / …). */
  column_roles: Record<string, string> | null;
}

/** Manual column-role mapping submitted from settings → re-imports the log. */
export interface RemapColumnRoles {
  case_id: string;
  activity: string;
  timestamp: string;
  end_timestamp?: string | null;
  resource?: string | null;
  cost?: string | null;
  role?: string | null;
  lifecycle?: string | null;
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
  is_confidential_safe: boolean;
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

export type FilterOp =
  | "contains"
  | "equals"
  | "gte"
  | "lte"
  | "is_null"
  | "is_not_null"
  | "in";

export interface FilterEntry {
  field: string;
  op: FilterOp;
  /** A string array when `op` is "in" (the multi-select checklist); a scalar
   * for the single-value operators; omitted for is_null / is_not_null. */
  value?: string | number | boolean | string[] | null;
}

export interface ColumnValueEntry {
  value: string;
  count: number;
}

export interface ColumnValuesPage {
  field: string;
  values: ColumnValueEntry[];
  total_distinct: number;
  truncated: boolean;
}

export interface ActiveFilterResult {
  active_filter: FilterEntry[];
  modules_retriggered: boolean;
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
  folder_id?: string | null;
  position?: number;
}

// ── Watched folders ─────────────────────────────────────────────────────────

export type WatchMode = "manual" | "interval" | "continuous";
export type WatchStatus = "active" | "paused" | "error";

/** Optional per-format column mapping forced on every imported file. */
export interface WatchDefaultMapping {
  csv_mapping?: Record<string, unknown>;
  xml_mapping?: Record<string, unknown>;
  json_mapping?: Record<string, unknown>;
}

export interface WatchedFolderSummary {
  id: string;
  name: string;
  source_path: string;
  mode: WatchMode | string;
  interval_seconds: number | null;
  status: WatchStatus | string;
  dest_folder_id: string | null;
  last_scanned_at: string | null;
  last_error: string | null;
  created_at: string;
  imported_count: number;
  failed_count: number;
}

export interface WatchedFileSummary {
  source_name: string;
  status: string;
  size: number | null;
  log_id: string | null;
  error: string | null;
  imported_at: string;
}

export interface WatchedFolderDetail extends WatchedFolderSummary {
  default_mapping: WatchDefaultMapping | null;
  files: WatchedFileSummary[];
}

export interface WatchedFolderCreatePayload {
  name: string;
  source_path?: string | null;
  mode: WatchMode;
  interval_seconds?: number | null;
  default_mapping?: WatchDefaultMapping | null;
  create_dest_folder?: boolean;
  dest_folder_id?: string | null;
}

export interface WatchedFolderUpdatePayload {
  name?: string;
  mode?: WatchMode;
  interval_seconds?: number | null;
  status?: "active" | "paused";
  default_mapping?: WatchDefaultMapping | null;
}

export interface ScanResponse {
  found: number;
  imported: number;
  skipped: number;
  failed: number;
}
