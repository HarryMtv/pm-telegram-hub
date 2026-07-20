## ADDED Requirements

### Requirement: List subscriptions

The Subscriptions screen SHALL list the authenticated user's active subscriptions,
each showing its connection, subscribed event types, and container filters.

#### Scenario: Loading subscriptions

- **WHEN** the screen loads
- **THEN** `GET /api/subscriptions` returns only the authenticated user's
  subscriptions, and each is shown with its connection and event types

### Requirement: Create a subscription

The user SHALL create a subscription by choosing a connection, selecting event types
from the unified event list, and optionally selecting container filters. The
subscription MUST target the user's personal chat; the chat MUST be resolved on the
backend from the authenticated identity, not supplied by the client.

#### Scenario: Create with defaults

- **WHEN** the user selects a connection and saves without narrowing filters
- **THEN** a subscription is created for that connection targeting the user's personal
  chat with the default event types

#### Scenario: Create with event and container filters

- **WHEN** the user selects a subset of event types and one or more containers, then
  saves
- **THEN** the created subscription records those event types and container filters

#### Scenario: Re-subscribing is idempotent

- **WHEN** the user saves a subscription for a connection that already has one in the
  same chat
- **THEN** the existing subscription is updated (event types/filters refreshed) rather
  than duplicated

### Requirement: Lazily-expanded container tree

The screen SHALL present container filters as a tree loaded from the adapter, fetching
child containers on demand as the user expands nodes.

#### Scenario: Expanding a container node

- **WHEN** the user expands a container node
- **THEN** `GET /api/connections/:id/containers?parentId=<node>` returns that node's
  children via the adapter's `listContainers`, and they are shown under the node

### Requirement: Delete a subscription

The user SHALL be able to delete a subscription they own.

#### Scenario: Confirmed delete

- **WHEN** the user deletes one of their subscriptions
- **THEN** `DELETE /api/subscriptions/:id` removes it and it disappears from the list

#### Scenario: Only the owner can delete

- **WHEN** a delete request targets a subscription not owned by the authenticated user
- **THEN** the request is rejected and no data is changed
