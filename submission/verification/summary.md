# Home Library

A simple personal home library tracker. Add each book with title, author, and type; note who has borrowed one and clear it when it comes back; see all books in one list and filter to just those currently lent out.

- **Target user:** One person keeping track of their own books at home
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
