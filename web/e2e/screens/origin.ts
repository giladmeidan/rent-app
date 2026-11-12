// The web origin the screens harness serves from; the mocked API answers CORS for exactly this
// origin. `make screens` exports WEB_PORT (from .env), so each worktree uses its own vite port.
export const WEB_ORIGIN = `http://localhost:${process.env.WEB_PORT ?? '5173'}`;
