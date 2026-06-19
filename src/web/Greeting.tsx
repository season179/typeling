import { useEffect, useState } from "react";
import type { UserProfile } from "../lib/schemas/state";
import { getMe } from "./api";
import { authClient } from "./authClient";

// Pull a friendly first name for the greeting: prefer the Google name, fall
// back to the display name (unless it's just the email), then a gentle default.
function greetingName(user: UserProfile): string {
	const source =
		user.name?.trim() ||
		(user.display_name !== user.email ? user.display_name.trim() : "");
	return source.split(/\s+/)[0] || "friend";
}

function handleSignOut() {
	// Reload regardless of outcome so the button always responds: on success the
	// reload lands on the sign-in screen, and a failed sign-out re-checks the
	// session rather than leaving the click with no visible effect.
	void authClient.signOut().finally(() => {
		window.location.reload();
	});
}

/**
 * A floating "Hi, <name>" greeting pinned to the top-right corner. Rendered once
 * at the router level so it greets the signed-in reader on every screen. It
 * fetches its own identity and renders nothing until (and unless) someone is
 * signed in, so it stays invisible on the sign-in screen.
 */
export default function Greeting() {
	const [user, setUser] = useState<UserProfile | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		getMe(controller.signal)
			.then((res) => {
				if (!controller.signal.aborted && res.authenticated) {
					setUser(res.user);
				}
			})
			.catch(() => {
				// getMe already swallows non-ok responses; ignore aborts/transport errors.
			});
		return () => controller.abort();
	}, []);

	if (!user) {
		return null;
	}

	return (
		<div className="user-greeting animate-fade-slide-up">
			<span className="user-greeting-name">Hi, {greetingName(user)} 👋</span>
			<button
				type="button"
				className="user-greeting-signout"
				onClick={handleSignOut}
			>
				Sign out
			</button>
		</div>
	);
}
