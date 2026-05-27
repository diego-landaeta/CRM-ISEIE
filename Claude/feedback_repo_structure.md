---
name: Repo structure - private vs public
description: The current repo (esos2dev-oss/CRM) is the PRIVATE repo with everything including credentials
type: feedback
---

The repo at github.com/esos2dev-oss/CRM is the PRIVATE repo. Everything goes here, including credentials and sensitive data.

A PUBLIC repo will be created later as a separate repo, excluding sensitive files.

**Why:** User clarified that the cloned repo IS the private one.
**How to apply:** Don't gitignore credentials or Claude/ folder in this repo. When the public repo is created later, THAT one will exclude sensitive data.
