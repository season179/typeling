import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { UserProfile } from "../lib/schemas/state";
import { clearStaleDrafts } from "./episodeRunner/autosave";

interface ProgressStory {
	slug: string;
	name: string;
	theme: string;
	total_episodes: number;
	current_episode: number;
	target_wpm: number;
}

export default function App() {
	const [, navigate] = useLocation();
	const [stories, setStories] = useState<ProgressStory[]>([]);
	const [signedInUser, setSignedInUser] = useState<UserProfile | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		const load = async () => {
			try {
				setLoading(true);
				setError(null);
				const progressRes = await fetch("/api/progress", {
					signal: controller.signal,
				});
				if (!progressRes.ok) {
					throw new Error(`HTTP ${progressRes.status}`);
				}
				const data = (await progressRes.json()) as {
					user: UserProfile;
					stories: ProgressStory[];
				};
				if (!controller.signal.aborted) {
					setStories(data.stories);
					setSignedInUser(data.user);
					clearStaleDrafts(
						data.user.email,
						data.stories.map((story) => story.slug),
					);
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

	if (stories.length === 0) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-winni">
				<p className="text-lg text-gray-500">No stories available yet.</p>
			</main>
		);
	}

	const handleStart = (storySlug: string) => {
		navigate(`/play/${storySlug}`);
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
				{stories.map((story) => {
					const isZack =
						story.slug.toLowerCase().includes("zack") ||
						story.theme.toLowerCase().includes("science") ||
						story.theme.toLowerCase().includes("robot");
					return (
						<div
							key={story.slug}
							className={`child-card rounded-lg border-2 border-gray-200 p-6 text-left transition-all hover:border-blue-400 hover:shadow-md ${
								isZack ? "zack-card" : "winni-card"
							}`}
						>
							<span className="child-token" aria-hidden="true" />
							<span className="block text-xl font-semibold">{story.name}</span>
							<span className="mt-2 block text-sm text-stone-500">
								Chapter{" "}
								{Math.min(story.current_episode + 1, story.total_episodes)} of{" "}
								{story.total_episodes}
							</span>
							<span className="mt-1 block text-xs font-semibold uppercase tracking-normal text-stone-400">
								Target {story.target_wpm} WPM
							</span>
							<button
								type="button"
								className="mt-4 rounded-md bg-stone-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-stone-700"
								onClick={() => handleStart(story.slug)}
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
