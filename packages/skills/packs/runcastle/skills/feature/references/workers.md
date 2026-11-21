# Workers and your folder

Read this before you start, land or drop a worker, and when you weigh building
something yourself.

## Build it yourself or hand it off

Build it yourself when writing the assignment would take about as long as
doing it. You may edit code in your folder; hand off work that is big,
self-contained, or that the human will want to look at and tweak.

## Where a worker builds

Runcastle picks the folder, not you. Workers run on this machine, with no
container.

- **The first worker builds in your folder**, on the feature branch. Its
  commits land on the branch the moment it makes them; `land_worker` only marks
  it settled. While a worker or a review works in your folder, write only your
  docs and leave code alone: two agents editing one file at once lose work.
- **A worker started while another holds your folder gets its own folder and
  branch**, cut from the feature branch's tip. The folder has no installed
  packages or local env files; the project's setup command runs there if one is
  set, otherwise say in the assignment how to prepare it.

Nothing separates parallel workers any more: give them work that needs no
shared port or database.

## Landing and dropping

- **A worker in its own folder:** before you land it, run the project's checks
  in its folder and skim `git diff <feature branch>...<its branch>`. Then
  `land_worker` merges its branch into the feature branch and removes its
  folder and branch. A conflict sends an "on its own" worker back to merge the
  feature branch in.
- **A worker in your folder:** dropping it stops it and keeps its commits. If
  you do not want them, revert them with new commits; never rewrite the
  branch's history. Its uncommitted changes stay in the folder for you to keep
  or clear.

## What protects the machine

Checks before each tool call keep a worker's edits inside its folder and the
system temp folder, and refuse any push, history rewrites, switching branch,
`git stash` (every folder shares one) and deletes outside its folder. They read
the shell's text, so they are best effort on every platform: a script a worker
writes and runs can still reach outside its folder. Say so if the human asks
how safe a worker is.
