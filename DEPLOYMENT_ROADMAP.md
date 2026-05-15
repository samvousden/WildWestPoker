# Beginner Deployment Roadmap (AWS-first)

This roadmap gets your game online so friends can join from anywhere.

## What you will deploy

- Frontend (React app): AWS Amplify Hosting
- Backend (Socket.io server): one AWS EC2 instance with Nginx + HTTPS

## Cost target

- Near free-tier for testing (depends on your AWS account/free-tier status)

## Before you start

1. Have an AWS account.
2. Put your project in a GitHub repo.
3. Make sure local build works:
   - Run: npm install
   - Run: npm run build

## Step 1: Create the backend server (EC2)

1. In AWS Console, open EC2 and create an instance.
2. Recommended for testing:
   - AMI: Amazon Linux
   - Instance: t3.micro (or free-tier eligible equivalent)
3. Security Group inbound rules:
   - SSH 22 from your IP only
   - HTTP 80 from anywhere
   - HTTPS 443 from anywhere
4. Connect to the instance using SSH.

## Step 2: Install software on EC2

Run these on the EC2 terminal:

1. Update packages:
   - sudo dnf update -y
2. Install Git, Nginx, Node.js:
   - sudo dnf install -y git nginx
   - curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
   - sudo dnf install -y nodejs
3. Enable and start Nginx:
   - sudo systemctl enable nginx
   - sudo systemctl start nginx

## Step 3: Deploy your Node backend code

1. Clone your repo:
   - git clone YOUR_GITHUB_REPO_URL
   - cd MultiplayerPokerWeb
2. Install dependencies and build:
   - npm install
   - npm run build
3. Create backend environment file at packages/server/.env:

   PORT=5000
   HOST=0.0.0.0
   FRONTEND_URL=https://YOUR_AMPLIFY_DOMAIN

   If you want multiple allowed frontend URLs later, use FRONTEND_URLS instead:

   FRONTEND_URLS=https://main.example.com,https://preview.example.com

4. Start backend with PM2:
   - npm install -g pm2
   - pm2 start packages/server/dist/index.js --name poker-server
   - pm2 save
   - pm2 startup

## Step 4: Configure Nginx reverse proxy (WebSocket-ready)

1. Create file /etc/nginx/conf.d/poker.conf with this content:

   server {
     listen 80;
     server_name YOUR_BACKEND_DOMAIN_OR_EC2_DNS;

     location / {
       proxy_pass http://127.0.0.1:5000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }

2. Test and reload:
   - sudo nginx -t
   - sudo systemctl reload nginx

## Step 5: Add HTTPS (required for clean browser behavior)

1. Point a domain or subdomain to your EC2 public IP (for example api.yourdomain.com).
2. Install certbot:
   - sudo dnf install -y certbot python3-certbot-nginx
3. Request certificate:
   - sudo certbot --nginx -d api.yourdomain.com
4. Verify HTTPS works:
   - Open https://api.yourdomain.com/health

## Step 6: Deploy frontend on Amplify

1. Open AWS Amplify Hosting.
2. Connect your GitHub repo and choose your branch.
3. Set app root to packages/client (important for this monorepo setup).
4. Add environment variable in Amplify:
   - VITE_SOCKET_URL=https://api.yourdomain.com
5. Deploy.
6. Copy your Amplify app URL.

## Step 7: Lock backend CORS to your frontend URL

1. On EC2, edit packages/server/.env.
2. Set FRONTEND_URL to your Amplify URL (or custom frontend domain).
3. Restart backend:
   - pm2 restart poker-server

## Step 8: Test with friends

1. Open frontend URL in two different browsers/devices.
2. Verify:
   - Both can connect
   - Join table works
   - Betting and showdown events sync live
3. Share URL with friends and test real internet play.

## Quick checks if something fails

1. Backend health endpoint:
   - https://api.yourdomain.com/health should return status ok
2. PM2 logs:
   - pm2 logs poker-server
3. Nginx status:
   - sudo systemctl status nginx
4. CORS issue:
   - Make sure FRONTEND_URL exactly matches your frontend domain (including https)
5. Wrong backend URL:
   - Verify Amplify env var VITE_SOCKET_URL is set and redeploy frontend

## Your project changes that support hosting

- Server now supports HOST binding and multi-origin CORS via FRONTEND_URLS.
- Server defaults to cloud-safe host binding (0.0.0.0).
- Client socket URL fallback is safer for hosted builds.
- Environment examples were updated for deployment.
