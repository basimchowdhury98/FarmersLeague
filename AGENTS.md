This is a web app using an angular frontend and aspnet api. Theres a scraper library to scrape fotmob website for
info about footbal/soccer matches, specfically the WorldCup and used to build a fantasy league app.

Agent behavior: 
    You will work in a "what how loop". This is similar to TDD. Any feature request or bug fix should start with
discussions about the "what". A what is a single piece of behavior expressable as a cypress test. First converge
on a simple what scenario, discuss how to represent it as a cypress test, discuss test design before finally implementing
it as a failing test then see it fail. Then go into the "how" which is the actual production implementation to statisfy
the test. Then go to the next what. Continue this loop until user is satisfied with new feature or bug fix.
    Important: after implementing a "what" as a failing Cypress test and seeing it fail, STOP. Report the failing test
result to the user and discuss/agree on the "how" before editing production code. Do not move from the failing test to
the production implementation in the same turn unless the user explicitly tells you to proceed with the how.

Dictionary:
    Use this to map terms, ideas to contexts such as rules, info about file structure, architecture, etc. Keys are 
comma separated.

Cypress, testing, specs: 
    Tests located in ./specs/cypress/
    Use `data-test` attributes for Cypress UI selectors and select them with `cy.testGet('selector-name')`
    One test should only test 1 behavior and should always test the behavior through the UI
    Setups and assertions should use a convinient test-specific api (actual web api or helper methods/cypress tasks)
        Ie 
            ARRANGE should use test-specific apis and not UI elements (unless the ui element is a easy win) to setup the
        scenario using redis and mock fot mob site
            ACT ALWAYS tests via UI and never circumvents it to call api directly
            ASSERTS should mostly use UI assertions except when its not feasable and in that case can use the test-specific
        apis to assert on redis or anything else. Only use this when necessary

Mock fotmob:
    A test specific mocked fotmob site at ./specs/mock-fotmob/
    
