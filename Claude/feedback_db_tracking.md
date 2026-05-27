---
name: Database tracking with full SQL
description: Every SQL migration must be saved with full SQL code in Claude/database/ folder
type: feedback
---

Every database migration or change must be documented in Claude/database/fase-X/ with:
- Full SQL code (copy-paste executable)
- Explanation of every table, enum, index
- Exact command executed on server
- Date, result, and verification of each execution

**Why:** Diego requires all executed SQL to be saved in the repo, not just descriptions.
**How to apply:** After every migration, create/update the corresponding .md file in Claude/database/ with the complete SQL and execution log.
