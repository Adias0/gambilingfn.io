/*
 * LuckyPixel settings for the GitHub Pages copy.
 *
 * TO TURN ON SIGN-IN, REGISTRATION, AND FRIENDS WITH FIREBASE
 *   1. In Firebase, open Project settings (gear icon) → General → Your apps → your web app.
 *   2. Under "SDK setup and configuration", choose "Config". Firebase shows a block that starts with
 *        const firebaseConfig = {
 *      and ends with
 *        };
 *   3. Copy just that block and paste it over the line below that says  const firebaseConfig = null;
 *      (Don't copy the "import" lines or anything else.)
 *   4. Upload this file to your repository, wait a minute, then open  setup.html  on your site.
 *      It checks every step and tells you if anything is missing.
 */
const firebaseConfig = null;

/*
 * ONLY IF YOU RUN YOUR OWN LUCKYPIXEL SERVER INSTEAD OF FIREBASE
 * Put its address between the quotes, for example 'https://luckypixel-server.onrender.com'.
 */
const serverAddress = '';

/* Optional: extra words to block in player tags and bios (used with Firebase). */
const blockedWords = [];

/* Leave this part as it is. */
window.LP_CONFIG = { pages: true, firebase: firebaseConfig, apiBase: serverAddress, blockedWords: blockedWords };
