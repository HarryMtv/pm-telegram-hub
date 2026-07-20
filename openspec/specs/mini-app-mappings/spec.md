# mini-app-mappings

## Purpose

The Mappings screen: manage container aliases (used by the bot's `/newtask`),
reusing the container-tree picker.

## Requirements

### Requirement: List mappings

The Mappings screen SHALL list the authenticated user's container aliases, each
showing its alias, provider, and target container, and whether it is the default for
its provider.

#### Scenario: Loading mappings

- **WHEN** the screen loads
- **THEN** `GET /api/mappings` returns the user's mappings and each is shown with its
  alias, provider, and container

### Requirement: Create or update a mapping

The user SHALL create a mapping by choosing a provider/container (via the container
tree picker) and entering an alias, optionally marking it the provider default.
Saving an existing alias SHALL update it rather than duplicate it.

#### Scenario: Creating a mapping

- **WHEN** the user picks a container and enters a new alias, then saves
- **THEN** `POST /api/mappings` stores the alias → container mapping and it appears in
  the list

#### Scenario: Updating an existing alias

- **WHEN** the user saves a mapping using an alias that already exists for that
  provider
- **THEN** the existing mapping is updated (new container/default flag) rather than
  duplicated

### Requirement: Delete a mapping

The user SHALL be able to delete a mapping they own.

#### Scenario: Confirmed delete

- **WHEN** the user deletes one of their mappings
- **THEN** `DELETE /api/mappings/:id` removes it and it disappears from the list
