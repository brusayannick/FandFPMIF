# End-User Manual

Written to be readable independently of the report body. Section references point back only where a reason, rather than a procedure, is wanted.

## First login

Open the platform URL. Login is mandatory and is handled by the bundled identity provider, which either shows its own form or redirects straight to the university identity provider. On a fresh local installation, sign in as `admin@flows-funds.local` with the password `flowsfunds`; a password reset is forced on first use. Further accounts are created by an administrator in the identity provider's console. The first sign-in starts a short onboarding flow that sets display preferences and, unless the deployment has disabled the step, the usage-capture choice; it is stored per account on the server and can be replayed from **Settings, About, Restart onboarding**.

## Importing an event log

Go to **Processes** and choose *Import event log*.

**Supported formats.** XES and XES.gz are primary and carry their own semantics, so no mapping is needed; CSV is accepted with a column-mapping step; a generic XML path exists for advanced users; and object-centric logs are accepted as OCEL 2.0 in JSON, XML or SQLite encodings, following a separate analysis path.

**Column mapping (CSV only).** Identify the case identifier, the activity and the timestamp, which are required. Optionally identify a resource column and an end timestamp; the end timestamp is what allows waiting time to be separated from sojourn time, and several modules offer more output when it is present. A timestamp format and a delimiter can be set, with defaults in **Settings, General**.

**What happens next.** The upload returns immediately and the new row appears greyed out with a progress bar. The log passes through *importing* while its file is parsed, then *processing* while the modules that precompute on import run against it, then becomes *ready*. A log that is still processing cannot be opened; the jobs drawer shows what it is waiting for. A *watched folder* can also be configured to poll a storage location and import new files automatically; there is no live event stream.

## The analysis views

**Processes** lists every log with its status, case, event and variant counts, the date range covered, the import time and the source format. Rows can be renamed inline, filtered by text and status, and organised into folders. Row actions cover open, rename, re-run import, export and delete.

**Process detail** opens on a ready log. The header shows the display name and key statistics. Tabs give the module grid, a browsable events table with filtering, and a variants view. A filter committed on the events tab becomes the log's active view and is what modules subsequently see.

**The module grid** is grouped by category. A card is full colour when the module applies to this log; greyed with a tooltip when a requirement is unmet, for example a missing resource column or too few events; and amber-badged "Limited" when an optional dependency is missing and the module will run in a reduced mode. Clicking an available card opens that module's panel for this log.

**Module panels** are contributed by the modules themselves and therefore differ. Graph and diagram views share a common canvas: zoom, fit, export and the view's own settings are in one control cluster, with the settings popover holding everything that changes what is drawn.

## Dashboards

A dashboard is a saved grid of cards bound to one log. Create one from **Dashboards**, add cards from any installed module's widgets, and arrange them by dragging and resizing. Each card can be configured where its module offers options, and most cards expose an explanation of what they show.

Dashboards can be exported and imported as a file, duplicated, and **shared read-only** with named users or a team. Sharing is the only way anything crosses an account boundary: recipients can view the dashboard and the data its cards render, and can change nothing.

## Monitoring jobs

Every long operation is a job. Three surfaces show them, all driven by the same live stream.

**Toasts** announce queueing, completion, failure and cancellation, with an action to open the result or retry. **The dock**, bottom left, shows the foremost job's title and progress whenever jobs are active. **The jobs drawer** opens from the dock and lists everything grouped by status, with progress, stage, elapsed and estimated remaining time, plus cancel, retry and a details view holding the payload, recent log lines and any error.

A job that reports no progress shows an indeterminate bar; if it stays silent for about three minutes the row adds a note saying so. That is not by itself a failure.

## The assistant

The chat panel on the right is bound to a model provider **you** configure under **Settings, AI**: a base URL for any OpenAI-compatible endpoint, an API key, a model name and, optionally, a custom system prompt. The key is stored on the platform host and is sent nowhere except to the endpoint you configured. The assistant can reference the active log, recent job outcomes and your enabled modules, and can carry out platform actions on your behalf.

Note the data boundary: using the assistant sends the content of your questions, and the context it draws in, to the provider you chose. One bundled module, the Concept Drift Explainer, makes the same trade-off and is labelled as not confidentiality-safe.

## Modules and account settings

**Settings, Modules** lists every installed module with its status, version and category. Each can be configured, disabled or uninstalled, and *Restore defaults* re-adds any bundled module that was removed. Installation is per account: removing a module affects only you. New modules are added from **Import**, by uploading an archive, giving a Git URL, or naming a published package. An administrator may lock a module so that it cannot be removed.

**Settings, General** covers appearance, density, locale, timestamp and delimiter defaults, and a storage gauge. **Settings, Privacy** holds the usage-capture choice where the deployment allows one. **Settings, API and MCP** issues personal access tokens for external tools. **Settings, About** shows the platform version and a *Copy diagnostics* action that puts a support-friendly summary on the clipboard.
