# mini-app-ui-foundation

## Purpose

The shared UI foundation for the Telegram Mini App: native theming, viewport and
safe-area handling, BackButton/MainButton integration, tab navigation, and the
TanStack Query data layer that all screens build on.

## Requirements

### Requirement: Native Telegram theming

The Mini App SHALL render using the host Telegram client's theme. shadcn design
tokens MUST be derived from Telegram `--tg-theme-*` CSS variables, and the app MUST
switch between light and dark to match the client's `colorScheme`.

#### Scenario: Client in dark theme

- **WHEN** the Mini App is opened from a Telegram client set to dark mode
- **THEN** the app renders with dark background/foreground derived from
  `--tg-theme-*` variables and shadcn components use those colors

#### Scenario: Theme changes at runtime

- **WHEN** the user switches the Telegram client theme while the app is open
- **THEN** the app updates its colors to match without a reload

### Requirement: Viewport and safe-area handling

The Mini App SHALL expand to full height on launch and respect the client's
safe-area insets so content is not obscured by system UI.

#### Scenario: Launch expands viewport

- **WHEN** the Mini App launches
- **THEN** it requests full-height expansion and applies safe-area insets as layout
  padding

### Requirement: BackButton and MainButton integration

Screens SHALL drive navigation and primary actions through the native Telegram
BackButton and MainButton rather than in-content buttons for those roles.

#### Scenario: Detail screen back navigation

- **WHEN** the user opens a detail screen (e.g., a task card)
- **THEN** the native BackButton is shown, and pressing it returns to the previous
  screen

#### Scenario: Primary action via MainButton

- **WHEN** a screen has a single primary submit action (e.g., "Save", "Create")
- **THEN** that action is bound to the native MainButton, which shows a loading state
  while the action is in flight

### Requirement: Tab navigation across MVP screens

The Mini App SHALL provide navigation between the Connections, Subscriptions, Inbox,
and Mappings screens.

#### Scenario: Switching screens

- **WHEN** the user selects a different screen from the navigation
- **THEN** the corresponding screen is shown and its data is loaded

### Requirement: Query-based data layer

All server data access in the Mini App SHALL go through TanStack Query, and
mutations SHALL invalidate the affected queries so the UI reflects the new state.

#### Scenario: Mutation refreshes list

- **WHEN** a mutation succeeds (e.g., creating a subscription)
- **THEN** the related list query is invalidated and the UI shows the updated data
  without a manual refresh

#### Scenario: Request failure surfaces to user

- **WHEN** an API request fails
- **THEN** the error is surfaced to the user (e.g., a toast) rather than failing
  silently
