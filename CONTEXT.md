# JobFlow

A personal job search pipeline manager. Users track job applications from discovery through final decision using a Kanban-style board.

## Language

**Application**:
A single job pursuit at a specific company — created when the user decides to track a role, and closed when the process ends (offer, rejection, or withdrawal).
_Avoid_: Card (UI term only), Job, Opportunity

**Stage**:
A user-defined step in the hiring pipeline that an Application moves through (e.g. Wishlist, Applied, Final Interview). Each user owns their own set of Stages. One Stage per user carries an `is_default` flag used as a fallback target when another Stage is deleted.
_Avoid_: Status, Column, State

**Rejection Stage**:
A Stage whose `is_rejection_stage` flag is set — the Email Agent routes matching rejection emails to this Stage. The flag is seeded automatically to the Stage named "Rejected" at account setup; there is currently no UI to change it. Only one Rejection Stage per user is expected.
_Avoid_: Terminal stage, Closed stage

**Email Agent**:
An automated process that reads the user's inbox and acts on Applications based on detected email patterns. Currently handles rejection emails; designed to handle other hiring-process events in the future.
_Avoid_: Rejection Agent, Email Processor, Inbox Monitor

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
- One **Stage** per user is seeded as the **Rejection Stage** (the Email Agent's routing target)
- An **Application** accumulates **Activities** (system) and **Notes** (user) over its lifetime; both are stored in `card_activities` and displayed together as its **Timeline**
- The **Email Agent** moves **Applications** into the **Rejection Stage** when a matching email is received
- The **Email Agent** produces **Notifications** to inform the user of every automated action it takes
- A **Task** may optionally be linked to an **Application**; a **Task** without a link is standalone

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
