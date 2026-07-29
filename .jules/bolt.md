## 2025-02-12 - Debounced Frontend Input

**Learning:** Missing debouncing on frontend text inputs that directly map to API fetch queries causes significant network spam and can quickly exhaust both client resources and backend rate limits, especially in search-as-you-type implementations.
**Action:** Always implement a `useDebounce` hook (or equivalent) for text inputs that trigger network requests on change to preserve performance and avoid rate limit exhaustion.
