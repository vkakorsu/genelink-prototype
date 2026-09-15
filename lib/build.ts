export const BUILD_COMMIT = (process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "dev").slice(0, 7);
