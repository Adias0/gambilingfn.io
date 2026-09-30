# LuckyPixel Casino on GitHub Pages

A fictional casino simulation that uses **virtual credits with no cash value**. There are no deposits, withdrawals, purchases, prizes, or cryptocurrency anywhere in the code.

## 1. Publish it

1. Create a new repository on GitHub, for example `luckypixel`.
2. Upload **everything in this folder** to the root of the repository, including the hidden `.nojekyll` file. (On github.com: **Add file → Upload files**. If `.nojekyll` doesn't upload, create an empty file with that name using **Add file → Create new file**.)
3. Go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/luckypixel/`.

Right away, every game works and progress is saved in each player's browser.

## 2. Turn on sign-in, friends, battles, redeem codes, and admin with Firebase

GitHub Pages can't run a server, so accounts are stored in **Firebase**, Google's free sign-in and database service. It takes about 15 minutes, once.

1. Go to **console.firebase.google.com**, choose **Create a project**, and name it (Google Analytics is optional; you can turn it off).
2. **Sign-in:** open **Build → Authentication → Get started**. Under **Sign-in method**, choose **Email/Password**, turn it on, and save.
3. **Allow your site:** in **Authentication → Settings → Authorized domains**, choose **Add domain** and enter `YOUR-USERNAME.github.io`.
4. **Database:** open **Build → Firestore Database → Create database**. Pick a location near your players and start in **production mode**.
5. **Security rules:** in Firestore, open the **Rules** tab, delete everything there, paste in the whole `firestore.rules` file from this folder, and press **Publish**.
6. **Connect the site:** open **Project settings** (the gear icon) → **General** → **Your apps**, and choose the **Web** icon (`</>`). Give it a nickname and register it (you don't need Firebase Hosting). Under **SDK setup and configuration**, choose **Config**. Firebase shows a block like this:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```
   Open `config.js`, and paste that whole block **over** the line that says `const firebaseConfig = null;`. Copy only that block, not the `import` lines.
7. Upload the changed `config.js` to your repository and wait a minute or two for GitHub Pages to update.
8. **Check your setup:** open `https://YOUR-USERNAME.github.io/luckypixel/setup.html`. It tests every step and tells you exactly what to fix. When everything is green, open your site: it shows the sign-in screen, and players must register before they play.
9. **Make yourself admin:** register on your site first. Then in Firebase open **Authentication → Users** and copy your **User UID**. Open **Firestore Database → Start collection**, name it `admins`, set the **Document ID** to your UID, add any field (for example `role` = `admin`), and save. Reload the site and the **Admin** tab appears.

Add more admins the same way. Only people in `admins` can see player results, moderate profiles, and create redeem codes.

### What players get with Firebase

- Registration with email and password, and a **Forgot your password?** link that emails a reset link (you can edit that email in **Authentication → Templates**)
- Profiles with photos, bios, and tags (checked with basic rules for links, contact details, money offers, and blocked words)
- Friends, friend matches, and case battles, updating live
- Redeem codes from admins

### Redeem codes

In the **Admin** tab, under **Redeem codes**, set how many VC each player gets, how many players can use the code, and an optional expiry, then choose **Create code**. Share the code however you like. Players open **Redeem a code** in the lobby or their account menu. Each player can use a code once, and you can turn a code off at any time.

Codes only hand out free virtual credits. Don't sell them or trade them for anything of value: that would make the site a real gambling service.

### Free plan limits

Firebase's free plan allows about 50,000 database reads and 20,000 writes a day. Each game round saves the player's record once, so that's plenty for a small community. If you outgrow it, Firebase will ask before charging anything.

## Not seeing login or registration?

Open **setup.html** on your site (for example `https://YOUR-USERNAME.github.io/luckypixel/setup.html`). It checks your settings step by step. The most common causes are:

- **Firebase settings not added yet.** Without them, sign-in is switched off on purpose and the site runs in play-without-account mode.
- **A paste mistake in `config.js`.** The site then shows "Sign-in isn't set up correctly," and setup.html points to the exact line.
- **Old files cached.** GitHub Pages and browsers can keep old files for about 10 minutes. Wait, then reload with Ctrl+Shift+R (or Cmd+Shift+R on a Mac).
- **Rules not published, database not created, or Email/Password not turned on.** setup.html names whichever one it is.

## Or use your own server instead of Firebase

If you run `server.js` from the **luckypixel-site** package on a Node.js host, leave `const firebaseConfig = null;` as it is and put the server's address in `serverAddress` in `config.js`. On that server, set `ALLOWED_ORIGINS=https://YOUR-USERNAME.github.io`. That package's README has the details.

## Files

| File | What it does |
|---|---|
| `index.html` | The page, including the intro and sign-in screen |
| `styles.css` | All the styling |
| `app.js` | The games and the rest of the site |
| `lp-platform.js` | Connects to Firebase or your server, based on `config.js` |
| `config.js` | Your settings |
| `firestore.rules` | Security rules to paste into Firebase |
| `setup.html` | Checks your setup and explains anything that's missing |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |

## Good to know

- The Firebase settings in `config.js` are meant to be public. Your data is protected by `firestore.rules`, which only let players change their own things.
- Game results are calculated in the player's browser, so someone technical could edit their own balance. That's harmless with virtual credits, but treat balances as for fun.
- The site promises that credits have no cash value. Adding deposits, paid credits, prizes, gift cards, or cash-outs would turn it into a real gambling service, which needs a license in almost every country.
