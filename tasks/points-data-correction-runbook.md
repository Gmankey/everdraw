# Points data-correction runbook

This process applies to manual corrections of indexer-derived, user-visible points data. Points
currently have no cash or token value, but corrections still require an audit trail. A code fix
that prevents recurrence must be merged before or alongside any correction.

## Authority

- PM approval is required before every correction.
- The operator executes production corrections. A builder may execute UAT corrections after PM
  approval when no signer key is involved.
- Never edit on-chain records. Only derived indexer data may be corrected.

## Required record before execution

Create `tasks/points-data-correction-YYYY-MM-DD-<wallet-short>.md` and record:

- environment, wallet, vault, affected fields, and exact reason;
- linked defect/PR and PM approval;
- timestamp and operator;
- pre-correction API response and database rows;
- exact parameterized SQL and its row-count guard;
- expected post-correction values;
- rollback SQL.

For production, create and verify a database backup before execution. Record its identifier,
location, retention, and restoration command. UAT must at minimum record a pre-change row export.

## Execution controls

1. Run a read-only query first and verify exactly the intended rows match.
2. Execute in a transaction with an exact expected-row-count guard. Abort on any mismatch.
3. Do not alter lifetime points, historical maxima, or unrelated counters unless each field is
   explicitly approved and justified.
4. Capture the database result and public API response immediately afterward.
5. Confirm the indexer does not overwrite the correction on its next checkpoint.
6. Commit the completed evidence record to the repository.

If verification differs from the approved expectation, execute the recorded rollback immediately,
preserve both result sets, and escalate to PM before retrying.

