import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import EpisodeRunner from "./EpisodeRunner";
import { clearDraft } from "./episodeRunner/autosave";

interface EpisodeData {
	text: string;
	episode_idx: number;
	current_episode: number;
	season_slug: string;
	total_episodes: number;
}

function ChapterPicker({
	childId,
	episodeIdx,
	currentEpisode,
	totalEpisodes,
	onReset,
}: {
	childId: string;
	episodeIdx: number;
	currentEpisode: number;
	totalEpisodes: number;
	onReset: () => void;
}) {
	const [_, navigate] = useLocation();

	const latestOpen = Math.min(currentEpisode, totalEpisodes - 1);

	return (
		<div className="fixed left-0 right-0 top-0 z-10 border-b border-amber-100 bg-[#fefaf2]/95 px-4 py-3 backdrop-blur">
			<div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
				{Array.from({ length: totalEpisodes }, (_, i) => {
					const isLocked = i > latestOpen;
					const isSelected = i === episodeIdx;
					const isLatest = i === latestOpen;

					return (
						<button
							// biome-ignore lint/suspicious/noArrayIndexKey: season chapter count is stable
							key={i}
							type="button"
							disabled={isLocked}
							data-testid="chapter-jump"
							data-episode-idx={i}
							data-status={isLocked ? "locked" : isLatest ? "latest" : "open"}
							className={`h-9 w-9 rounded-full text-sm font-bold transition-colors ${
								isSelected
									? "bg-amber-500 text-white ring-2 ring-amber-200"
									: isLocked
										? "border border-stone-200 text-stone-300"
										: "bg-white text-stone-600 hover:bg-amber-100"
							}`}
							onClick={() => navigate(`/play/${childId}/episode/${i}`)}
						>
							{i + 1}
						</button>
					);
				})}
				<button
					type="button"
					data-testid="reset-chapter"
					className="ml-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50"
					onClick={onReset}
				>
					Reset
				</button>
			</div>
		</div>
	);
}

export default function PlayEpisode() {
	const { childId, episodeIdx } = useParams<{
		childId: string;
		episodeIdx?: string;
	}>();
	const [_, navigate] = useLocation();

	const [episode, setEpisode] = useState<EpisodeData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadPath =
		episodeIdx === undefined
			? `/api/children/${childId}/current-episode`
			: `/api/children/${childId}/episodes/${episodeIdx}`;

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
				const episodeRes = await fetch(loadPath, {
					signal: controller.signal,
				});
				if (!episodeRes.ok) {
					throw new Error(`HTTP ${episodeRes.status}`);
				}
				const nextEpisode = await episodeRes.json();
				setEpisode("complete" in nextEpisode ? null : nextEpisode);
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
	}, [childId, loadPath]);

	const handleReset = async () => {
		if (!childId || !episode) return;
		if (
			!window.confirm(
				`Reset chapter ${episode.episode_idx + 1}? This removes this chapter and later chapter progress.`,
			)
		) {
			return;
		}

		const res = await fetch(
			`/api/children/${childId}/episodes/${episode.episode_idx}/reset`,
			{ method: "POST" },
		);
		if (!res.ok) {
			setError(`Failed to reset chapter (${res.status})`);
			return;
		}
		clearDraft(childId, episode.season_slug, episode.episode_idx);
		setEpisode((current) =>
			current && current.current_episode !== episode.episode_idx
				? { ...current, current_episode: episode.episode_idx }
				: current,
		);
		navigate(`/play/${childId}/episode/${episode.episode_idx}`);
	};

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

	if (!episode) {
		return null;
	}

	return (
		<main className="flex min-h-screen items-center justify-center pt-20">
			<ChapterPicker
				childId={childId}
				episodeIdx={episode.episode_idx}
				currentEpisode={episode.current_episode}
				totalEpisodes={episode.total_episodes}
				onReset={handleReset}
			/>
			<EpisodeRunner
				episodeText={episode.text}
				childId={childId}
				seasonSlug={episode.season_slug}
				episodeIdx={episode.episode_idx}
			/>
		</main>
	);
}
