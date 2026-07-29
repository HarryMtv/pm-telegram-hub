# adapter-list-comments

## Purpose

Extend the `ProviderAdapter` contract with a comment read path so the core can fetch a
task's comment thread as unified `Comment[]` without any provider-name branching — the
read counterpart to the existing `addComment`, mirroring `adapter-list-tasks`.

## ADDED Requirements

### Requirement: Unified Comment model

The unified models SHALL include a `Comment` type carrying the provider comment id,
author name (and author id when available), a plain-text body, and a creation timestamp.
The core MUST consume comments only through this unified type.

#### Scenario: A provider comment maps to the unified model

- **WHEN** an adapter reads a comment from a provider
- **THEN** it returns a `Comment` with `id`, `authorName`, `body`, and `createdAt`, with
  provider-specific structures (e.g. Jira Atlassian Document Format) flattened to plain
  text inside the adapter

### Requirement: Adapter lists comments

The `ProviderAdapter` contract SHALL include a `listComments(connection, taskId, opts?)`
method that returns `Comment[]` for a task through the connection's rate limiter. Every
adapter MUST implement it, and the core MUST call it without branching on the provider
name. `opts` MAY carry a `limit`.

#### Scenario: Listing comments for a task

- **WHEN** the core calls `listComments` for a connection and task
- **THEN** the adapter returns that task's comments as `Comment[]` in chronological order
  (oldest first), resolved through the per-connection rate limiter

#### Scenario: Limiting the returned comments

- **WHEN** `listComments` is called with a `limit`
- **THEN** the adapter returns at most that many comments

### Requirement: Conformance coverage for listComments

Adapter conformance tests SHALL cover `listComments`, and the `FakeAdapter` SHALL
implement it so the contract is exercised without live credentials.

#### Scenario: Conformance suite runs against every adapter

- **WHEN** the conformance test suite runs
- **THEN** it verifies each adapter (including `FakeAdapter`) implements `listComments`
  and returns unified comments
