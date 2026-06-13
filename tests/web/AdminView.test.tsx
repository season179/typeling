import { describe, expect, it } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import AdminView from "../../src/web/AdminView";
import { setupDom } from "./setup";

setupDom();

const adminPayload = {
	admin: { access: "local-only" },
	children: [
		{
			id: "winni",
			name: "Winni",
			theme: "rainbow-unicorn",
			target_wpm: 15,
			active_season: "winni-s1-test",
			current_episode: 0,
			current_session_id: null,
			season: {
				slug: "winni-s1-test",
				child_id: "winni",
				theme: "rainbow-unicorn",
				episodes: [
					{
						idx: 0,
						text: "Luma saw a rainbow path.",
						char_count: 24,
						word_count: 5,
						audio: {
							status: "missing",
						},
					},
				],
			},
		},
	],
};

describe("AdminView", () => {
	it("loads an episode, edits story text, and saves it", async () => {
		const originalFetch = globalThis.fetch;
		const requested: Array<{ url: string; method: string; body?: string }> = [];
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : null;
			const url = request ? request.url : String(input);
			const method = init?.method ?? request?.method ?? "GET";
			const body = init?.body ? String(init.body) : undefined;
			requested.push({ url, method, body });

			if (method === "PUT") {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							season_slug: "winni-s1-test",
							episode: {
								idx: 0,
								text: "Luma found a brass key.",
								char_count: 23,
								word_count: 5,
								audio: { status: "stale", error: "EpisodeAudioStale" },
							},
						}),
						{ headers: { "content-type": "application/json" } },
					),
				);
			}

			return Promise.resolve(
				new Response(JSON.stringify(adminPayload), {
					headers: { "content-type": "application/json" },
				}),
			);
		}) as unknown as typeof fetch;

		try {
			const { getAllByText, getByLabelText, getByRole, getByText } = render(
				<AdminView />,
			);

			await waitFor(() => {
				expect(getByText("Admin")).toBeDefined();
			});

			const textarea = getByLabelText("Story text") as HTMLTextAreaElement;
			await waitFor(() => {
				expect(textarea.value).toBe("Luma saw a rainbow path.");
			});

			fireEvent.input(textarea, {
				target: { value: "Luma found a brass key." },
			});
			const saveButton = getByRole("button", { name: "Save story" });
			await waitFor(() => {
				expect(saveButton.hasAttribute("disabled")).toBe(false);
			});
			fireEvent.click(saveButton);

			await waitFor(() => {
				expect(getByText("Saved")).toBeDefined();
			});
			expect(requested.some((entry) => entry.method === "PUT")).toBe(true);
			expect(getAllByText("Stale").length).toBeGreaterThan(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
