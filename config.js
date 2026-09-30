/*
 * LuckyPixel settings for the GitHub Pages copy. Pick one way to run accounts:
 *
 *  1. Nothing (leave firebase null and apiBase empty): every game works and progress is saved
 *     in each player's browser. Sign-in, friends, battles, redeem codes, and admin are hidden.
 *
 *  2. Firebase (free, nothing to run): paste your Firebase web app settings below.
 *     README.md walks through it step by step.
 *
 *  3. Your own LuckyPixel server (server.js): put its address in apiBase.
 *
 * These Firebase values are meant to be public. Your data is protected by firestore.rules.
 */
window.LP_CONFIG = {
  pages: true,

  firebase: null,
  // firebase: {
  //   apiKey: 'AIza...',
  //   authDomain: 'your-project.firebaseapp.com',
  //   projectId: 'your-project',
  //   appId: '1:1234567890:web:abc123'
  // },

  apiBase: '',   // for example: 'https://luckypixel-server.onrender.com'

  // Optional: extra words to block in player tags and bios (used with Firebase).
  blockedWords: []
};
