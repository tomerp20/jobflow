# JobFlow

A personal job search pipeline manager. Users track job applications from discovery through final decision using a Kanban-style board.

## Language

**Application**:
A single job pursuit at a specific company — created when the user decides to track a role, and closed when the process ends (offer, rejection, or withdrawal).
_Avoid_: Card (UI term only), Job, Opportunity

**Company**:
The employer named on an Application. JobFlow does not store Companies as their own entity — the name lives as a field on each Application, and many Applications may name the same Company. Two Applications naming the same Company, compared ignoring case and surrounding whitespace, refer to the same Company.
_Avoid_: Employer, Organization (reserve "organization" / "org" for a GitHub org)

**First Sighting**:
The first time a given Company is named on any Application, across all users. Determined by comparing Company names ignoring case and surrounding whitespace. A First Sighting is the event that triggers the Company Scout; later Applications naming the same Company are not First Sightings.
_Avoid_: New company, First occurrence

**Stage**:
A user-defined step in the hiring pipeline that an Application moves through (e.g. Wishlist, Applied, Final Interview). Each user owns their own set of Stages. One Stage per user carries an `is_default` flag used as a fallback target when another Stage is deleted.
_Avoid_: Status, Column, State

**Rejection Stage**:
A Stage whose `is_rejection_stage` flag is set — the Email Agent routes matching rejection emails to this Stage. The flag is seeded automatically to the Stage named "Rejected" at account setup; there is currently no UI to change it. Only one Rejection Stage per user is expected.
_Avoid_: Terminal stage, Closed stage

**Applied Stage**:
A Stage whose `is_applied_stage` flag is set — the Email Agent places auto-created Applications here when it detects an Application Receipt. The flag is seeded automatically to the Stage named "Applied" at account setup; there is currently no UI to change it. Only one Applied Stage per user is expected. Mirrors the Rejection Stage pattern.
_Avoid_: Submitted stage, In-progress stage

**Email Agent**:
An automated process that reads the user's inbox and acts on Applications based on detected email patterns. Currently handles rejection emails and Application Receipts; designed to handle other hiring-process events in the future.
_Avoid_: Rejection Agent, Email Processor, Inbox Monitor

**Application Receipt**:
An email sent by a company to acknowledge that they received a job application. When the Email Agent detects one with no matching Application in the system, it auto-creates a new Application. Not to be confused with a rejection — an Application Receipt confirms receipt, not outcome.
_Avoid_: Application confirmation, Acknowledgement email, Receipt email

**Company Scout**:
An automated process that runs on a Company's First Sighting. It resolves the Company to every public GitHub organization that belongs to it (a Company may legitimately own multiple Orgs — e.g. `wix`, `wix-incubator`) and classifies whether the Company has an Active GitHub Presence. It writes the resolved Orgs to the JobFlow Analytics system's `companies` table (one row per Company–Org pair); it produces no Notification and no user-facing change. A sibling of the Email Agent — an automated process acting on Applications — but triggered by Company novelty rather than by email.
_Avoid_: Company Profiler, GitHub Checker, Company Agent

**Active GitHub Presence**:
The classification the Company Scout assigns to a Company: at least one of the Company's resolved GitHub organizations has at least one public repository that is not a fork, not archived, and was pushed to within the last year. A Company with no resolvable organizations, or whose repositories across all resolved Orgs are all older, forks, or archived, does not have an Active GitHub Presence.
_Avoid_: Active repos, Live org

**Org**:
A GitHub organization that the Company Scout has resolved as belonging to a specific Company. Stored in the JobFlow Analytics `companies` Cassandra table as one row per (Company, Org) pair — a single Company may legitimately own multiple Orgs (e.g. `wix`, `wix-incubator`). The pipeline always refers to "Org" in this sense; the existing JobFlow web app reserves "organization" / "org" for the same concept (see Company entry).
_Avoid_: GitHub account, Profile, Owner

**Backfill**:
The process that brings every uninitialised (Company, Org) row in the `companies` table up to date with the full local archive of GH Archive files. Runs at most once per night under a cron lock that excludes the Hourly Ingest. A (Company, Org) row stays `initialized = false` until a Backfill Run completes against it; once flipped, the Hourly Ingest takes over for that row.
_Avoid_: Initial load, Catchup (Catchup is the Hourly Ingest's fetcher mode)

**Backfill Run**:
One execution of the Backfill process, identified by a `timeuuid` `run_id`. At start, the Run locks the set of (Company, Org) pairs currently marked `initialized = false`; any (Company, Org) pair added after the Run starts is ignored by that Run and waits for the next night's Run. A Run progresses one Date at a time and records per-Date status in the `backfill_progress` table; the Run itself is recorded in `backfill_runs` with status `in_progress`, `completed`, or `failed`.
_Avoid_: Job, Batch, Sweep

**Hourly Ingest**:
The frequent, low-latency counterpart to the Backfill. Targets only (Company, Org) rows that have already been initialised by a prior Backfill Run, and incorporates each new GH Archive file as it becomes available. Backfill brings a row up to date once; Hourly Ingest keeps it current thereafter.
_Avoid_: Live ingest, Streaming ingest

**Tracked Event**:
A row in the `company_events` Cassandra table — one piece of public activity on a Company's Org repos (a code push, a pull request, an issue, a release) that survived the Ingester's filter. The set of accepted GH Archive event types is curated for analytical value, not exhaustive. Each Tracked Event carries the Company partition it belongs to, the event-time-derived month bucket, extracted Tech Tags, and an AI-attributed flag.
_Avoid_: Activity (already used for the JobFlow web app's `card_activities` rows), Event log entry

**Activity**:
A row in `card_activities` representing either a system-recorded event (action = `created`, `updated`, or `moved`) or a user-authored Note (action = `note_added`). System Activities are created automatically when an Application is created, a field changes, or the Application moves to a new Stage.
_Avoid_: Log entry, History, Event

**Note**:
A user-authored comment stored as a `card_activities` row with `action = 'note_added'`. Conceptually distinct from system Activities (it is deliberately written by the user), but structurally a subtype — both live in the same table and appear together in the Timeline.
_Avoid_: Activity, Comment

**Timeline**:
The chronological sequence of all `card_activities` rows for a single Application — system Activities and user Notes displayed together.
_Avoid_: Activity log, History

**Notification**:
A persistent in-app message informing the user of an automated action or event. Currently produced only by the Email Agent; designed to support other sources in the future.
_Avoid_: Alert, Toast, Message

**Task**:
A user-created action item with a description, priority (low / medium / high / urgent), and status (active / completed). A Task may optionally be linked to an Application; without a link it is standalone. Linked Tasks appear on the Application's detail panel; all Tasks are accessible from the dedicated Tasks page.
_Avoid_: Todo (internal/DB term), Checklist item

## Relationships

- A **User** owns a set of **Stages**
- An **Application** lives in exactly one **Stage** at a time
- One **Stage** per user is seeded as the **Rejection Stage** (the Email Agent's routing target for rejections)
- One **Stage** per user is seeded as the **Applied Stage** (the Email Agent's placement target for auto-created Applications)
- An **Application** accumulates **Activities** (system) and **Notes** (user) over its lifetime; both are stored in `card_activities` and displayed together as its **Timeline**
- The **Email Agent** moves **Applications** into the **Rejection Stage** when a matching email is received
- The **Email Agent** auto-creates **Applications** in the **Applied Stage** when an Application Receipt is detected and no matching Application exists
- The **Email Agent** produces **Notifications** to inform the user of every automated action it takes
- A **Task** may optionally be linked to an **Application**; a **Task** without a link is standalone
- The **First Sighting** of a **Company** on a new **Application** triggers the **Company Scout**
- The **Company Scout** classifies a **Company** as having an **Active GitHub Presence** or not, and reports the ones that do to the JobFlow Analytics system

## Example dialogue

> **Dev:** "When the Email Agent processes a rejection, does it create an Activity?"
> **Domain expert:** "Yes — moving an Application to a Rejection Stage creates a 'moved' Activity row, and also produces a Notification so the user knows it happened."
>
> **Dev:** "Can any Stage be a Rejection Stage?"
> **Domain expert:** "Only one Stage per user has the flag. It is seeded automatically to the stage named 'Rejected' — there is no UI to reassign it yet."

## Flagged ambiguities

- **Board** — the Kanban React component that renders all Stages and their Applications. UI-only; no database entity. Don't use in domain logic.
- "Card" is used throughout the codebase and UI as the visual representation of an **Application** on the **Board**. These are the same entity viewed at different layers — domain code should say Application, UI code may say Card.
- `cards.notes` (a freeform text field on the Application) and the `note` column on `card_activities` rows (Timeline entries) both use the word "note" but are different concepts. Interim convention: prefer `Application.notes` for the freeform field and `Activity.note` for Timeline entries. Formal renaming deferred.
