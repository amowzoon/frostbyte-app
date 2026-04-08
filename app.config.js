const appJson = require('./app.json');

export default {
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      backendUrl: process.env.BACKEND_URL || 'http://localhost:8080',
    },
  },
};