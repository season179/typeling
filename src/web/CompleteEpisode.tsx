import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { MAX_EPISODES } from "../lib/schemas/season";

interface ChildSummary {
	name: string;
}

interface ChapterMapProps {
	totalEpisodes: number;
	completedUpTo: number;
}

function ChapterMap({ totalEpisodes, completedUpTo }: ChapterMapProps) {
	return (
		<div
			data-testid="chapter-map"
			className="flex flex-wrap justify-center gap-2"
		>
			{Array.from({ length: totalEpisodes }, (_, i) => {
				const isCompleted = i <= completedUpTo;
				const isCurrent = i === completedUpTo;

				const baseClasses =
					"flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold";

				let cellClasses: string;
				if (isCurrent) {
					cellClasses = `${baseClasses} bg-green-400 text-white ring-4 ring-green-300 animate-pulse`;
				} else if (isCompleted) {
					cellClasses = `${baseClasses} bg-green-400 text-white`;
				} else {
					cellClasses = `${baseClasses} border-2 border-gray-300 text-gray-400`;
				}

				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: episode grid is static, never reordered
						key={i}
						data-testid="chapter-cell"
						data-episode-idx={i}
						data-status={isCompleted ? "completed" : "upcoming"}
						data-current={isCurrent ? "true" : undefined}
						className={cellClasses}
					>
						{i + 1}
					</div>
				);
			})}
		</div>
	);
}

export default function CompleteEpisode() {
	const { childId, episodeIdx } = useParams<{
		childId: string;
		episodeIdx: string;
	}>();
	const [childName, setChildName] = useState<string | null>(null);
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

	return (
		<main
			data-testid="complete-episode"
			className="flex min-h-screen flex-col items-center justify-center gap-6 p-8"
		>
			<h1 className="text-3xl font-bold">Episode {episodeNumber} complete!</h1>
			{childName && (
				<p className="text-xl text-gray-600">Great job, {childName}!</p>
			)}
			<ChapterMap totalEpisodes={totalEpisodes} completedUpTo={completedIdx} />
		</main>
	);
}
