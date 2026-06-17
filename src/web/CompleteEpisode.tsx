import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { getProgress } from "./api";

interface ChapterMapProps {
	storySlug: string;
	totalEpisodes: number;
	completedUpTo: number;
}

function chapterCellClass(isCurrent: boolean, isCompleted: boolean) {
	const base =
		"chapter-cell flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold";
	if (isCurrent) {
		return `${base} bg-green-400 text-white ring-4 ring-green-300 animate-pulse`;
	}
	if (isCompleted) {
		return `${base} bg-green-400 text-white`;
	}
	return `${base} border-2 border-gray-300 text-gray-400`;
}

function themeForComplete(storySlug: string | undefined, storyTheme: string) {
	const themeText = `${storySlug ?? ""} ${storyTheme}`.toLowerCase();
	if (
		themeText.includes("zack") ||
		themeText.includes("science") ||
		themeText.includes("robot")
	) {
		return "zack";
	}
	return "winni";
}

export function ChapterMap({
	storySlug,
	totalEpisodes,
	completedUpTo,
}: ChapterMapProps) {
	const [_, navigate] = useLocation();

	return (
		<div data-testid="chapter-map" className="chapter-map">
			{Array.from({ length: totalEpisodes }, (_, i) => {
				const chapterNumber = i + 1;
				const isCompleted = i <= completedUpTo;
				const isCurrent = i === completedUpTo;
				const label = isCompleted
					? `Read chapter ${chapterNumber}`
					: `Chapter ${chapterNumber} locked`;

				return (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: episode grid is static, never reordered
						key={i}
						type="button"
						disabled={!isCompleted}
						aria-label={label}
						data-testid="chapter-cell"
						data-episode-idx={i}
						data-status={isCompleted ? "completed" : "upcoming"}
						data-current={isCurrent ? "true" : undefined}
						className={chapterCellClass(isCurrent, isCompleted)}
						onClick={() => navigate(`/play/${storySlug}/episode/${i}`)}
					>
						{chapterNumber}
					</button>
				);
			})}
		</div>
	);
}

export default function CompleteEpisode() {
	const [_, navigate] = useLocation();
	const { storySlug, episodeIdx } = useParams<{
		storySlug: string;
		episodeIdx: string;
	}>();
	const [storyName, setStoryName] = useState<string | null>(null);
	const [storyTheme, setStoryTheme] = useState<string>("");
	const [totalEpisodes, setTotalEpisodes] = useState<number>(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!storySlug) {
			setLoading(false);
			setError("Missing story");
			return;
		}

		const controller = new AbortController();

		const load = async () => {
			try {
				setLoading(true);
				setError(null);

				const data = await getProgress(controller.signal);
				if (controller.signal.aborted) return;

				const story = data.stories.find((item) => item.slug === storySlug);
				if (!story) {
					setError("Story not found");
					return;
				}
				setStoryName(story.name);
				setStoryTheme(story.theme);
				setTotalEpisodes(story.total_episodes);
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
		return () => {
			controller.abort();
		};
	}, [storySlug]);

	if (loading) {
		return (
			<main className="flex min-h-screen items-center justify-center">
				Loading...
			</main>
		);
	}

	if (error) {
		return (
			<main className="flex min-h-screen items-center justify-center">
				Error: {error}
			</main>
		);
	}

	const rawIdx = Number.parseInt(episodeIdx ?? "", 10);
	const completedIdx = Number.isNaN(rawIdx)
		? 0
		: Math.max(0, Math.min(rawIdx, totalEpisodes - 1));
	const episodeNumber = completedIdx + 1;
	const theme = themeForComplete(storySlug, storyTheme);

	return (
		<main
			data-testid="complete-episode"
			className={`typeling-game complete-world flex min-h-screen flex-col items-center justify-center gap-6 p-8 theme-${theme}`}
		>
			<div className="game-sky" aria-hidden="true">
				<div className="moon-or-planet" />
				<div className="drift-shape drift-shape-a" />
				<div className="drift-shape drift-shape-b" />
				<div className="ground-glow" />
			</div>
			<section className="complete-card">
				<div className="reward-medal" aria-hidden="true">
					{episodeNumber}
				</div>
				<h1 className="text-3xl font-bold">
					Episode {episodeNumber} complete!
				</h1>
				{storyName && <p className="text-xl text-gray-600">{storyName}</p>}
				<ChapterMap
					storySlug={storySlug}
					totalEpisodes={totalEpisodes}
					completedUpTo={completedIdx}
				/>
				{completedIdx === totalEpisodes - 1 ? (
					<p className="season-finale text-2xl font-bold text-purple-600 animate-bounce">
						You finished the whole season!
					</p>
				) : (
					<button
						type="button"
						className="start-next rounded-lg bg-blue-500 px-6 py-3 text-lg font-semibold text-white hover:bg-blue-600 transition-colors"
						onClick={() => navigate(`/play/${storySlug}`)}
					>
						Start next
					</button>
				)}
			</section>
		</main>
	);
}
