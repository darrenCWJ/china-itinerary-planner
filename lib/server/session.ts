import { accountsEnabled, getAuth } from "./auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Null when logged out, session expired, or accounts are not configured. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  if (!accountsEnabled()) return null;
  try {
    const session = await getAuth().api.getSession({ headers: req.headers });
    if (!session?.user) return null;
    return { id: session.user.id, name: session.user.name, email: session.user.email };
  } catch (error) {
    // A malformed cookie must read as logged-out, never as a 500.
    // Log unexpected errors to surface auth-layer misconfigurations or outages.
    console.error("getSessionUser: session lookup failed, treating as logged out", error);
    return null;
  }
}
