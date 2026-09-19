# Burn page rebuild button stuck at "resolving" after image clear

## Ticket 1

EnableAfkCard image row: render a refused imageBuildTarget's `reason` (like the custom probe row's fix text at EnableAfkCard.tsx:493) instead of mapping it to undefined at line 463; distinguish query loading from query error, so the button never shows 'resolving Dockerfile → resolving tag' for a settled answer. Component tests for refused/loading/error states.

## Ticket 2

Keep setup.imageBuildTarget in agreement with the doctor probe: invalidate/refetch the target query when the global sandboxImage clear emits settings.updated, and when the doctor's decision-8 column heal (doctor.ts:649 clearStored) fires — make the heal emit an event if it does not already — so a healed state arms the Rebuild button without a hard reload. Test: probe heals orphaned column → subsequent imageBuildTarget resolves kind 'stock', and the web card refetches on the emitted event.
