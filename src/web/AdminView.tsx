import { type FormEvent, useEffect, useMemo, useState } from "react";

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

interface AdminChild {
	id: string;
	name: string;
	theme: string;
	target_wpm: number;
	active_season: string;
	current_episode: number;
	current_session_id: string | null;
	season: AdminSeason;
}

interface AdminResponse {
	admin: {
		access: "local-only";
	};
	children: AdminChild[];
}

interface AdminEpisodeUpdateResponse {
	season_slug: string;
	episode: AdminEpisode;
}

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
	const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
	const [selectedEpisodeIdx, setSelectedEpisodeIdx] = useState(0);
	const [draftText, setDraftText] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		const load = async () => {
			try {
				setLoading(true);
				setError(null);
				const res = await fetch("/api/admin/children", {
					signal: controller.signal,
				});
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				const nextData: AdminResponse = await res.json();
				if (!controller.signal.aborted) {
					setData(nextData);
					setSelectedChildId(
						(current) => current ?? nextData.children[0]?.id ?? null,
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

	const selectedChild = useMemo(() => {
		if (!data) return null;
		return (
			data.children.find((child) => child.id === selectedChildId) ??
			data.children[0] ??
			null
		);
	}, [data, selectedChildId]);

	const selectedEpisode =
		selectedChild?.season.episodes.find(
			(episode) => episode.idx === selectedEpisodeIdx,
		) ??
		selectedChild?.season.episodes[0] ??
		null;

	useEffect(() => {
		if (!selectedEpisode) {
			setDraftText("");
			return;
		}
		setDraftText(selectedEpisode.text);
		setSaveMessage(null);
	}, [selectedEpisode]);

	const saveEpisode = async () => {
		if (!selectedChild || !selectedEpisode) return;

		try {
			setSaving(true);
			setError(null);
			setSaveMessage(null);
			const res = await fetch(
				`/api/admin/seasons/${encodeURIComponent(
					selectedChild.active_season,
				)}/episodes/${selectedEpisode.idx}`,
				{
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ text: draftText }),
				},
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
					children: current.children.map((child) => {
						if (child.id !== selectedChild.id) return child;
						return {
							...child,
							season: {
								...child.season,
								episodes: child.season.episodes.map((episode) =>
									episode.idx === updated.episode.idx
										? updated.episode
										: episode,
								),
							},
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

	if (!data || data.children.length === 0) {
		return (
			<main className="min-h-screen bg-stone-50 p-8">
				<div className="mx-auto max-w-5xl rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-500">
					No children configured yet.
				</div>
			</main>
		);
	}

	const wordCount = storyWordCount(draftText);
	const isDirty =
		selectedEpisode !== null && draftText !== selectedEpisode.text;
	const audioUrl =
		selectedChild && selectedEpisode && selectedEpisode.audio.status === "ready"
			? `/api/admin/seasons/${encodeURIComponent(
					selectedChild.active_season,
				)}/episodes/${selectedEpisode.idx}/audio/file`
			: null;
	const captionUrl =
		selectedChild && selectedEpisode && selectedEpisode.audio.status === "ready"
			? `/api/admin/seasons/${encodeURIComponent(
					selectedChild.active_season,
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
						{data.children.map((child) => (
							<button
								key={child.id}
								type="button"
								className={`block w-full rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors ${
									child.id === selectedChild?.id
										? "bg-stone-900 text-white"
										: "text-stone-700 hover:bg-stone-100"
								}`}
								onClick={() => {
									setSelectedChildId(child.id);
									setSelectedEpisodeIdx(child.current_episode);
								}}
							>
								<span className="block">{child.name}</span>
								<span
									className={`block text-xs ${
										child.id === selectedChild?.id
											? "text-stone-300"
											: "text-stone-400"
									}`}
								>
									{child.active_season}
								</span>
							</button>
						))}
					</div>

					{selectedChild && (
						<section className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
							<dl className="space-y-3">
								<div>
									<dt className="text-xs font-semibold uppercase tracking-normal text-stone-400">
										Story
									</dt>
									<dd className="mt-1 text-stone-700">
										{selectedChild.season.name}
									</dd>
								</div>
								<div>
									<dt className="text-xs font-semibold uppercase tracking-normal text-stone-400">
										Theme
									</dt>
									<dd className="mt-1 text-stone-700">{selectedChild.theme}</dd>
								</div>
								<div>
									<dt className="text-xs font-semibold uppercase tracking-normal text-stone-400">
										Target
									</dt>
									<dd className="mt-1 text-stone-700">
										{selectedChild.target_wpm} WPM
									</dd>
								</div>
								<div>
									<dt className="text-xs font-semibold uppercase tracking-normal text-stone-400">
										Progress
									</dt>
									<dd className="mt-1 text-stone-700">
										Chapter {selectedChild.current_episode + 1} of{" "}
										{selectedChild.season.episodes.length}
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
							{selectedChild?.season.episodes.map((episode) => (
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

					{selectedChild && selectedEpisode && (
						<div className="space-y-5">
							<section className="rounded-lg border border-stone-200 bg-white p-5">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<h2 className="font-serif text-2xl font-bold tracking-tight">
											{selectedChild.season.name} chapter{" "}
											{selectedEpisode.idx + 1}
										</h2>
										<p className="mt-1 text-sm text-stone-500">
											{selectedChild.active_season}
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
							</section>
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
