# mini-app-connections

## Purpose

The Connections screen: view connections, disconnect (with webhook
deregistration), render adapter credential forms, and admin-webhook onboarding for
providers that require it.

## Requirements

### Requirement: List connections

The Connections screen SHALL show the authenticated user's provider connections with
provider name and active status, and MUST NOT expose credentials.

#### Scenario: User with connections

- **WHEN** the Connections screen loads for a user with one or more connections
- **THEN** each connection is listed with its provider and active/inactive status,
  and no credential values are present in the response or UI

#### Scenario: User with no connections

- **WHEN** the screen loads for a user with no connections
- **THEN** an empty state is shown inviting the user to connect a provider

### Requirement: Render credential forms from the adapter

The screen SHALL render a connect form per available adapter using the fields from
`credentialFields()`, masking `token`/`password` fields.

#### Scenario: Multi-field provider form

- **WHEN** an adapter declares multiple credential fields (e.g., baseUrl, email,
  apiToken)
- **THEN** the form renders one input per field with its label and placeholder, and
  secret fields are masked

#### Scenario: Submitting a connect form

- **WHEN** the user fills a provider's fields and submits
- **THEN** the credentials are sent to `POST /api/connect`, and on success the
  connections list refreshes to include the new connection

### Requirement: Disconnect a provider

The user SHALL be able to disconnect a connection. Disconnecting MUST deregister the
provider webhook (for auto-setup providers) before removing the connection.

#### Scenario: Confirmed disconnect

- **WHEN** the user confirms disconnecting a connection
- **THEN** `DELETE /api/connections/:id` deregisters the provider webhook and removes
  the connection, and the connection disappears from the list

#### Scenario: Only the owner can disconnect

- **WHEN** a disconnect request targets a connection not owned by the authenticated
  user
- **THEN** the request is rejected and no data is changed

### Requirement: Admin-webhook onboarding

For providers whose `capabilities().webhookSetup` is `admin-required`, the screen
SHALL present admin setup steps including the webhook URL and generated secret.

#### Scenario: Admin-required provider

- **WHEN** the user connects a provider with `webhookSetup: 'admin-required'`
- **THEN** the screen shows step-by-step instructions with the webhook URL and the
  generated secret to register in the provider's admin console
