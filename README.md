# LuckyPixel Casino

A fictional casino simulation with Pixel Reels, Pixel Crossing, Plinko, cases, case battles, roulette, blackjack, and coin flip, plus player accounts, profiles, friends, matches, and an admin panel. Everything runs on **virtual credits with no cash value**. There are no deposits, withdrawals, purchases, prizes, or cryptocurrency anywhere in the code.

Players must create an account (email, username, password) before they can play. New accounts start with **10 virtual credits**, with bets from 0.10 up to 50.

**Upgrading from an earlier version:** replace the `public` folder and `server.js`, and keep your `data` folder. Saved balances from the old 10,000-credit scale convert automatically (divided by 1,000, so 9,896 becomes 9.90) the next time each player logs in.

## What's in this folder

| File | What it does |
|---|---|
| `server.js` | The website server: accounts, sign-in, saved data, admin tools, content checks. No dependencies. |
| `public/index.html` | The page, including the intro animation and the sign-in screen. |
| `public/styles.css` | All the styling. |
| `public/app.js` | The games and the rest of the site. |
| `public/lp-platform.js` | Connects the page to `server.js`. |
| `blocked-words.txt` | Words the basic content check rejects. Add your own. |
| `.env.example` | Optional settings. Copy to `.env` to use them. |
| `data/` | Created on first run. Holds every account and all game data. **Back it up.** |

## Requirements

- **Node.js 18 or newer** (check with `node -v`).
- A host that can run a Node.js app: a VPS, Render, Railway, Fly.io, DigitalOcean App Platform, and so on.
- It **won't** work on hosting that only serves static files or PHP (typical basic shared hosting), because accounts need `server.js` running.

## Run it on your computer

```bash
cd luckypixel-site
node server.js create-admin      # prints your admin username and password once
npm start                        # or: node server.js
```

Open http://localhost:3000, log in with the admin details, and open the **Admin** tab.

The admin password is shown only once and is stored hashed, so nobody (including you) can read it back later. If you lose it, run `node server.js create-admin <that-username>` to set a new one.

## Put it on your website

1. Upload this folder to your host (or push it to a Git repo the host deploys from).
2. Set the start command to `npm start` (or `node server.js`).
3. Set these environment variables in your host's dashboard:
   - `TRUST_PROXY=true` (most hosts put a proxy in front of your app)
   - `COOKIE_SECURE=true` once the site is on HTTPS
   - `DATA_DIR` pointing at a **persistent disk**, if your host wipes files on each deploy (Render, Railway, and Fly.io all offer persistent volumes)
4. Run `node server.js create-admin` once on the server (most hosts have a shell or console) and save the output.
5. Always serve the site over **HTTPS**, since players send passwords.

To show it on an existing site, link to it or put it on a subdomain like `play.yoursite.com`. Embedding it in an iframe on the same domain also works.

## Troubleshooting

- **“Can’t connect to the game server” or “Can’t reach the game server”:** the page loaded but `server.js` isn’t answering. Don’t open `public/index.html` directly; start the server with `npm start` and open http://localhost:3000 (or your site’s address). On a host, make sure the start command is `npm start` and the app is running. Hosting that only serves files or PHP can’t run it.
- **`create-admin` finished but the site doesn’t load:** that command only creates the login and exits. Run `npm start` afterwards to start the site.
- **Admin sign-in:** admins use the **Log in** tab, not Create account. Player names can’t contain “admin”, so the admin username won’t work as a new sign-up. If your browser autofills it into the sign-up form, clear it.
- **Lost the admin password:** run `node server.js create-admin <your-admin-username>` to set a new one.

## Admin tasks

- **See player results:** log in as admin and open the Admin tab. You'll see each player's email, balance, winnings, losses, and a per-game breakdown.
- **Moderate profiles:** open a player in the Admin tab to remove their photo, clear their bio and tags, or reset their password.
- **Reset a password from the server:** `node server.js reset-password <username-or-email>`.
- **Add another admin:** `node server.js create-admin <new-username>`.

Password-reset emails aren't included because they need an email service. Players who forget their password ask an admin, who resets it and shares the temporary password privately. Players can change their password under their account button.

## Content checks

Profile tags and bios are checked before other players can see them.

- **Without an API key:** basic rules block links, emails, phone numbers, social handles, money offers, and the words in `blocked-words.txt`. Photos aren't checked, but admins can remove them.
- **With an API key:** set `ANTHROPIC_API_KEY` (and optionally `AI_MODEL`) and tags, bios, and photos are reviewed by Claude. Usage is billed to your API account. API docs: https://docs.claude.com/en/api/overview

## Security notes

- Passwords are hashed with scrypt and never stored or logged in plain text.
- Sessions use HttpOnly, SameSite cookies, and requests are protected against cross-site forgery.
- Sign-in, sign-up, and content checks are rate limited.
- Each player can only change their own data. Admin permissions are checked on the server.
- Game results are calculated in the player's browser. Someone technical could edit their own balance. That's harmless with virtual credits, but treat balances and leaderboards as for-fun only. Making them cheat-proof would mean moving every game's dice rolls to the server.

## Keep it virtual

The site's disclaimers and its "Play responsibly" page promise that credits have no cash value. Adding deposits, paid credits, prizes, gift cards, or cash-outs would turn it into a real gambling service, which needs a gambling license in almost every country and would make those promises false.

## Backups

All data is in `data/luckypixel-db.json`. Stop the server (or copy while it's running; writes are atomic) and keep a copy somewhere safe.
