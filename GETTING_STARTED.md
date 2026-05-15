# Getting Started

## 1. Open the project

```bash
cd MultiplayerPokerWeb
```

## 2. Install dependencies

```bash
npm install
```

This will install packages for:
- `packages/shared` — Types & poker logic
- `packages/server` — Express + Socket.io backend
- `packages/client` — React + Vite frontend

## 3. Start development

### Option A: Both server and client in parallel
```bash
npm run dev
```

This runs:
- **Server**: http://localhost:5000
- **Client**: http://localhost:5173

### Option B: Individual terminals

Terminal 1 (Server):
```bash
npm run server
```

Terminal 2 (Client):
```bash
npm run client
```

## 4. Open in browser

Navigate to `http://localhost:5173` in your browser.

## Key Files to Know

### Shared Types & Logic
- `packages/shared/src/card.ts` — Card enums and utilities
- `packages/shared/src/game.ts` — Game state types
- `packages/shared/src/handEvaluator.ts` — Complete Texas Hold'em hand evaluation (ported from your C# code)

### Server
- `packages/server/src/index.ts` — Express app and Socket.io setup
- `packages/server/src/gameManager.ts` — Game logic (dealing, betting, showdown)

### Client
- `packages/client/src/context/GameContext.tsx` — Game state + Socket.io integration
- `packages/client/src/components/GameBoard.tsx` — Main game UI
- `packages/client/src/components/LobbyScreen.tsx` — Join/ready lobby

## Architecture

```
┌─────────────────────────────────────┐
│     React Browser (Amplify)         │
│  - GameBoard, LobbyScreen           │
│  - GameContext (socket.io client)   │
└──────────────┬──────────────────────┘
               │ WebSocket
       ┌───────┴────────┐
       │ Express Server │
       │  - GameManager │
       │  - Socket.io   │
       │  - In-memory   │
       │    game state  │
       └────────────────┘
       ↓
  ┌─────────────┐
  │ @poker/shared
  │ - Types     │
  │ - Hand eval │
  │ - Logic     │
  └─────────────┘
```

## Next Steps

1. **Test joining and betting** — Play a quick hand locally
2. **Add persistence** — Connect DynamoDB for player accounts
3. **Deploy to Amplify** — Push frontend to AWS Amplify
4. **Deploy server** — Host Express on EC2 or ECS for WebSocket persistence
5. **Implement cheating system** — Add item usage (guns, sleeves, cigarettes)
6. **UI Polish** — Add animations, sounds, better styling

## Common Issues

### Ports already in use
```bash
# Change in .env or package.json scripts
PORT=5001 npm run server
```

### Socket.io connection refused
Make sure server is running first, then start client.

### TypeScript errors
```bash
npm run type-check --workspaces
```

## Environment Variables

Create `.env` files in each package:

**packages/server/.env**
```
PORT=5000
HOST=0.0.0.0
FRONTEND_URL=http://localhost:5173
# Optional for multiple frontend domains:
# FRONTEND_URLS=https://main.example.com,https://preview.example.com
```

**packages/client/.env.local**
```
VITE_SOCKET_URL=http://localhost:5000
```

Good luck! 🃏🎰
