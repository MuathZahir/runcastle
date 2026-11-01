# One-line install — decisions

## 1. Bun and runcastle install before the list; the one yes covers everything else
**Decision:** The small script installs Bun and runcastle straight away, with no question, because that is what the person ran the command for. Both go in their home folder and need no `sudo`. It then hands over to a new `runcastle setup`, which uses the doctor's checks to show everything else that is missing and asks the one yes. If `unzip` is missing, Bun's own installer will not run, so in that case only the script asks for `sudo` to install `unzip` before the list appears.
**Why:** The doctor runs on Bun, so nothing can draw the list on a clean machine until Bun is there. Putting Bun and runcastle on the list would mean writing every check again in shell and PowerShell, and those copies would drift from the doctor. The cost is that someone who answers no keeps Bun and runcastle on their machine.
