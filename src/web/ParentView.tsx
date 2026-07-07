import { useEffect, useState } from "react";
import type { GraduationStatus } from "../lib/graduation";
import {
	type FamilyResponse,
	getFamily,
	type ReaderStoryProgress,
} from "./api";
import { authClient } from "./authClient";
import Sparkline from "./Sparkline";
import { type StoryTheme, themeForStory } from "./storyTheme";

const STATUS_MAP: Record<
	GraduationStatus,
	{ className: string; label: string }
> = {
	graduated: {
		className: "bg-emerald-100 text-emerald-800",
		label: "graduated",
	},
	"in progress": {
		className: "bg-sky-100 text-sky-800",
		label: "in progress",
	},
	"no sessions yet": {
		className: "bg-stone-100 text-stone-500",
		label: "no sessions yet",
	},
};

const ACCENT: Record<StoryTheme, string> = {
	rainbow: "#f45fc4",
	science: "#2288ff",
	meadow: "#4aa24a",
};

function formatMs(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Friendly lifetime duration, e.g. "1h 5m", "12m 30s", "45s". */
function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function formatRelativeTime(iso: string, now: number): string {
	const then = new Date(iso).getTime();
	const diffMinutes = Math.max(0, Math.floor((now - then) / 60000));
	if (diffMinutes < 1) return "just now";
	if (diffMinutes < 60) return `${diffMinutes}m ago`;
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	return `${diffDays}d ago`;
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col">
			<span className="text-lg font-semibold text-stone-700 tabular-nums">
				{value}
			</span>
			<span className="text-xs text-stone-400">{label}</span>
		</div>
	);
}

function StoryCard({
	story,
	now,
}: {
	story: ReaderStoryProgress;
	now: number;
}) {
	const accent = ACCENT[themeForStory(story.slug, story.theme)];
	const totals = story.totals;
	const last10 = story.recent_sessions;

	return (
		<article
			className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm"
			style={{ borderTopColor: accent, borderTopWidth: 3 }}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
				<div>
					<h3 className="font-serif text-xl font-semibold text-stone-800">
						{story.name}
					</h3>
					<p className="text-sm text-stone-400">
						{story.theme} · Chapter{" "}
						{Math.min(story.current_episode + 1, story.total_episodes)} of{" "}
						{story.total_episodes} · Target {story.target_wpm} WPM
					</p>
				</div>
				<div className="flex items-center gap-3">
					{story.rolling3 !== null && (
						<span className="text-sm text-stone-400">
							Rolling 3:{" "}
							<span className="font-semibold text-stone-600">
								{Math.round(story.rolling3)}
							</span>{" "}
							WPM
						</span>
					)}
					<span
						className={`inline-block rounded-full px-3 py-0.5 text-xs font-semibold tracking-wide uppercase ${STATUS_MAP[story.status].className}`}
					>
						{STATUS_MAP[story.status].label}
					</span>
				</div>
			</div>

			<div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
				<div className="flex flex-wrap gap-6">
					<Stat label="sessions" value={String(totals.count)} />
					<Stat
						label="time typing"
						value={formatDuration(totals.total_active_ms)}
					/>
					<Stat
						label="best WPM"
						value={
							totals.best_wpm === null
								? "—"
								: String(Math.round(totals.best_wpm))
						}
					/>
					<Stat
						label="avg WPM"
						value={
							totals.avg_wpm === null ? "—" : String(Math.round(totals.avg_wpm))
						}
					/>
				</div>
				<div className="flex flex-col items-end">
					<Sparkline values={story.trend} color={accent} />
					<span className="text-xs text-stone-400">
						{story.last_active_at
							? `last active ${formatRelativeTime(story.last_active_at, now)}`
							: "no activity yet"}
					</span>
				</div>
			</div>

			{last10.length === 0 ? (
				<div className="border-t border-stone-100 px-5 py-6 text-center">
					<p className="text-sm text-stone-400">No sessions completed yet.</p>
				</div>
			) : (
				<table className="w-full border-t border-stone-100 text-sm">
					<thead>
						<tr className="bg-stone-50/50 text-left">
							<th className="py-2 pl-5 pr-2 font-medium text-stone-400">
								Speed <span className="font-normal text-stone-300">WPM</span>
							</th>
							<th className="py-2 px-2 font-medium text-stone-400">
								Length <span className="font-normal text-stone-300">chars</span>
							</th>
							<th className="py-2 px-2 font-medium text-stone-400">
								Active time{" "}
								<span className="font-normal text-stone-300">typing</span>
							</th>
							<th className="py-2 pr-5 pl-2 font-medium text-stone-400">
								Completed
							</th>
						</tr>
					</thead>
					<tbody>
						{last10.map((session) => (
							<tr
								key={session.id}
								className="border-t border-stone-50 transition-colors hover:bg-amber-50/40"
							>
								<td className="py-2 pl-5 pr-2 font-semibold text-stone-700 tabular-nums">
									{Math.round(session.wpm)}
								</td>
								<td className="py-2 px-2 tabular-nums text-stone-600">
									{session.char_count}
								</td>
								<td className="py-2 px-2 tabular-nums text-stone-600">
									{formatMs(session.active_ms)}
								</td>
								<td className="py-2 pr-5 pl-2 text-stone-500">
									{formatRelativeTime(session.finished_at, now)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</article>
	);
}

export default function ParentView() {
	const [data, setData] = useState<FamilyResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [needsSignIn, setNeedsSignIn] = useState(false);
	const [forbidden, setForbidden] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		const load = async () => {
			try {
				setLoading(true);
				setError(null);
				setNeedsSignIn(false);
				setForbidden(false);

				const nextData = await getFamily(controller.signal);
				if (!controller.signal.aborted) {
					setData(nextData);
				}
			} catch (err) {
				if (controller.signal.aborted) return;
				const message = err instanceof Error ? err.message : "Failed to load";
				if (message === "HTTP 401") {
					setNeedsSignIn(true);
				} else if (message === "HTTP 403") {
					setForbidden(true);
				} else {
					setError(message);
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
		void authClient.signIn.social({
			provider: "google",
			callbackURL: "/parent",
		});
	};

	const now = Date.now();

	if (loading) {
		return (
			<main className="flex min-h-screen items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
					<p className="text-sm text-stone-400">Loading…</p>
				</div>
			</main>
		);
	}

	if (needsSignIn) {
		return (
			<main className="flex min-h-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4 rounded-lg border border-stone-200 bg-white px-8 py-6 text-center shadow-sm">
					<h1 className="font-serif text-2xl font-bold text-stone-800">
						Story Progress
					</h1>
					<p className="text-sm text-stone-500">
						Sign in with a parent account to view stats.
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

	if (forbidden) {
		return (
			<main className="flex min-h-screen items-center justify-center">
				<div className="max-w-sm rounded-lg border border-amber-200 bg-amber-50 px-6 py-5 text-center text-sm text-amber-800">
					<p className="font-semibold">This account can't view stats</p>
					<p className="mt-1 text-amber-700">
						The signed-in account isn't on the parent allowlist. Add it from a
						local machine with{" "}
						<code className="rounded bg-amber-100 px-1">parent_viewers</code>.
					</p>
				</div>
			</main>
		);
	}

	if (error) {
		return (
			<main className="flex min-h-screen items-center justify-center">
				<div className="rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700">
					<p className="font-semibold">Couldn't load data</p>
					<p className="mt-1 text-red-600">{error}</p>
				</div>
			</main>
		);
	}

	const readers = data?.readers ?? [];

	return (
		<main className="min-h-screen bg-stone-50 p-6 sm:p-10">
			<div className="mx-auto max-w-3xl">
				<header className="mb-10">
					<h1 className="font-serif text-3xl font-bold text-stone-800 tracking-tight">
						Story Progress
					</h1>
					<p className="mt-1 text-sm text-stone-400">
						{readers.length} reader{readers.length === 1 ? "" : "s"} · who did
						what across every story
					</p>
				</header>

				{readers.length === 0 ? (
					<p className="text-sm text-stone-400">No readers yet.</p>
				) : (
					<div className="space-y-12">
						{readers.map((reader) => (
							<section key={reader.email}>
								<div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 pb-2">
									<h2 className="font-serif text-2xl font-semibold text-stone-800">
										{reader.display_name}
									</h2>
									<span className="text-sm text-stone-400">
										{reader.email} · target {reader.target_wpm} WPM
									</span>
								</div>
								<div className="space-y-5">
									{reader.stories.map((story) => (
										<StoryCard key={story.slug} story={story} now={now} />
									))}
								</div>
							</section>
						))}
					</div>
				)}
			</div>
		</main>
	);
}
