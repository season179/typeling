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
	graduated: { className: "bg-green-100 text-green-800", label: "graduated" },
	"in progress": {
		className: "bg-blue-100 text-blue-800",
		label: "in progress",
	},
	"no sessions yet": {
		className: "bg-gray-100 text-gray-600",
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

	return (
		<main className="min-h-screen p-8 max-w-4xl mx-auto">
			<h1 className="text-3xl font-bold mb-8">Parent View</h1>
			<div className="space-y-8">
				{childEntries.map(({ id, child, rolling3, status, last10 }) => (
					<section key={id} className="border rounded-lg p-6 shadow-sm">
						<div className="flex items-baseline justify-between mb-4">
							<div>
								<h2 className="text-2xl font-semibold">{child.name}</h2>
								<p className="text-sm text-gray-500">
									{child.theme} · Target: {child.target_wpm} WPM
								</p>
							</div>
							<div className="text-right">
								<span
									className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${STATUS_MAP[status].className}`}
								>
									{STATUS_MAP[status].label}
								</span>
								{rolling3 !== null && (
									<p className="text-sm text-gray-500 mt-1">
										Rolling-3: {Math.round(rolling3)} WPM
									</p>
								)}
							</div>
						</div>

						{last10.length === 0 ? (
							<p className="text-sm text-gray-400 italic">
								No sessions completed yet.
							</p>
						) : (
							<table className="w-full text-sm">
								<thead>
									<tr className="text-left text-gray-500 border-b">
										<th className="pb-2 font-medium">WPM</th>
										<th className="pb-2 font-medium">Chars</th>
										<th className="pb-2 font-medium">Time</th>
										<th className="pb-2 font-medium">Finished</th>
									</tr>
								</thead>
								<tbody>
									{last10.map((s) => (
										<tr key={s.id} className="border-b border-gray-100">
											<td className="py-2">{Math.round(s.wpm)}</td>
											<td className="py-2">{s.char_count}</td>
											<td className="py-2">{formatMs(s.active_ms)}</td>
											<td className="py-2">
												{formatRelativeTime(s.finished_at, now)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</section>
				))}
			</div>
		</main>
	);
}
