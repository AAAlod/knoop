# Knoop JSON interfaces

Knoop uses four JSON formats:

| Format | Purpose | Versions |
| --- | --- | --- |
| `knoop-bank` | Import or export one question bank | 1.0, 1.1 |
| `knoop-bundle` | Transfer multiple banks | 1.0 |
| `knoop-error-review` | Export wrong answers for review | 1.0, 1.1 |
| `knoop-repair-review` | Export marked questions for repair | 1.0, 1.1 |

The `schemas/` directory contains Draft 2020-12 JSON Schemas. The `docs/` directory explains field semantics and AI guidance. Small synthetic examples are in the repository's `examples/` directory.

The application validator also checks cross field rules such as node references, question IDs, and answer option references. Schema validation alone does not cover these rules.
