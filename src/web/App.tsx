import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { SignedInUser } from "../lib/schemas/state";
import { clearStaleDrafts } from "./episodeRunner/autosave";

interface ChildSummary {
	name: string;
	theme: string;
	active_season: string;
	current_episode?: number;
	current_session_id?: string | null;
	target_wpm?: number;
}

interface StorySummary {
	slug: string;
	name: string;
	theme: string;
	total_episodes: number;
}

type CurrentUserResponse =
	| { authenticated: false }
	| { authenticated: true; user: SignedInUser };

export default function App() {
	const [, navigate] = useLocation();
	const [children, setChildren] = useState<Record<string, ChildSummary>>({});
	const [stories, setStories] = useState<StorySummary[]>([]);
	const [selectedStories, setSelectedStories] = useState<
		Record<string, string>
	>({});
	const [signedInUser, setSignedInUser] = useState<SignedInUser | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		const load = async () => {
			try {
				setLoading(true);
				setError(null);
				const [childrenRes, storiesRes, meRes] = await Promise.all([
					fetch("/api/children", {
						signal: controller.signal,
					}),
					fetch("/api/stories", {
						signal: controller.signal,
					}),
					fetch("/api/me", {
						signal: controller.signal,
					}),
				]);
				if (!childrenRes.ok) {
					throw new Error(`HTTP ${childrenRes.status}`);
				}
				if (!storiesRes.ok) {
					throw new Error(`HTTP ${storiesRes.status}`);
				}
				const data = await childrenRes.json();
				const nextStories = (await storiesRes.json()) as StorySummary[];
				const currentUser = meRes.ok
					? ((await meRes.json()) as CurrentUserResponse)
					: ({ authenticated: false } as const);
				if (!controller.signal.aborted) {
					setChildren(data);
					setStories(nextStories);
					setSignedInUser(currentUser.authenticated ? currentUser.user : null);
					setSelectedStories(
						Object.fromEntries(
							Object.entries(data as Record<string, ChildSummary>).map(
								([id, child]) => [id, child.active_season],
							),
						),
					);
					clearStaleDrafts(data);
				}
			} catch (err) {
				if (!controller.signal.aborted) {
					setError(err instanceof Error ? err.message : "Failed to load");
				}
			} finally {
				if (!controller.signal.aborted) {
					setLoading(false);
				}
			}
		};

		void load();
		return () => controller.abort();
	}, []);

	if (loading) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-winni">
				<div className="loading-card">Loading story keys...</div>
			</main>
		);
	}

	if (error) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-zack">
				<div className="loading-card">Error: {error}</div>
			</main>
		);
	}

	const childEntries = Object.entries(children);

	if (childEntries.length === 0) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-winni">
				<p className="text-lg text-gray-500">No children configured yet.</p>
			</main>
		);
	}

	const handleStart = async (childId: string) => {
		const child = children[childId];
		if (!child) return;
		const storySlug = selectedStories[childId] ?? child.active_season;
		if (storySlug !== child.active_season) {
			const res = await fetch(
				`/api/children/${encodeURIComponent(childId)}/story`,
				{
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ story_slug: storySlug }),
				},
			);
			if (!res.ok) {
				setError(`HTTP ${res.status}`);
				return;
			}
			const data = (await res.json()) as {
				child?: ChildSummary & { id: string };
			};
			if (data.child) {
				const updatedChild = data.child;
				setChildren((current) => ({
					...current,
					[childId]: {
						name: updatedChild.name,
						theme: updatedChild.theme,
						active_season: updatedChild.active_season,
						current_episode: updatedChild.current_episode,
						current_session_id: updatedChild.current_session_id,
						target_wpm: updatedChild.target_wpm,
					},
				}));
				clearStaleDrafts({ ...children, [childId]: updatedChild });
			}
		}
		navigate(`/play/${childId}`);
	};

	return (
		<main className="home-world typeling-game flex min-h-screen flex-col items-center justify-center gap-6 p-8 theme-winni">
			<div className="game-sky" aria-hidden="true">
				<div className="moon-or-planet" />
				<div className="drift-shape drift-shape-a" />
				<div className="drift-shape drift-shape-b" />
				<div className="ground-glow" />
			</div>
			<header className="text-center">
				<h1 className="home-title text-3xl font-bold">Typeling</h1>
				{signedInUser && (
					<p className="mt-2 text-sm font-medium text-stone-500">
						Signed in as{" "}
						<span className="text-stone-700">{signedInUser.display_name}</span>
						{signedInUser.display_name !== signedInUser.email && (
							<span className="ml-2 text-stone-400">{signedInUser.email}</span>
						)}
					</p>
				)}
			</header>
			<div className="child-select flex flex-wrap justify-center gap-4">
				{childEntries.map(([id, child]) => {
					const selectedStorySlug = selectedStories[id] ?? child.active_season;
					return (
						<div
							key={id}
							className={`child-card rounded-lg border-2 border-gray-200 p-6 text-left transition-all hover:border-blue-400 hover:shadow-md ${
								id.toLowerCase().includes("zack") ? "zack-card" : "winni-card"
							}`}
						>
							<span className="child-token" aria-hidden="true" />
							<span className="block text-xl font-semibold">{child.name}</span>
							<label className="mt-4 block text-xs font-bold uppercase tracking-normal text-gray-500">
								Story
								<select
									className="mt-2 block w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm font-semibold normal-case text-stone-700 shadow-sm"
									value={selectedStorySlug}
									aria-label={`${child.name} story`}
									onChange={(event) => {
										const storySlug = event.currentTarget.value;
										setSelectedStories((current) => ({
											...current,
											[id]: storySlug,
										}));
									}}
								>
									{stories.length === 0 ? (
										<option value={selectedStorySlug}>
											No stories available
										</option>
									) : (
										stories.map((story) => (
											<option key={story.slug} value={story.slug}>
												{story.name}
											</option>
										))
									)}
								</select>
							</label>
							<button
								type="button"
								className="mt-4 rounded-md bg-stone-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-stone-700"
								onClick={() => void handleStart(id)}
							>
								Start
							</button>
						</div>
					);
				})}
			</div>
		</main>
	);
}
