## 2023-10-24 - Search API requests bottleneck
**Learning:** In the `Inbox` component, the search input was bound directly to the global filter state which triggers a React Query fetch on every keystroke, resulting in excessive API calls.
**Action:** Always debounce text inputs that trigger network requests to prevent API spamming and unnecessary re-renders.
