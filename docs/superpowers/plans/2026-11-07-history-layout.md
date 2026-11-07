# History layout and recorded values

User confirmed columns from RIGHT: datetime, item code, name, category, movement, quantity, actor, stock after, unit price. Layout matches the dashboard.

- [x] Immutable nullable balance/price snapshots for operations, reversals, opening stock and seed. Historical rows preserved.
- [x] Absolute transaction quantity and direction; original event details retained.
- [x] Inclusive Decimal min/max filtering before pagination; worker price restrictions preserved.
- [x] Shared WorkspaceShell and compact table; datetime visible first on narrow screens.
- [x] All 83 tests, typecheck, build and Prisma validation passed.
- [x] Independent review and Chromium desktop/tablet checks passed.
- [x] Local migration applied; old data unchanged across 13 tables. No commit.
