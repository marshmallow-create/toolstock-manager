# Tool registration aligned with the list

**Goal:** Show the nine list labels in the new-tool form and persist editable values.

**Approach:** Keep stock and shelves in existing stock/location records and the reorder line in inventory policies. Add optional tool-level unit price and department, since registering an item does not require choosing a supplier. Preferred supplier pricing continues to take precedence. Preserve price visibility permissions. Per user clarification, 発注済み has no input and remains calculated from orders. 発注数 is editable and creates an OPEN reorder candidate when positive.

- [x] Verify a failing service test for registration using the visible fields and atomic rollback.
- [x] Add a migration for department and optional base unit price; validate and save registration, initial stock, and audit in one transaction.
- [x] Replace the new-tool form with the nine labels, remove the old policy group, and show saved department and base price in the list.
- [x] Check the registration HTTP flow, price visibility, existing edit behavior, full tests, and production build.

Verification: all 67 tests and production build pass. Migration applied to the local development database. A separate code reviewer reported no concrete findings.

Existing edit forms retain legacy metadata and policy controls; only new registration changes its input structure. Defaults for omitted legacy metadata are category 未分類, unit 個, and active true. A positive initial stock requires a shelf code. A supplied shelf uses an existing active location or creates it atomically. Safety stock defaults to zero and target stock to the reorder line when only the line is supplied. Both preserve the existing policy constraints.
