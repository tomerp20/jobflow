# E2E-First Testing Strategy for Frontend CI

The frontend test suite consists exclusively of end-to-end tests (Playwright + Chromium) running against the full stack — real backend, real Neon test DB. Unit and component tests were considered but deferred.

The primary goal is catching regressions in Claude-authored PRs before merge. The bugs Claude is most likely to introduce cross layer boundaries: a wrong API call, a misread response shape, a field that updates in the UI but doesn't persist. These are invisible to unit and component tests, which mock the network. Only a real stack catches them.

Unit tests (pure logic) and component tests (React Testing Library) address a different risk — accidental behaviour changes in isolated pieces of code. That risk is lower for this project at this stage, and the coverage from 11 well-chosen E2E tests is broader per test than the equivalent investment in unit/component tests would be.

## Considered Options

- **Unit + component + E2E (standard pyramid)** — rejected because the investment in the lower layers doesn't address the actual failure mode (cross-layer breakage) and would spread effort thin at the start.
- **Component tests only (no real stack)** — rejected because they require network mocking, which is exactly what hides the bugs we care about.

## Consequences

- Adding E2E tests requires the full stack to be running; there is no lightweight test harness for individual components.
- If a purely frontend logic bug emerges that E2E tests don't catch, unit or component tests should be added reactively at that point.
