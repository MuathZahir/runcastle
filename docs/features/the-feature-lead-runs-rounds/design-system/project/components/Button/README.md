# Button

Buttons in four weights; **primary** (inverted neutral) appears at most once per view, for the thing the page is for.

**Use** `primary` for the one next step ("New chat", "Start burn", "Merge"). `secondary` (hairline) for the other real actions beside it. `ghost` for toolbar and row actions — most buttons are ghost. `danger` only inside a destructive confirmation.

**Consumer provides** `variant` (`primary · secondary · ghost · danger`, default secondary), `size` (`sm` 24 · `md` 28 · `lg` 32), an optional `icon` name, optional `kbd` hint, and the label as children. With an icon and no children it becomes a square icon button and needs `label`.

**Do** write verbs in sentence case: "Test drive", "Back to shipped". Put a leading icon on primary/secondary buttons when an icon exists for the verb.
**Don't** use a second primary to fix hierarchy; don't colour buttons violet/blue; don't add a border to ghost buttons.
