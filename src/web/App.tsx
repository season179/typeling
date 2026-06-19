import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { getProgress, type ProgressStory } from "./api";
import { authClient } from "./authClient";
import { clearStaleDrafts } from "./episodeRunner/autosave";
import { themeForStory } from "./storyTheme";

export default function App() {
	const [, navigate] = useLocation();
	const [stories, setStories] = useState<ProgressStory[]>([]);
	const [loading, setLoading] = useState(true);
	const [needsSignIn, setNeedsSignIn] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		const load = async () => {
			try {
				setLoading(true);
				setError(null);
				setNeedsSignIn(false);
				const data = await getProgress(controller.signal);
				if (!controller.signal.aborted) {
					setStories(data.stories);
					clearStaleDrafts(
						data.user.email,
						data.stories.map((story) => story.slug),
					);
				}
			} catch (err) {
				if (!controller.signal.aborted) {
					const message = err instanceof Error ? err.message : "Failed to load";
					// A 401 means there is no signed-in user yet — show the Google
					// sign-in screen rather than a hard error.
					if (message === "HTTP 401") {
						setNeedsSignIn(true);
					} else {
						setError(message);
					}
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

	const handleSignIn = () => {
		void authClient.signIn.social({ provider: "google", callbackURL: "/" });
	};

	if (loading) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-rainbow">
				<div className="loading-card">Loading story keys...</div>
			</main>
		);
	}

	if (error) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-science">
				<div className="loading-card">Error: {error}</div>
			</main>
		);
	}

	if (needsSignIn) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-rainbow">
				<div className="loading-card flex flex-col items-center gap-4 text-center">
					<h1 className="home-title text-2xl font-bold">Typeling</h1>
					<p className="text-sm text-stone-500">
						Sign in to unlock your stories.
					</p>
					<button
						type="button"
						className="rounded-md bg-stone-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-stone-700"
						onClick={handleSignIn}
					>
						Sign in with Google
					</button>
				</div>
			</main>
		);
	}

	if (stories.length === 0) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-rainbow">
				<p className="text-lg text-gray-500">No stories available yet.</p>
			</main>
		);
	}

	const handleStart = (storySlug: string) => {
		navigate(`/play/${storySlug}`);
	};

	return (
		<main className="home-world typeling-game flex min-h-screen flex-col items-center justify-center gap-6 p-8 theme-rainbow">
			<div className="game-sky" aria-hidden="true">
				<div className="moon-or-planet" />
				<div className="drift-shape drift-shape-a" />
				<div className="drift-shape drift-shape-b" />
				<div className="ground-glow" />
			</div>
			<header className="text-center">
				<h1 className="home-title text-3xl font-bold">Typeling</h1>
			</header>
			<div className="child-select flex flex-wrap justify-center gap-4">
				{stories.map((story) => {
					const isScience =
						themeForStory(story.slug, story.theme) === "science";
					return (
						<div
							key={story.slug}
							className={`child-card rounded-lg border-2 border-gray-200 p-6 text-left transition-all hover:border-blue-400 hover:shadow-md ${
								isScience ? "science-card" : "rainbow-card"
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
