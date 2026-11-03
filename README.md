# CBT HUB

Offline/local-network computer-based testing starter system for Windows laptops and Android phones.

## Included
- First-run administrator setup and separate teacher accounts.
- Create exams with a question bank of up to 1,000 MCQs.
- Choose how many questions each student receives; the server randomizes the selection.
- Question editor includes image upload and a drawing canvas (pen, eraser, line, rectangle, circle, clear and undo). Drawings are attached to the question and shown to students.
- Exam codes, student names, automatic MCQ marking and saved results.
- Admin timer controls: start, pause, resume and stop.
- Student leave/re-entry approval and prevention of a second completed attempt under the same exam/name.
- Results and exam data saved on the hosting device.

## Windows laptop
1. Install Node.js 18 or newer from https://nodejs.org/.
2. Extract this folder.
3. Open Command Prompt in this folder.
4. Run `npm install`
5. Run `npm start`
6. Open `http://localhost:3000` on the laptop. The terminal prints the local Wi-Fi/hotspot address for students.

## Android host (Termux)
1. Install Termux from its official F-Droid/GitHub distribution.
2. Run `pkg update && pkg install nodejs`.
3. Put this project folder in Termux storage (or clone your GitHub repository).
4. In the project directory run `npm install` then `npm start`.
5. Open `http://localhost:3000` on the phone. Share the printed LAN address with students connected to the same hotspot.

## First use
The first visitor creates the administrator username and password. Admin then signs in and creates teacher accounts. Keep account passwords private. Students do not need accounts; they need the exam code.

## Storage and moving between devices
All data is saved in `data/db.json` on the host. Back it up. The laptop and phone do not synchronize automatically. To move the system, stop the server and copy the project folder including `data/db.json` to the other device.

## Important notes
- GitHub is used to store/share the source code; GitHub Pages alone cannot run this shared offline exam server. The Node.js server must run on the laptop or phone.
- Only one host device runs a given session at a time. Use a private hotspot/router and keep the host on charge.
- The 100-student target needs a real load test on the chosen host and Wi-Fi equipment before a live exam. A phone hotspot may not reliably handle 100 simultaneous devices.
- This is a functional starter, not a certified high-stakes exam platform. The timer display is server-controlled but candidates' answers are submitted from their browser; further hardening, backups and load testing are recommended before formal use.
- The app stores uploaded images/drawings as data in the local JSON database. Avoid extremely large image files.
