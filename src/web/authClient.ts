import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. The auth handler is mounted at `/api/auth`
 * on the same origin that serves the app, so the default baseURL (current
 * origin) is correct and no config is needed. Used to start the Google sign-in
 * redirect and to sign out.
 */
export const authClient = createAuthClient();
