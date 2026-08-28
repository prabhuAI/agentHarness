# Home Library

A simple personal tracker for the books on your shelves at home — what they are, who you've lent them to, and which are currently out.

- **Target user:** A single home user keeping track of their own book collection and informal loans to family
- **Build route:** compile
- **Genome:** tracker
- **Persistence:** browser-local storage
- **Start:** `npm run dev` → http://localhost:3000

## Verified journeys

- PASS — Application loads and shows a useful empty state
- PASS — Invalid book input shows validation without crashing
- PASS — User can add a complete book and see it in books
- PASS — books survive a page refresh
- PASS — User can edit an existing book
- PASS — User can search books
- PASS — User can narrow books with a meaningful filter
- PASS — books are grouped by a meaningful category or status
- PASS — Requested derived values update from persisted records
- PASS — User can delete an existing book
- PASS — A one-tap action updates a book field and persists
