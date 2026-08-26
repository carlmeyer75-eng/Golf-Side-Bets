---
name: Drizzle push rename-conflict prompt
description: drizzle-kit push can require an interactive rename-vs-create choice that non-TTY shells cannot answer.
---

`drizzle-kit push` sometimes detects a schema diff that could be a column/table rename and asks which it is. That prompt is interactive, so it cannot be answered in a non-TTY shell — push fails or hangs instead of applying.

**Why:** an ambiguous diff (something dropped alongside something new in the same push) is a judgment call the tool normally resolves by asking, and there's no non-interactive flag to pre-answer it.

**How to apply:** treat this as a schema-migration risk to flag, not just a local dev inconvenience — an ambiguous rename-shaped diff can block `push` in any non-interactive context (including CI/deploy). Prefer schema changes that avoid the ambiguity (e.g. add-then-drop across separate pushes, or an explicit SQL migration) over relying on `push` to infer intent.
