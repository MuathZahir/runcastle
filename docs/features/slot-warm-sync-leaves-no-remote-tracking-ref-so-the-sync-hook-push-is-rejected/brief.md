# Slot warm sync leaves no remote-tracking ref, so the sync hook push is rejected

Slot warm sync: fetch the attempt branch so refs/remotes/origin/<tempBranch> exists (explicit refspec or update-ref after reset --hard), keeping the hook's bare --force-with-lease intact; update burn-slot-workspace.test.ts string assertions and, where the POSIX 'driven for real' block allows, prove a warm second run's post-commit push on a new branch name is accepted; refresh the buildSlotSetupCommand step-3 doc comment. Root cause and evidence are in brief.md.
