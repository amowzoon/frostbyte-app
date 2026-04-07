const appJson = require('./app.json');

export default {
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      backendUrl: process.env.BACKEND_URL || 'http://10.0.0.18:8000',
    },
  },
};