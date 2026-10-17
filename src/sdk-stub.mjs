// Stands in for the RUN.game SDK when the game runs headless: everything resolves at once, nothing is stored.
const none = async () => null
export default {
  initializeAsync: async () => {},
  appStorage: { getItem: none, setItem: none },
  deviceCache: { getItem: none, setItem: none },
  social: { shareLinkAsync: none, setShareIntentAsync: none },
  leaderboard: { submitScore: none },
  app: { resolveLaunchIntent: none },
}
