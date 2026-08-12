# UI State Management

There are so many issues with the runcastle UI. It goes out of sync with the state very frequently. For example, when the agent creates a spec or the tickets, they don't appear in the UI unless I refresh the page. Refreshing takes me to the project chooser page and I would have to click again on the project which is very annoying. Sometimes, I would be in the grilling session, but it still says "Start grill session" in the button at the top. Sometimes, when I leave the page for long and come back, some tickets may be frozen, I have to refresh the page again to see whether they're completed or not. These issues are everywhere, even when I click merge and a conflict appears, I have to refresh the page to see the conflict banner. This is NOT ACCEPTABLE. We need to find the root cause and improve the rendering, even if it's an architectural issue

- Slug: ui-state-management
- Created: 2026-08-12T13:15:54.546Z
