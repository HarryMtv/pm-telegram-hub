# adapter-list-tasks

## Purpose

Extend the `ProviderAdapter` contract with task listing so the core (Mini App
unified inbox) can enumerate tasks across providers without any provider-name
branching.

## Requirements

### Requirement: Adapter lists tasks

The `ProviderAdapter` contract SHALL include a `listTasks` method that returns
`UnifiedTask[]` for a connection, supporting filters (container, assignee-is-me,
status category, text query) and pagination. Every adapter MUST implement it, and the
core MUST call it without branching on the provider name.

#### Scenario: Listing tasks for a connection

- **WHEN** the core calls `listTasks` for a connection
- **THEN** the adapter returns that connection's tasks as `UnifiedTask` items through
  the connection's rate limiter

#### Scenario: Filtering by container

- **WHEN** `listTasks` is called with a container filter
- **THEN** only tasks within that container (unified container id) are returned

#### Scenario: Filtering by assignee-is-me

- **WHEN** `listTasks` is called with the assignee-is-me filter
- **THEN** only tasks assigned to the connection's own account are returned

### Requirement: Conformance coverage for listTasks

Adapter conformance tests SHALL cover `listTasks`, and the `FakeAdapter` SHALL
implement it so the contract is exercised without live credentials.

#### Scenario: Conformance suite runs against every adapter

- **WHEN** the conformance test suite runs
- **THEN** it verifies each adapter (including `FakeAdapter`) implements `listTasks`
  and returns unified tasks for the filters above
