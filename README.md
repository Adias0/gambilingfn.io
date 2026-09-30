# LuckyPixel Casino on GitHub Pages

A fictional casino simulation that uses **virtual credits with no cash value**. There are no deposits, withdrawals, purchases, prizes, or cryptocurrency anywhere in the code.

## Publish it (about 5 minutes)

1. Create a new repository on GitHub, for example `luckypixel`.
2. Upload **everything in this folder** to the root of the repository, including the hidden `.nojekyll` file. (On github.com, open the repo, choose **Add file → Upload files**, and drag the files in. If `.nojekyll` doesn't upload, create an empty file with that name using **Add file → Create new file**.)
3. Go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute or two, the site is live at `https://YOUR-USERNAME.github.io/luckypixel/`.

To update it later, upload the new files over the old ones.

## What works on GitHub Pages by itself

GitHub Pages only hosts files; it can't run a server. Out of the box you get:

- Every game: Pixel Reels, Pixel Crossing, Plinko, cases, roulette, blackjack, and coin flip
- The intro animation, sounds, daily bonus, stats, and the leaderboard
- Progress saved in each player's own browser (starting at 10 virtual credits)

Registration, friends, matches, case battles, profiles, and the admin panel are hidden, because they need a server to store accounts that everyone shares.

## Turning on accounts, friends, battles, and admin

Run the LuckyPixel server (`server.js` from the **luckypixel-site** package) on a host that runs Node.js, and point this site at it:

1. Deploy the **luckypixel-site** folder to a Node.js host such as Render, Railway, or Fly.io, with the start command `npm start`. Its README has the details. Use a persistent disk for its `data` folder, or accounts will be lost when the server restarts.
2. On that server, set these environment variables:
   - `ALLOWED_ORIGINS=https://YOUR-USERNAME.github.io` (your GitHub Pages address, no path, no trailing slash)
   - `TRUST_PROXY=true`
   - `COOKIE_SECURE=true`
3. Create your admin login on the server: `node server.js create-admin`. It prints the username and password once.
4. In this folder, edit `config.js` and put the server's address in `apiBase`, for example:
   ```js
   window.LP_CONFIG = { pages: true, apiBase: 'https://luckypixel-server.onrender.com' };
   ```
5. Upload the changed `config.js` to your repository.

The GitHub Pages site now shows the sign-in screen, and players must register before they play. Their accounts live on your server.

If the page says it can't connect, the server may be asleep (free hosts pause idle apps and take up to a minute to wake), or `ALLOWED_ORIGINS` doesn't match your GitHub Pages address exactly.

## Files

| File | What it does |
|---|---|
| `index.html` | The page, including the intro and sign-in screen |
| `styles.css` | All the styling |
| `app.js` | The games and the rest of the site |
| `lp-platform.js` | Connects to your server when `config.js` has an address |
| `config.js` | The one setting you may need to change |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |

## Keep it virtual

The site promises that credits have no cash value. Adding deposits, paid credits, prizes, gift cards, or cash-outs would turn it into a real gambling service, which needs a license in almost every country and would make those promises false.
