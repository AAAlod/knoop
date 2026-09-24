# Schema validation

The four synthetic files in `examples/` demonstrate the public JSON formats. Their names correspond to the schemas in `schemas/`:

| Example | Schema |
| --- | --- |
| `sample-bank.json` | `knoop-bank-v1.1.schema.json` |
| `sample-bundle.json` | `knoop-bundle-v1.schema.json` |
| `sample-error-review.json` | `knoop-error-review-v1.1.schema.json` |
| `sample-repair-review.json` | `knoop-repair-review-v1.1.schema.json` |

For example, with Python's `jsonschema` package installed:

```sh
python -m jsonschema -i examples/sample-bank.json docs/interface-specs/schemas/knoop-bank-v1.1.schema.json
```

The app's import validator performs additional cross field checks that JSON Schema cannot express.
