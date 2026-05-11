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
			<main className="typeling-game flex min-h-screen items-center justify-center theme-winni">
				<div className="loading-card">Loading story keys...</div>
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

	const childEntries = Object.entries(children);

	if (childEntries.length === 0) {
		return (
			<main className="typeling-game flex min-h-screen items-center justify-center theme-winni">
				<p className="text-lg text-gray-500">No children configured yet.</p>
			</main>
		);
	}

	return (
		<main className="home-world typeling-game flex min-h-screen flex-col items-center justify-center gap-6 p-8 theme-winni">
			<div className="game-sky" aria-hidden="true">
				<div className="moon-or-planet" />
				<div className="drift-shape drift-shape-a" />
				<div className="drift-shape drift-shape-b" />
				<div className="ground-glow" />
			</div>
			<h1 className="home-title text-3xl font-bold">Typeling</h1>
			<div className="child-select flex flex-wrap justify-center gap-4">
				{childEntries.map(([id, child]) => (
					<button
						key={id}
						type="button"
						className={`child-card rounded-lg border-2 border-gray-200 p-6 text-left transition-all hover:border-blue-400 hover:shadow-md ${
							id.toLowerCase().includes("zack") ? "zack-card" : "winni-card"
						}`}
						onClick={() => navigate(`/play/${id}`)}
					>
						<span className="child-token" aria-hidden="true" />
						<span className="block text-xl font-semibold">{child.name}</span>
						<span className="block text-sm text-gray-500">{child.theme}</span>
					</button>
				))}
			</div>
		</main>
	);
}
