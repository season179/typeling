import { useEffect, useMemo, useState } from "react";
import type { GraduationStatus } from "../lib/graduation";
import { graduationStatus } from "../lib/graduation";
import { rolling3Wpm } from "../lib/rolling3";
import type { Session } from "../lib/schemas/state";

interface ChildSummary {
	name: string;
	theme: string;
	target_wpm: number;
	active_season: string;
}

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

function formatMs(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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

export default function ParentView() {
	const [children, setChildren] = useState<Record<string, ChildSummary>>({});
	const [sessions, setSessions] = useState<Record<string, Session[]>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
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
				const childrenData: Record<string, ChildSummary> =
					await childrenRes.json();
				if (controller.signal.aborted) return;
				setChildren(childrenData);

				const entries = Object.entries(childrenData);
				const sessionResults = await Promise.all(
					entries.map(async ([id]) => {
						const res = await fetch(`/api/children/${id}/sessions`, {
							signal: controller.signal,
						});
						if (res.ok) return { id, sessions: await res.json() };
						return { id, sessions: [] as Session[] };
					}),
				);

				if (controller.signal.aborted) return;

				const sessionsMap: Record<string, Session[]> = {};
				for (const { id, sessions: s } of sessionResults) {
					sessionsMap[id] = s;
				}
				setSessions(sessionsMap);
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

	const now = Date.now();

	const childEntries = useMemo(
		() =>
			Object.entries(children).map(([id, child]) => {
				const childSessions = sessions[id] ?? [];
				const rolling3 = rolling3Wpm(childSessions, {
					seasonSlug: child.active_season,
				});
				const status = graduationStatus(rolling3, child.target_wpm);
				const last10 = childSessions.slice(0, 10);
				return { id, child, rolling3, status, last10 };
			}),
		[children, sessions],
	);

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

	return (
		<main className="min-h-screen bg-stone-50 p-6 sm:p-10">
			<div className="mx-auto max-w-3xl">
				<header className="mb-10">
					<h1 className="font-serif text-3xl font-bold text-stone-800 tracking-tight">
						Admin Progress
					</h1>
					<p className="mt-1 text-sm text-stone-400">
						Typing sessions for each child
					</p>
				</header>

				<div className="space-y-10">
					{childEntries.map(({ id, child, rolling3, status, last10 }) => (
						<section key={id}>
							{/* Child header card */}
							<div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
								<div>
									<h2 className="font-serif text-2xl font-semibold text-stone-800">
										{child.name}
									</h2>
									<p className="text-sm text-stone-400">
										{child.theme} · Target {child.target_wpm} WPM
									</p>
								</div>
								<div className="flex items-center gap-3">
									{rolling3 !== null && (
										<span className="text-sm text-stone-400">
											Rolling 3:{" "}
											<span className="font-semibold text-stone-600">
												{Math.round(rolling3)}
											</span>{" "}
											WPM
										</span>
									)}
									<span
										className={`inline-block rounded-full px-3 py-0.5 text-xs font-semibold tracking-wide uppercase ${STATUS_MAP[status].className}`}
									>
										{STATUS_MAP[status].label}
									</span>
								</div>
							</div>

							{/* Sessions card */}
							<div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
								{last10.length === 0 ? (
									<div className="px-6 py-12 text-center">
										<p className="text-sm text-stone-400">
											No sessions completed yet — time to type!
										</p>
									</div>
								) : (
									<table className="w-full text-sm">
										<thead>
											<tr className="border-b border-stone-100 bg-stone-50/50 text-left">
												<th className="py-3 pl-6 pr-2 font-medium text-stone-400">
													Speed{" "}
													<span className="font-normal text-stone-300">
														WPM
													</span>
												</th>
												<th className="py-3 px-2 font-medium text-stone-400">
													Length{" "}
													<span className="font-normal text-stone-300">
														chars
													</span>
												</th>
												<th className="py-3 px-2 font-medium text-stone-400">
													Active time{" "}
													<span className="font-normal text-stone-300">
														typing
													</span>
												</th>
												<th className="py-3 pr-4 pl-2 font-medium text-stone-400">
													Completed
												</th>
											</tr>
										</thead>
										<tbody>
											{last10.map((s) => (
												<tr
													key={s.id}
													className="border-b border-stone-50 transition-colors hover:bg-amber-50/40"
												>
													<td className="py-3 pl-6 pr-2 font-semibold text-stone-700 tabular-nums">
														{Math.round(s.wpm)}
													</td>
													<td className="py-3 px-2 tabular-nums text-stone-600">
														{s.char_count}
													</td>
													<td className="py-3 px-2 tabular-nums text-stone-600">
														{formatMs(s.active_ms)}
													</td>
													<td className="py-3 pr-4 pl-2 text-stone-500">
														{formatRelativeTime(s.finished_at, now)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								)}

								{/* Session ID footer for the most recent session */}
								{last10.length > 0 && (
									<div className="border-t border-stone-100 bg-stone-50/30 px-6 py-2.5">
										<p className="font-mono text-[11px] text-stone-400">
											<span className="text-stone-300">session id </span>
											{last10[0]?.id}
										</p>
									</div>
								)}
							</div>
						</section>
					))}
				</div>
			</div>
		</main>
	);
}
