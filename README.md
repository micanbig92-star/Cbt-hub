# CBT HUB School Edition

## Project files
- `server.js` — backend API and server
- `package.json` — Node dependencies and start command
- `render.yaml` — Render deployment settings
- `public/index.html`, `public/app.js`, `public/style.css` — frontend
- `README.md` — instructions

## Upload to GitHub
Upload all files and folders, preserving the `public` folder. Do not upload `node_modules` or a live `data/db.json`.

## Deploy
Connect the GitHub repository to Render as a Web Service. Build command: `npm install`. Start command: `npm start`. The included `render.yaml` supplies these settings and a generated session secret.

## Local Android / laptop
Install Node.js 18+, run `npm install`, then `npm start`. Open `http://localhost:3000`. For local hotspot exams, student devices must connect to the same Wi-Fi/hotspot and open the host phone's LAN IP on port 3000.

## Included starter features
First admin setup; hashed passwords; admin-created teacher/student accounts; teacher approval and individual question permission; reusable question bank; shared class exam codes with expiry; student accounts; one submitted attempt per student per exam; admin start/pause/resume/end; monitoring status endpoint; connected answer autosave; objective marking and results; admin retake approval endpoint.

## Important limitations
This is a starter, not a certified exam platform. JSON storage is not durable on free Render and is not suitable for concurrent production school records. Configure PostgreSQL/persistent storage and backups before real use. Autosave requires network connectivity; this is not full offline-first synchronization. Monitoring is basic status reporting, not proctoring. Timer auto-submit, re-entry approval UI, CSV/PDF reports, rankings, class averages, audit logs, rate limiting, CSRF protection, durable session storage and load testing remain to be completed before formal exams. Render hosting requires internet; offline hotspot exams need the local phone/laptop server.
