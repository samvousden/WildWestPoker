# Server

Node.js/Express server for the multiplayer poker game.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Server runs on `http://localhost:5000` by default.

## Environment Variables

- `PORT` — Server port (default: 5000)
- `HOST` — Bind host (default: 0.0.0.0)
- `FRONTEND_URL` — Single CORS origin for frontend (default: http://localhost:5173)
- `FRONTEND_URLS` — Optional comma-separated CORS origins for multiple frontend domains

## Socket.io Events

### Client → Server

- `join-table` — Join the game table
  - Args: `playerName: string`
  - Returns: `{ playerId: number, success: boolean }`

- `set-ready` — Mark player as ready/not ready
  - Args: `playerId: number, isReady: boolean`

- `start-hand` — Initiate a new hand
  - Args: `playerId: number`

- `submit-action` — Make a poker action (fold, check, call, raise)
  - Args: `playerId: number, action: PokerAction`
  - Returns: `{ success: boolean, error?: string }`

- `use-item` — Use a shop item (cheating, gun, etc.)
  - Args: `playerId: number, useType: number, targetPlayerId?: number`

### Server → Client

- `game-state-updated` — Emitted whenever game state changes
  - Data: `GameState`

- `player-ready` — Player ready/unready status changed
  - Data: `{ playerId: number, isReady: boolean }`

- `hand-started` — New hand has begun
  - Data: `GameState`

- `player-disconnected` — Player left the game
  - Data: `{ playerId: number }`

## Deployment

### AWS Lambda + API Gateway (REST + WebSocket)

For production WebSocket support on Lambda, use:
- AWS API Gateway WebSocket API
- Lambda authorizers for authentication
- DynamoDB for game state persistence

See `amplify.yml` for Amplify configuration.

### AWS EC2 / ECS

For persistent connections without polling, deploy to:
- EC2 instance with Elastic IP
- ECS container behind ALB
- RDS for persistence

The current code is ready for either approach.
