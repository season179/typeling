import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { MAX_EPISODES } from "../lib/schemas/season";

interface ChildSummary {
	name: string;
	theme?: string;
}

interface ChapterMapProps {
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

function themeForComplete(childId: string | undefined, childTheme: string) {
	const themeText = `${childId ?? ""} ${childTheme}`.toLowerCase();
	if (
		themeText.includes("zack") ||
		themeText.includes("science") ||
		themeText.includes("robot")
	) {
		return "zack";
	}
	return "winni";
}

function ChapterMap({ totalEpisodes, completedUpTo }: ChapterMapProps) {
	return (
		<div data-testid="chapter-map" className="chapter-map">
			{Array.from({ length: totalEpisodes }, (_, i) => {
				const isCompleted = i <= completedUpTo;
				const isCurrent = i === completedUpTo;

				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: episode grid is static, never reordered
						key={i}
						data-testid="chapter-cell"
						data-episode-idx={i}
						data-status={isCompleted ? "completed" : "upcoming"}
						data-current={isCurrent ? "true" : undefined}
						className={chapterCellClass(isCurrent, isCompleted)}
					>
						{i + 1}
					</div>
				);
			})}
		</div>
	);
}

export default function CompleteEpisode() {
	const [_, navigate] = useLocation();
	const { childId, episodeIdx } = useParams<{
		childId: string;
		episodeIdx: string;
	}>();
	const [childName, setChildName] = useState<string | null>(null);
	const [childTheme, setChildTheme] = useState<string>("");
	const [totalEpisodes, setTotalEpisodes] = useState<number>(MAX_EPISODES);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!childId) {
			setLoading(false);
			setError("Missing child id");
			return;
		}

		const controller = new AbortController();

		const load = async () => {
			try {
				setLoading(true);
				setError(null);

				const childrenRes = await fetch("/api/children", {
					signal: controller.signal,
				});
				if (!childrenRes.ok) {
					throw new Error(`HTTP ${childrenRes.status}`);
				}
				const data = (await childrenRes.json()) as Record<string, ChildSummary>;
				if (controller.signal.aborted) return;

				const child = data[childId];
				if (!child) {
					setError("Child not found");
					return;
				}
				setChildName(child.name);
				setChildTheme(child.theme ?? "");

				fetch(`/api/children/${childId}/season`)
					.then((r) =>
						r.ok ? (r.json() as Promise<{ total_episodes: number }>) : null,
					)
					.then((d) => {
						if (!cancelled && d) setTotalEpisodes(d.total_episodes);
					})
					.catch(() => {});
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

		let cancelled = false;
		void load();
		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [childId]);

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
	const episodeNumber = Number.isNaN(rawIdx) ? 1 : rawIdx + 1;
	const completedIdx = Number.isNaN(rawIdx) ? 0 : rawIdx;
	const theme = themeForComplete(childId, childTheme);

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
				{childName && (
					<p className="text-xl text-gray-600">Great job, {childName}!</p>
				)}
				<ChapterMap
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
						onClick={() => navigate(`/play/${childId}`)}
					>
						Start next
					</button>
				)}
			</section>
		</main>
	);
}
