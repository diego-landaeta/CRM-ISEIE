---
name: Tests from day 1
description: Diego wants tests written alongside every backend module, not after
type: feedback
---

Tests must be created alongside every backend module from day 1. Use vitest + supertest against crm_test_db (real DB, not mocks).

**Why:** Diego explicitly said "tenemos que hacer test desde el dia 1".
**How to apply:** Every new module must include a test file in backend/tests/. Run tests before marking any story as Done. SSH tunnel required for local test runs (port 15432).
