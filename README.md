# Anonymous 1-to-1 Chat (Human or AI)

This project is a minimal Node.js + Socket.io application that pairs anonymous users randomly with either another human or an AI chatbot. It demonstrates a simple Turing-style prompt every 10 messages.

Features
- Anonymous connections using Socket.io `socket.id` temporarily
- Random pairing with human or AI
- Real-time message relay
- AI simulation with canned async responses
- Turing prompt every 10 messages asking: "Do you think your chat partner is Human or AI?"
- Correct guess -> option to continue or end. Incorrect guess -> chat ends immediately.
- Graceful handling of disconnects

Run locally

1. Install dependencies:

```powershell
cd C:\Users\Maranan\Documents\Projects\ChatMirage
npm install
```

2. Start the server:

```powershell
npm start
```

3. Open `http://localhost:3000` in two browser windows (or one window and one incognito) to test human-human pairing, or open just one to get paired with the AI.

Notes
- Frontend is plain HTML + JavaScript and served from `public/index.html`.
- Backend is `server.js` using `express` and `socket.io`.
