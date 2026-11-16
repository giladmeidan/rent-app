// The port the waitlist page test serves waitlist/public on (spec 0017). WAITLIST_PORT overrides it, so
// two worktrees can run `make test` at once on one machine; the default is the spec's 4179.
export const WAITLIST_PORT = Number(process.env.WAITLIST_PORT ?? 4179);
