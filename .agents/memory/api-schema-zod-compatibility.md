---
name: API schema and Zod compatibility
description: A compatibility constraint between generated API validation and the workspace Zod catalog.
---

Generated API validation currently targets the workspace's Zod 3-compatible runtime. OpenAPI integer fields can produce `zod.int()` in generated output, which is unavailable in that runtime.

**Why:** Code generation succeeded but the shared library typecheck failed when integer schemas were introduced.

**How to apply:** Keep numeric API fields represented as `number` in OpenAPI unless the workspace Zod catalog and all dependent packages are upgraded together.