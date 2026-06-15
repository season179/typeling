import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
	type EpisodeData,
	getCurrentEpisode,
	getEpisode,
	getMe,
	resetEpisode,
} from "./api";
import EpisodeRunner from "./EpisodeRunner";
import { clearDraft } from "./episodeRunner/autosave";
import StoryAudioPlayer from "./StoryAudioPlayer";

interface ChapterPickerProps {
	storySlug: string;
	episodeIdx: number;
	currentEpisode: number;
	totalEpisodes: number;
	onReset: () => void;
}

interface StoryReaderProps {
	storySlug: string;
	episodeIdx: number;
	totalEpisodes: number;
	text: string;
	onTypeAgain: () => void;
}

function themeForStory(storySlug: string): "winni" | "zack" {
	return storySlug.toLowerCase().includes("zack") ||
		storySlug.toLowerCase().includes("science")
		? "zack"
		: "winni";
}

function chapterStatus(
	episodeIdx: number,
	latestOpen: number,
): "locked" | "latest" | "open" {
	if (episodeIdx > latestOpen) return "locked";
	if (episodeIdx === latestOpen) return "latest";
	return "open";
}

function chapterButtonClass(isSelected: boolean, isLocked: boolean) {
	const base =
		"chapter-button h-9 w-9 rounded-full text-sm font-bold transition-colors";
	if (isSelected) {
		return `${base} selected bg-amber-500 text-white ring-2 ring-amber-200`;
	}
	if (isLocked) {
		return `${base} locked border border-stone-200 text-stone-300`;
	}
	return `${base} open bg-white text-stone-600 hover:bg-amber-100`;
}

function ChapterPicker({
	storySlug,
	episodeIdx,
	currentEpisode,
	totalEpisodes,
	onReset,
}: ChapterPickerProps) {
	const [_, navigate] = useLocation();

	const latestOpen = Math.min(currentEpisode, totalEpisodes - 1);
	const theme = themeForStory(storySlug);

	return (
		<div
			className={`chapter-picker theme-${theme} fixed left-0 right-0 top-0 z-20 px-4 py-3`}
		>
			<div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-2">
				{Array.from({ length: totalEpisodes }, (_, i) => {
					const isLocked = i > latestOpen;
					const isSelected = i === episodeIdx;

					return (
						<button
							// biome-ignore lint/suspicious/noArrayIndexKey: season chapter count is stable
							key={i}
							type="button"
							disabled={isLocked}
							data-testid="chapter-jump"
							data-episode-idx={i}
							data-status={chapterStatus(i, latestOpen)}
							className={chapterButtonClass(isSelected, isLocked)}
							onClick={() => navigate(`/play/${storySlug}/episode/${i}`)}
						>
							{i + 1}
						</button>
					);
				})}
				<button
					type="button"
					data-testid="reset-chapter"
					className="reset-chapter ml-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50"
					onClick={onReset}
				>
					Reset
				</button>
			</div>
		</div>
	);
}

function StoryReader({
	storySlug,
	episodeIdx,
	totalEpisodes,
	text,
	onTypeAgain,
}: StoryReaderProps) {
	const theme = themeForStory(storySlug);

	return (
		<section
			className={`reader-world typeling-game theme-${theme}`}
			aria-label={`Read chapter ${episodeIdx + 1}`}
		>
			<div className="game-sky" aria-hidden="true">
				<div className="moon-or-planet" />
				<div className="drift-shape drift-shape-a" />
				<div className="drift-shape drift-shape-b" />
				<div className="ground-glow" />
			</div>
			<div className="reader-shell">
				<div className="reader-topbar">
					<div>
						<span className="hud-label">Story time</span>
						<h1>Chapter {episodeIdx + 1}</h1>
					</div>
					<span className="reader-count">
						{episodeIdx + 1}/{totalEpisodes}
					</span>
				</div>
				<StoryAudioPlayer
					storySlug={storySlug}
					episodeIdx={episodeIdx}
					text={text}
					onTypeAgain={onTypeAgain}
				/>
			</div>
		</section>
	);
}

export default function PlayEpisode() {
	const { storySlug, episodeIdx } = useParams<{
		storySlug: string;
		episodeIdx?: string;
	}>();
	const [_, navigate] = useLocation();

	const [episode, setEpisode] = useState<EpisodeData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [practiceMode, setPracticeMode] = useState(false);
	const [draftOwnerId, setDraftOwnerId] = useState("local");

	useEffect(() => {
		setPracticeMode(false);
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
				const [nextEpisode, currentUser] = await Promise.all([
					episodeIdx === undefined
						? getCurrentEpisode(storySlug, controller.signal)
						: getEpisode(storySlug, episodeIdx, controller.signal),
					getMe(controller.signal),
				]);
				setEpisode("complete" in nextEpisode ? null : nextEpisode);
				setDraftOwnerId(
					currentUser.authenticated ? currentUser.user.email : "local",
				);
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
	}, [storySlug, episodeIdx]);

	const handleReset = async () => {
		if (!storySlug || !episode) return;
		if (
			!window.confirm(
				`Reset chapter ${episode.episode_idx + 1}? This removes this chapter and later chapter progress.`,
			)
		) {
			return;
		}

		const res = await resetEpisode(storySlug, episode.episode_idx);
		if (!res.ok) {
			setError(`Failed to reset chapter (${res.status})`);
			return;
		}
		clearDraft(draftOwnerId, episode.season_slug, episode.episode_idx);
		setEpisode((current) =>
			current && current.current_episode !== episode.episode_idx
				? { ...current, current_episode: episode.episode_idx }
				: current,
		);
		navigate(`/play/${storySlug}/episode/${episode.episode_idx}`);
	};

	if (loading) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-winni">
				<div className="loading-card">Loading the next chapter...</div>
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

	if (!episode) {
		return null;
	}

	const isFinishedChapter = episode.episode_idx < episode.current_episode;

	return (
		<main className="flex min-h-screen items-center justify-center">
			<ChapterPicker
				storySlug={storySlug}
				episodeIdx={episode.episode_idx}
				currentEpisode={episode.current_episode}
				totalEpisodes={episode.total_episodes}
				onReset={handleReset}
			/>
			{isFinishedChapter && !practiceMode ? (
				<StoryReader
					storySlug={storySlug}
					episodeIdx={episode.episode_idx}
					totalEpisodes={episode.total_episodes}
					text={episode.text}
					onTypeAgain={() => setPracticeMode(true)}
				/>
			) : (
				<EpisodeRunner
					episodeText={episode.text}
					storySlug={storySlug}
					draftOwnerId={draftOwnerId}
					seasonSlug={episode.season_slug}
					episodeIdx={episode.episode_idx}
					totalEpisodes={episode.total_episodes}
				/>
			)}
		</main>
	);
}
