# uncleartasks.md — needs your input

From the `Platform Implementation` board (2026-07-14). `Due = Long-term/Won't-implement` cards were excluded per your instruction, so this is short. Answer inline; I'll fold resolved items into `tasks1.md`.

### () "Multi language" — two unrelated things in one card
The title says "Multi language" but the body is about a **polyglot module runtime**. Split:
- **UI translation (i18n):** no i18n framework exists today (English-only). Do you want full multi-language UI (large infra project), or is the only real ask the German-column fix (already `tasks1.md`, "Fix German Imported column")?
- **Non-Python modules (card body):** run modules not written in Python via docker-in-docker + Docker Engine SDK, a mounted docker socket, or a bundled **Java runtime**, with the end goal of porting **ProM plugins** ("ProM integration? als API/Docker oder einzelne Plugins?"), plus "Decomposing Process Performance based on Actor Behavior" and "Resource-centric dynamisch einbinden". This is a platform-architecture change (today: per-module uv venvs, in-process/subprocess).
> Which do you mean, which runtime approach, ProM API-level or per-plugin?

---

_Note: cards you marked Long-term/Won't-implement (OCEL user-tracking, user-behaviour analysis, module repository + license check, node-schema, simulate-drifts, Beginner/Intermediate/Advanced, job-progress refactor, design-system/glinui, paper-URLs, author-years, widget min-widths, A11n, DFG-algo, van-der-Aalst attribution) were excluded and are not listed._
