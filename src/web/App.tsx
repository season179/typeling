import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { clearStaleDrafts } from "./episodeRunner/autosave";

interface ChildSummary {
	name: string;
	theme: string;
	active_season: string;
}

export default function App() {
	const [, navigate] = useLocation();
	const [children, setChildren] = useState<Record<string, ChildSummary>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		const load = async () => {
			try {
				setLoading(true);
				setError(null);
				const res = await fetch("/api/children", {
					signal: controller.signal,
				});
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				const data = await res.json();
				if (!controller.signal.aborted) {
					setChildren(data);
					clearStaleDrafts(data);
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

	const childEntries = Object.entries(children);

	if (childEntries.length === 0) {
		return (
			<main className="flex min-h-screen items-center justify-center">
				<p className="text-lg text-gray-500">No children configured yet.</p>
			</main>
		);
	}

	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
			<h1 className="text-3xl font-bold">Typeling</h1>
			<div className="flex flex-wrap gap-4">
				{childEntries.map(([id, child]) => (
					<button
						key={id}
						type="button"
						className="rounded-lg border-2 border-gray-200 p-6 text-left hover:border-blue-400 hover:shadow-md transition-all"
						onClick={() => navigate(`/play/${id}`)}
					>
						<span className="block text-xl font-semibold">{child.name}</span>
						<span className="block text-sm text-gray-500">{child.theme}</span>
					</button>
				))}
			</div>
		</main>
	);
}
