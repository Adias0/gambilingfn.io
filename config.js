/*
 * LuckyPixel settings for the GitHub Pages copy.
 *
 * Leave apiBase empty to run without a server: every game works, and each player's
 * progress is saved in their own browser. Accounts, friends, case battles, and the
 * admin panel are hidden.
 *
 * To turn those on, run server.js from the luckypixel-site package on a Node.js host,
 * set ALLOWED_ORIGINS on that server to this site's address (for example
 * https://yourname.github.io), and put the server's address below.
 */
window.LP_CONFIG = {
  pages: true,
  apiBase: ''   // for example: 'https://luckypixel-server.onrender.com'
};
