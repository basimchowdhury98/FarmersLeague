---
name: wireframe
description: Use when planning a new UI-facing feature, visual interaction, component behavior, layout, icon, style option, or user-facing flow before implementation.
---

Use this skill whenever the user is planning a new UI-facing feature and the next step would benefit from visual options, mockups, or interactive follow-up questions.

## Purpose

Create a temporary, one-file HTML wireframe that acts as a visual planning interface between the user and the LLM.

The wireframe is throwaway code. It is not production app code and should not be committed unless the user explicitly asks.

## Behavior

When this skill is used:

- Delegate creation of the temporary HTML file to the `wireframe` subagent.
- If the main agent is in plan mode or otherwise read-only, still delegate to the `wireframe` subagent. Do not respond that the wireframe file must wait for execution mode unless the subagent itself is unavailable or blocked.
- Treat the `wireframe` subagent as the allowed writer for `/tmp/opencode/wireframes/**`; the main agent should not write the file directly.
- Keep the main planning context focused on product decisions and implementation planning.
- Provide the subagent with the feature being planned, relevant UI files or patterns, and the decisions the user needs to make.
- Do not build the HTML directly in the main context unless the `wireframe` subagent is unavailable.
- Do not modify production UI code while creating the planning wireframe unless the user explicitly asks.

## Subagent Instructions

Ask the `wireframe` subagent to:

- Create the temporary file even when the main agent is operating in plan mode, because the subagent has scoped permission for `/tmp/opencode/wireframes/**`.
- Inspect the current app UI, HTML, CSS, Angular templates, components, and design patterns first.
- Build a single standalone HTML file under `/tmp/opencode/wireframes/`.
- Create `/tmp/opencode/wireframes` if needed.
- Return a `file:///tmp/opencode/wireframes/<name>.html` URL, and optionally open it with `xdg-open` or serve it with `python3 -m http.server <port> --directory /tmp/opencode/wireframes` when direct file opening is not enough.
- Visually match the existing app as closely as practical.
- Use existing colors, spacing, typography, component shapes, labels, and interaction patterns from the app.
- Include mockups for the feature being discussed.
- Include interactive controls for the user to choose between options.
- Use checkboxes, radio buttons, dropdowns, text inputs, textareas, sliders, buttons, or previews where useful.
- Include concise explanations beside options so the user can make decisions without reading code.
- Include a final `Done` button at the bottom.

## Required HTML Behavior

The temporary HTML page should:

- Be self-contained in one `.html` file.
- Include inline CSS and inline JavaScript.
- Avoid external dependencies unless already used by the app and easy to reference.
- Work by opening directly in a browser or through a simple local static server.
- Capture all user selections and freeform answers into a structured JSON object.
- On `Done`, send the answers back to the active opencode TUI session through the opencode server when possible.

Preferred `Done` behavior uses the opencode server API documented at `https://opencode.ai/docs/server/`:

- Let the user configure the server base URL, defaulting to `http://127.0.0.1:4096`.
- Build a concise message containing the wireframe title, selected options, freeform answers, and the raw JSON payload.
- First call `POST /tui/append-prompt` with body `{ "text": "<message>" }` to append the result to the active TUI prompt.
- Then call `POST /tui/submit-prompt` with an empty JSON body to submit it.
- If a session ID is explicitly provided, the page may instead call `POST /session/:id/prompt_async` with body `{ "parts": [{ "type": "text", "text": "<message>" }] }`.
- Show clear success or failure status after submission.

Fallback behavior:

- Render a clearly labeled summary panel containing the JSON answers.
- Copy the JSON answers to the clipboard when possible.
- Tell the user to paste the copied summary back into the chat if server submission fails or CORS/authentication prevents the request.
- If the server is protected with HTTP basic auth, tell the user the browser may prompt for credentials or the request may fail unless the server allows it.

## Planning Flow

Use the wireframe to:

- Show multiple visual directions.
- Let the user choose icons, layout styles, wording, behaviors, and interaction details.
- Ask follow-up questions in the UI instead of only in chat when visual context helps.
- Let the user preview combinations of selected options.
- Gather implementation constraints or preferences before changing production code.

After the user submits the wireframe answers:

- Review the selections once more in chat.
- Confirm any ambiguous choices.
- Continue with the implementation plan or code changes only after the user confirms.

## File Location

Create temporary wireframes under:

- `/tmp/opencode/wireframes/`

Use descriptive filenames like:

- `/tmp/opencode/wireframes/icon-picker.html`
- `/tmp/opencode/wireframes/draft-lobby-layout.html`

## Constraints

- Do not treat the generated HTML as production code.
- Do not add app dependencies for the wireframe.
- Do not modify production UI code while creating the planning wireframe unless the user explicitly asks.
- Keep the one-file HTML easy to delete.
- Prefer practical fidelity over perfect reproduction.
- Keep wireframes outside the repo under `/tmp/opencode/wireframes/` unless the user explicitly asks to preserve one.
