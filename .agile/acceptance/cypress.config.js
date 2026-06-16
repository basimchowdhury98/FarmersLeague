const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:8080',
    specPattern: '*.cy.js',
    supportFile: 'cypress/support/commands.js'
  }
});
