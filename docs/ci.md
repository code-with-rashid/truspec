# CI/CD integration

TruSpec is built to be a build gate. Every command exits **non-zero on failure**, speaks
`--json`, and can emit **JUnit XML** — so wiring it into CI is mostly choosing which gates
you want.

The three gates:

| Gate | Command | Fails the build when… |
|---|---|---|
| **Requests pass** | `truspec run` | any assertion fails. |
| **No drift** | `truspec drift` | the collection and spec have diverged. |
| **Enough coverage** | `truspec coverage --min N` | tested-operation coverage drops below `N`. |

---

## GitHub Actions

A complete workflow that mocks the API, runs the collection, and gates on drift and
coverage:

```yaml
# .github/workflows/api.yml
name: API contract
on: [push, pull_request]

jobs:
  truspec:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      # Start an offline mock from the spec so tests don't need a deployed API.
      - name: Start mock
        run: npx truspec mock --spec openapi.yaml --port 4000 &

      - name: Run requests
        run: npx truspec run ./api --env ci --reporter junit --output truspec-junit.xml
        env:
          token: ${{ secrets.API_TOKEN }}   # resolves the `token` secret in the env file

      - name: Check drift
        run: npx truspec drift --spec openapi.yaml ./api

      - name: Check coverage
        run: npx truspec coverage --spec openapi.yaml ./api --min 80

      # Optional: surface results in the GitHub UI from the JUnit report.
      - name: Publish test report
        if: always()
        uses: dorny/test-reporter@v1
        with:
          name: TruSpec
          path: truspec-junit.xml
          reporter: java-junit
```

Notes:

- `npx truspec …` avoids a global install step.
- The `env:` block maps a GitHub secret to the variable name your
  [environment file declares](#secrets-in-ci). TruSpec masks resolved secret values in its
  output.
- Each gate is its own step, so a failure tells you *which* check broke.

---

## Secrets in CI

Your environment file declares secrets **by name** — never the value:

```yaml
# api/environments/ci.env.yaml
name: ci
variables:
  baseUrl: "http://localhost:4000"
secrets:
  - token
```

In CI, provide the value as an **environment variable** of the same name:

```yaml
- run: npx truspec run ./api --env ci
  env:
    token: ${{ secrets.API_TOKEN }}
```

TruSpec resolves `token` from the OS environment (a workspace `.env` is also honored, with
real OS env winning). Resolved secret values of 6+ characters are **masked with `***`** in
all reported output — human, JSON, and JUnit — so they don't leak into build logs. If a
declared secret isn't provided, the run prints a warning naming it.

---

## JUnit reports

`--reporter junit` emits a standard JUnit document — one `<testcase>` per request — that
most CI platforms render natively:

```bash
truspec run ./api --env ci --reporter junit --output truspec-junit.xml
```

Pair it with `--output` so a reporter step can pick the file up. Failed requests include
their assertion failures (and any error) as the `<failure>` message.

---

## Machine-readable output

Every reporting command supports `--json`, so you can post-process results — e.g. comment
coverage on a PR, push metrics to a dashboard, or fail on a custom condition:

```bash
truspec coverage --spec openapi.yaml ./api --json | jq '.percent'
truspec drift    --spec openapi.yaml ./api --json | jq '.added'
```

Because the exit code already encodes pass/fail, you usually don't need to parse anything —
but the JSON is there when you want detail.

---

## Other CI systems

The pattern is identical anywhere — these are just shell commands with exit codes:

```bash
# GitLab CI, CircleCI, Jenkins, etc.
npx truspec mock --spec openapi.yaml --port 4000 &
npx truspec run ./api --env ci --reporter junit --output report.xml
npx truspec drift    --spec openapi.yaml ./api
npx truspec coverage --spec openapi.yaml ./api --min 80
```

Point your platform's test-report ingestion at `report.xml`, and expose secrets as
environment variables named to match your environment file's `secrets:` list.

---

## See also

- **[CLI reference](./cli.md)** — every flag and exit code.
- **[Spec sync](./spec-sync.md)** — what drift and coverage actually check.
- **[File format → Environments](./file-format.md#environment-files)** — declaring secrets.
