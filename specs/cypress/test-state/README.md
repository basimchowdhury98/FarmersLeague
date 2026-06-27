# Cypress Test State

This directory is the storage adapter behind Cypress domain arrangement commands.

Specs should arrange app state through domain commands from `cypress/support/commands.js`. Cypress support commands should call domain operations exposed by `createTestStateStore()`. Specs should not know Redis keys, distributed-cache serialization, storage layout, or normalized cache object shapes.

If the app moves away from Redis, replace the implementation behind `createTestStateStore()` and keep the Cypress commands stable.
