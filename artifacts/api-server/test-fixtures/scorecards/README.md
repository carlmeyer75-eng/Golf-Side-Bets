# Sanitized scorecard fixtures

These fixtures are synthetic, copyright-safe scorecards designed to exercise the
upload boundary without retaining golfer or course-provider data. All four
supported upload formats are represented:

- `copper-ridge-complete.jpg`: clear, complete 18-hole card
- `copper-ridge-rotated.png`: complete card rotated slightly clockwise
- `copper-ridge-faint.webp`: intentionally faint card for low-confidence handling
- `copper-ridge-partial.pdf`: front nine only, to exercise missing-hole warnings

Each binary has a `.model-response.json` sidecar containing its SHA-256 digest,
a recorded managed-model response, and the expected normalized draft. The
default suite verifies the digest before replaying that fixture-specific
response, so changing or corrupting an image cannot silently leave its
expectations behind.

Managed Gemini calls are supplemental and opt-in because they incur usage. They
are rate-limited to one fixture by default:

```sh
RUN_SCORECARD_IMPORT_INTEGRATION=1 pnpm --filter @workspace/api-server test -- src/lib/scorecard-import.test.ts
```

Set `SCORECARD_IMPORT_LIVE_LIMIT=4` to run all four fixtures intentionally.
