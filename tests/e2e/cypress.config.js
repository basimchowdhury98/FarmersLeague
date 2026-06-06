const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:8080',
    env: {
      mockApiUrl: 'http://localhost:5081'
    },
    supportFile: false
  }
});
