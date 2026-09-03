# PR Review Agent

[![CI](https://github.com/wuchris-ch/pr-review-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/wuchris-ch/pr-review-agent/actions/workflows/ci.yml)
[![Node.js 22](https://img.shields.io/badge/node.js-22-339933)](package.json)
[![Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-2f855a)](LICENSE)

A focused security and correctness reviewer for pull requests. It accepts an
exact unified diff, runs a bounded model review, validates every verdict against
a strict contract, and produces machine-readable findings suitable for local
development, CI, or continuous GitHub review.

![Pull request review agent architecture](docs/pr-review-flow.svg)

## Validated quality

The agent is tested by the independent
[`agent-eval-k3s`](https://github.com/wuchris-ch/agent-eval-k3s) harness against
20 versioned golden diffs across three trial rounds. The result below was
recorded on September 3, 2026 with `gemini-3.8-flash`.

| Metric | Latest release-quality result |
|---|---:|
| Release gate | **PASS** |
| Average score | **1.000** |
| Accepted evaluations | **60/60** |
| Security-blocker recall | **100%** (21/21) |
| Clean-diff accuracy | **100%** (21/21) |
| Case stability | **100%** (20/20) |
| Infrastructure errors | **0** |

The evaluator, corpus, scoring policy, and results live outside this repository,
so the reviewed agent cannot see the goldens or alter its grade. See the
[complete versioned result](https://github.com/wuchris-ch/agent-eval-k3s/blob/main/benchmarks/reviewer-corpus/v1/results/2026-09-03.md).

## Why this is more than an LLM prompt

- **Exact input binding.** Every verdict carries the SHA-256 of the raw diff it
  reviewed.
- **Bounded execution.** Input, output, request size, retries, and runtime all
  have explicit limits.
- **Large-diff handling.** Multi-file diffs are partitioned at file boundaries
  and merged deterministically.
- **Strict validation.** Unknown fields, inconsistent severity, wrong digests,
  invalid paths, duplicate keys, and trailing text fail closed.
- **Repository-aware review.** Optional root `AGENTS.md` guidance can influence
  priorities but cannot change system rules or the output contract.
- **Restart-safe automation.** The watcher records a versioned head-SHA marker
  in GitHub and does not duplicate the same review after restarting.
- **Privacy-aware telemetry.** OpenTelemetry captures operational metadata, not
  source diffs, prompts, completions, credentials, endpoints, or usernames.

## Quick start

Requirements:

- Node.js 22 or newer
- An OpenAI-compatible model gateway
- GitHub CLI authenticated with `gh auth login` for remote PR commands

```sh
npm ci
npm run build
npm link
```

Configure the model gateway through your shell or local secret manager:

```sh
export MODEL_GATEWAY_API_KEY="..."
export MODEL_GATEWAY_BASE_URL="https://gateway.example/v1"
export REVIEW_AGENT_MODEL="your-model-id"
```

### Review the current branch

From any Git repository:

```sh
pr-review
```

The command compares the current branch and working tree with `origin/main` and
uses a root `AGENTS.md` when present. Override the base only when needed:

```sh
pr-review --base develop
```

### Review an existing GitHub PR

```sh
pr-review-pr 42
```

This fetches the PR diff without switching branches or changing the working
tree. It prints locally by default. Publishing is explicit:

```sh
pr-review-pr 42 --publish
pr-review-pr 42 --repo owner/repository --publish
```

Publishing creates a non-approving review comment. It never merges, approves,
or requests changes.

### Run continuous reviews

```sh
export GITHUB_TOKEN="..."
export GITHUB_REPOSITORIES="owner/one,owner/two"
pr-review-watch
```

The watcher polls every 60 seconds, reviews each new PR head SHA once per policy
version, posts a comment, and sets `PR review agent` to success or failure. A
model or contract failure produces an error status and is retried on the next
poll.

The companion evaluation repository provides the complete local k3s deployment
with Kubernetes Secrets, automatic restarts, nightly evaluation, persistent
reports, OpenTelemetry, and Phoenix.

## Verdict contract

Successful runs emit one JSON object:

```json
{
  "schema_version": "1.0",
  "input_sha256": "<SHA-256 of the exact raw diff>",
  "risk": "high",
  "blocked": true,
  "findings": [
    {
      "severity": "blocker",
      "category": "security",
      "file": "src/database.ts",
      "line": 42,
      "detail": "User input reaches a SQL query without parameterization."
    }
  ],
  "rationale": "The change introduces an exploitable SQL injection path."
}
```

Severity determines the decision:

| Highest finding | Risk | Blocked |
|---|---|---|
| `blocker` | `high` | `true` |
| `major` | `medium` | `true` |
| `minor`, `info`, or none | `low` | `false` |

There is no clean fallback. Empty input, invalid UTF-8, model failure, malformed
JSON, a mismatched digest, or an inconsistent verdict exits nonzero.

## Execution boundaries

- Raw input is capped at 1 MiB and hashed before UTF-8 decoding.
- Model messages are capped at 96 KiB and outputs at 1 MiB.
- Each gateway attempt has a 35-second timeout and transient errors receive at
  most three attempts within the outer process boundary.
- A single file that cannot fit one partition fails closed.
- Model children receive an allowlisted environment.
- Findings may only reference files present in the reviewed partition.
- Optional evaluator feedback is bounded and never changes the diff or schema.

## OpenTelemetry

Tracing activates when an OTLP endpoint is configured:

```sh
export OTEL_SERVICE_NAME="pr-review-agent"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
```

The manual span contains request status, latency, attempt count, model alias,
and input byte count. Resource auto-detection is disabled, and review content is
sent to the isolated child through standard input instead of process arguments.

## Design influences

The implementation applies proven ideas documented by
[Qodo PR-Agent](https://github.com/qodo-ai/pr-agent), including bounded handling
of large pull requests, repository-specific context, and finding
self-validation. This project keeps a narrower scope and adds its own strict
JSON contract, digest binding, fail-closed execution, evaluation corpus, and
telemetry privacy controls. No PR-Agent source code is included.

## Development

```sh
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

Unit tests use injected process results and do not call a model or network
service.

## License

Apache-2.0. See [LICENSE](LICENSE).
