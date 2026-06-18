import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
	getAdminStories,
	postAdminEpisodeAudio,
	postAdminEpisodeAudioPublish,
	putAdminEpisode,
} from "./api";

type AdminAudioStatus =
	| {
			status: "ready";
			duration_seconds: number;
			words: number;
	  }
	| { status: "missing" }
	| { status: "stale"; error: string };

interface AdminEpisode {
	idx: number;
	text: string;
	char_count: number;
	word_count: number;
	audio: AdminAudioStatus;
}

interface AdminSeason {
	slug: string;
	name: string;
	theme: string;
	episodes: AdminEpisode[];
}

type AdminStory = AdminSeason;

interface AdminResponse {
	admin: {
		access: "local-only";
	};
	stories: AdminStory[];
}

interface AdminEpisodeUpdateResponse {
	season_slug: string;
	episode: AdminEpisode;
}

interface AdminAudioGenerateResponse {
	season_slug: string;
	episode: { idx: number; audio: AdminAudioStatus };
}

interface AdminAudioPublishResult {
	textHash: string;
	wavSha256: string;
	verified: boolean;
	skipped: boolean;
}

interface AdminAudioPublishResponse {
	season_slug: string;
	episode: { idx: number; publish: AdminAudioPublishResult };
}

// Friendly text for each AudioGenerationError code the route can return.
const AUDIO_ERROR_MESSAGES: Record<string, string> = {
	AudioGenerationDisabled:
		"Audio generation is turned off (set ADMIN_AUDIO_GENERATION_ENABLED).",
	AudioGenerationNotConfigured:
		"Set GEMINI_API_KEY, OPENROUTER_API_KEY and ALIGNER_URL in .dev.vars.",
	AlignerUrlNotLoopback: "ALIGNER_URL must be a loopback address.",
	StyleAuthFailed: "OpenRouter rejected the API key.",
	StyleFailed: "The styling step failed.",
	StylePreservationFailed:
		"Styling changed the story words, so generation was stopped.",
	TtsAuthFailed: "Gemini rejected the API key.",
	TtsFailed: "Text-to-speech failed.",
	TtsNoAudio: "Text-to-speech returned no audio.",
	AlignerUnreachable: "The local aligner is not running. Is `bun run dev` up?",
	AlignFailed: "Forced alignment failed.",
	AlignmentMismatch: "Alignment did not match the story text.",
	VerificationFailed: "The generated audio failed verification.",
};

// Map a route's error code to friendly text, appending any server detail. Shared
// by the Generate and Publish buttons so both render errors identically.
function formatErrorMessage(
	messages: Record<string, string>,
	code: string | undefined,
	detail: string | undefined,
	status: number,
): string {
	const friendly = (code && messages[code]) || code || `HTTP ${status}`;
	return detail ? `${friendly} (${detail})` : friendly;
}

// Friendly text for each publish-related error code the route can return.
const PUBLISH_ERROR_MESSAGES: Record<string, string> = {
	AudioPublishDisabled:
		"Publishing is turned off (set ADMIN_AUDIO_PUBLISH_ENABLED).",
	AudioPublishNotConfigured: "Set ALIGNER_URL in .dev.vars.",
	PublishUrlNotLoopback: "ALIGNER_URL must be a loopback address.",
	AudioMissing: "No generated audio for this episode yet.",
	AudioStale: "Story and narration do not match, so publishing was stopped.",
	PublisherUnreachable:
		"The local publisher is not running. Is `bun run dev` up?",
	PublishNotConfigured: "Production R2 credentials are missing from .env.",
	PublishUploadFailed: "Uploading to production failed.",
	PublishVerificationFailed:
		"The uploaded audio failed verification in production.",
	PublisherBadResponse: "The publisher returned an unexpected response.",
};

const AUDIO_LABELS: Record<AdminAudioStatus["status"], string> = {
	missing: "Missing",
	ready: "Ready",
	stale: "Stale",
};

function audioStatusClass(status: AdminAudioStatus["status"]): string {
	if (status === "ready") return "bg-emerald-100 text-emerald-800";
	if (status === "stale") return "bg-rose-100 text-rose-700";
	return "bg-stone-100 text-stone-600";
}

function formatSeconds(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const remainder = Math.round(seconds % 60);
	return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function storyWordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

function episodeButtonClass(isSelected: boolean, audio: AdminAudioStatus) {
	const base =
		"flex min-h-12 w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors";
	if (isSelected) {
		return `${base} border-stone-900 bg-stone-900 text-white`;
	}
	if (audio.status === "stale") {
		return `${base} border-rose-200 bg-rose-50 text-stone-800 hover:border-rose-300`;
	}
	return `${base} border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50`;
}

export default function AdminView() {
	const [data, setData] = useState<AdminResponse | null>(null);
	const [selectedStorySlug, setSelectedStorySlug] = useState<string | null>(
		null,
	);
	const [selectedEpisodeIdx, setSelectedEpisodeIdx] = useState(0);
	const [draftText, setDraftText] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const [generating, setGenerating] = useState(false);
	const [audioError, setAudioError] = useState<string | null>(null);
	const [audioMessage, setAudioMessage] = useState<string | null>(null);
	const [publishing, setPublishing] = useState(false);
	const [publishError, setPublishError] = useState<string | null>(null);
	const [publishMessage, setPublishMessage] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		const load = async () => {
			try {
				setLoading(true);
				setError(null);
				const res = await getAdminStories(controller.signal);
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				const nextData: AdminResponse = await res.json();
				if (!controller.signal.aborted) {
					setData(nextData);
					setSelectedStorySlug(
						(current) => current ?? nextData.stories[0]?.slug ?? null,
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

	const selectedStory = useMemo(() => {
		if (!data) return null;
		return (
			data.stories.find((story) => story.slug === selectedStorySlug) ??
			data.stories[0] ??
			null
		);
	}, [data, selectedStorySlug]);

	const selectedEpisode =
		selectedStory?.episodes.find(
			(episode) => episode.idx === selectedEpisodeIdx,
		) ??
		selectedStory?.episodes[0] ??
		null;

	useEffect(() => {
		if (!selectedEpisode) {
			setDraftText("");
			return;
		}
		setDraftText(selectedEpisode.text);
		setSaveMessage(null);
		setAudioError(null);
		setAudioMessage(null);
		setPublishError(null);
		setPublishMessage(null);
	}, [selectedEpisode]);

	const saveEpisode = async () => {
		if (!selectedStory || !selectedEpisode) return;

		try {
			setSaving(true);
			setError(null);
			setSaveMessage(null);
			const res = await putAdminEpisode(
				selectedStory.slug,
				selectedEpisode.idx,
				draftText,
			);
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(body?.error ?? `HTTP ${res.status}`);
			}

			const updated: AdminEpisodeUpdateResponse = await res.json();
			setData((current) => {
				if (!current) return current;
				return {
					...current,
					stories: current.stories.map((story) => {
						if (story.slug !== selectedStory.slug) return story;
						return {
							...story,
							episodes: story.episodes.map((episode) =>
								episode.idx === updated.episode.idx ? updated.episode : episode,
							),
						};
					}),
				};
			});
			setSaveMessage("Saved");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save");
		} finally {
			setSaving(false);
		}
	};

	const generateAudio = async () => {
		if (!selectedStory || !selectedEpisode) return;

		try {
			setGenerating(true);
			setAudioError(null);
			setAudioMessage(null);
			const res = await postAdminEpisodeAudio(
				selectedStory.slug,
				selectedEpisode.idx,
			);
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					error?: string;
					detail?: string;
				} | null;
				throw new Error(
					formatErrorMessage(
						AUDIO_ERROR_MESSAGES,
						body?.error,
						body?.detail,
						res.status,
					),
				);
			}

			const updated: AdminAudioGenerateResponse = await res.json();
			setData((current) => {
				if (!current) return current;
				return {
					...current,
					stories: current.stories.map((story) => {
						if (story.slug !== selectedStory.slug) return story;
						return {
							...story,
							episodes: story.episodes.map((episode) =>
								episode.idx === updated.episode.idx
									? { ...episode, audio: updated.episode.audio }
									: episode,
							),
						};
					}),
				};
			});
			setAudioMessage("Audio generated");
		} catch (err) {
			setAudioError(
				err instanceof Error ? err.message : "Failed to generate audio",
			);
		} finally {
			setGenerating(false);
		}
	};

	const publishAudio = async () => {
		if (!selectedStory || !selectedEpisode) return;

		try {
			setPublishing(true);
			setPublishError(null);
			setPublishMessage(null);
			const res = await postAdminEpisodeAudioPublish(
				selectedStory.slug,
				selectedEpisode.idx,
			);
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					error?: string;
					detail?: string;
				} | null;
				throw new Error(
					formatErrorMessage(
						PUBLISH_ERROR_MESSAGES,
						body?.error,
						body?.detail,
						res.status,
					),
				);
			}

			const published: AdminAudioPublishResponse = await res.json();
			const shortHash = published.episode.publish.textHash.slice(0, 12);
			setPublishMessage(
				published.episode.publish.skipped
					? `Already up to date — text hash ${shortHash}…`
					: `Published to production — text hash ${shortHash}…`,
			);
		} catch (err) {
			setPublishError(
				err instanceof Error ? err.message : "Failed to publish audio",
			);
		} finally {
			setPublishing(false);
		}
	};

	const handleDraftInput = (event: FormEvent<HTMLTextAreaElement>) => {
		setDraftText(event.currentTarget.value);
		setSaveMessage(null);
	};

	if (loading) {
		return (
			<main className="min-h-screen bg-stone-50 p-8">
				<div className="mx-auto max-w-5xl text-sm text-stone-500">
					Loading admin…
				</div>
			</main>
		);
	}

	if (!data || data.stories.length === 0) {
		return (
			<main className="min-h-screen bg-stone-50 p-8">
				<div className="mx-auto max-w-5xl rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-500">
					No stories configured yet.
				</div>
			</main>
		);
	}

	const wordCount = storyWordCount(draftText);
	const isDirty =
		selectedEpisode !== null && draftText !== selectedEpisode.text;
	const audioUrl =
		selectedStory && selectedEpisode && selectedEpisode.audio.status === "ready"
			? `/api/admin/seasons/${encodeURIComponent(
					selectedStory.slug,
				)}/episodes/${selectedEpisode.idx}/audio/file`
			: null;
	const captionUrl =
		selectedStory && selectedEpisode && selectedEpisode.audio.status === "ready"
			? `/api/admin/seasons/${encodeURIComponent(
					selectedStory.slug,
				)}/episodes/${selectedEpisode.idx}/audio/captions.vtt`
			: "";

	return (
		<main className="min-h-screen bg-stone-50 p-4 text-stone-900 sm:p-8">
			<div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
				<aside className="space-y-4">
					<header>
						<h1 className="font-serif text-3xl font-bold tracking-tight">
							Admin
						</h1>
						<p className="mt-1 text-sm text-stone-500">Local control room</p>
					</header>

					<div className="rounded-lg border border-stone-200 bg-white p-2">
						{data.stories.map((story) => (
							<button
								key={story.slug}
								type="button"
								className={`block w-full rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors ${
									story.slug === selectedStory?.slug
										? "bg-stone-900 text-white"
										: "text-stone-700 hover:bg-stone-100"
								}`}
								onClick={() => {
									setSelectedStorySlug(story.slug);
									setSelectedEpisodeIdx(0);
								}}
							>
								<span className="block">{story.name}</span>
								<span
									className={`block text-xs ${
										story.slug === selectedStory?.slug
											? "text-stone-300"
											: "text-stone-400"
									}`}
								>
									{story.slug}
								</span>
							</button>
						))}
					</div>

					{selectedStory && (
						<section className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
							<dl className="space-y-3">
								<div>
									<dt className="text-xs font-semibold uppercase tracking-normal text-stone-400">
										Story
									</dt>
									<dd className="mt-1 text-stone-700">{selectedStory.name}</dd>
								</div>
								<div>
									<dt className="text-xs font-semibold uppercase tracking-normal text-stone-400">
										Theme
									</dt>
									<dd className="mt-1 text-stone-700">{selectedStory.theme}</dd>
								</div>
								<div>
									<dt className="text-xs font-semibold uppercase tracking-normal text-stone-400">
										Chapters
									</dt>
									<dd className="mt-1 text-stone-700">
										{selectedStory.episodes.length}
									</dd>
								</div>
							</dl>
						</section>
					)}
				</aside>

				<section className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1fr)]">
					<div className="rounded-lg border border-stone-200 bg-white p-3">
						<h2 className="px-1 pb-3 text-sm font-bold text-stone-700">
							Episodes
						</h2>
						<div className="space-y-2">
							{selectedStory?.episodes.map((episode) => (
								<button
									key={episode.idx}
									type="button"
									className={episodeButtonClass(
										episode.idx === selectedEpisode?.idx,
										episode.audio,
									)}
									onClick={() => setSelectedEpisodeIdx(episode.idx)}
								>
									<span className="font-semibold">
										{episode.idx + 1}. Chapter
									</span>
									<span
										className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${audioStatusClass(
											episode.audio.status,
										)}`}
									>
										{AUDIO_LABELS[episode.audio.status]}
									</span>
								</button>
							))}
						</div>
					</div>

					{selectedStory && selectedEpisode && (
						<div className="space-y-5">
							<section className="rounded-lg border border-stone-200 bg-white p-5">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<h2 className="font-serif text-2xl font-bold tracking-tight">
											{selectedStory.name} chapter {selectedEpisode.idx + 1}
										</h2>
										<p className="mt-1 text-sm text-stone-500">
											{selectedStory.slug}
										</p>
									</div>
									<div className="flex items-center gap-2 text-xs font-semibold">
										<span className="rounded-full bg-stone-100 px-3 py-1 text-stone-600">
											{wordCount} words
										</span>
										<span className="rounded-full bg-stone-100 px-3 py-1 text-stone-600">
											{draftText.length} chars
										</span>
									</div>
								</div>

								<textarea
									className="mt-5 min-h-[24rem] w-full resize-y rounded-md border border-stone-200 bg-stone-50 p-4 font-serif text-lg leading-8 text-stone-900 outline-none transition-colors focus:border-stone-500 focus:bg-white"
									value={draftText}
									onInput={handleDraftInput}
									aria-label="Story text"
									spellCheck={true}
								/>

								<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
									<div className="min-h-5 text-sm">
										{error && <p className="text-rose-700">{error}</p>}
										{saveMessage && (
											<p className="font-semibold text-emerald-700">
												{saveMessage}
											</p>
										)}
									</div>
									<button
										type="button"
										className="rounded-md bg-stone-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
										disabled={!isDirty || saving}
										onClick={saveEpisode}
									>
										{saving ? "Saving" : "Save story"}
									</button>
								</div>
							</section>

							<section className="rounded-lg border border-stone-200 bg-white p-5">
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div>
										<h2 className="font-serif text-xl font-bold tracking-tight">
											Audio
										</h2>
										<p className="mt-1 text-sm text-stone-500">
											{selectedEpisode.audio.status === "ready" &&
												`${formatSeconds(
													selectedEpisode.audio.duration_seconds,
												)} · ${selectedEpisode.audio.words} timed words`}
											{selectedEpisode.audio.status === "missing" &&
												"No narration asset"}
											{selectedEpisode.audio.status === "stale" &&
												"Story and narration do not match"}
										</p>
									</div>
									<span
										className={`rounded-full px-3 py-1 text-xs font-bold ${audioStatusClass(
											selectedEpisode.audio.status,
										)}`}
									>
										{AUDIO_LABELS[selectedEpisode.audio.status]}
									</span>
								</div>

								{audioUrl && (
									<audio
										key={audioUrl}
										className="mt-4 w-full"
										controls={true}
										src={audioUrl}
									>
										<track
											default={true}
											kind="captions"
											label="Story text"
											src={captionUrl}
											srcLang="en"
										/>
									</audio>
								)}
								{selectedEpisode.audio.status === "stale" && (
									<p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
										{selectedEpisode.audio.error}
									</p>
								)}

								<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
									<div className="min-h-5 text-sm">
										{audioError && (
											<p className="text-rose-700">{audioError}</p>
										)}
										{audioMessage && (
											<p className="font-semibold text-emerald-700">
												{audioMessage}
											</p>
										)}
										{isDirty && !audioError && !audioMessage && (
											<p className="text-stone-500">
												Save the story before generating audio.
											</p>
										)}
									</div>
									<div className="flex flex-wrap items-center gap-2">
										<button
											type="button"
											className="rounded-md bg-stone-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
											disabled={isDirty || generating || saving}
											onClick={generateAudio}
										>
											{generating
												? "Generating…"
												: selectedEpisode.audio.status === "missing"
													? "Generate audio"
													: "Regenerate audio"}
										</button>
										<button
											type="button"
											className="rounded-md border border-stone-900 bg-white px-4 py-2 text-sm font-bold text-stone-900 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
											disabled={
												selectedEpisode.audio.status !== "ready" ||
												publishing ||
												generating ||
												saving
											}
											onClick={publishAudio}
										>
											{publishing ? "Publishing…" : "Publish to production"}
										</button>
									</div>
								</div>

								<div className="mt-3 min-h-5 text-sm">
									{publishError && (
										<p className="text-rose-700">{publishError}</p>
									)}
									{publishMessage && (
										<p className="font-semibold text-emerald-700">
											{publishMessage}
										</p>
									)}
									{isDirty && !publishError && !publishMessage && (
										<p className="text-stone-500">
											Publishing sends the saved narration, not your unsaved
											edits.
										</p>
									)}
								</div>
							</section>
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
