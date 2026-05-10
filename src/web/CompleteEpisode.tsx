import { useEffect, useState } from "react";
import { useParams } from "wouter";

interface ChildSummary {
	name: string;
}

export default function CompleteEpisode() {
	const { childId, episodeIdx } = useParams<{
		childId: string;
		episodeIdx: string;
	}>();
	const [childName, setChildName] = useState<string | null>(null);
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
				const res = await fetch("/api/children", {
					signal: controller.signal,
				});
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				const data = (await res.json()) as Record<string, ChildSummary>;
				if (!controller.signal.aborted) {
					const child = data[childId];
					if (!child) {
						setError("Child not found");
					} else {
						setChildName(child.name);
					}
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

	return (
		<main
			data-testid="complete-episode"
			className="flex min-h-screen flex-col items-center justify-center gap-4 p-8"
		>
			<h1 className="text-3xl font-bold">Episode {episodeNumber} complete!</h1>
			{childName && (
				<p className="text-xl text-gray-600">Great job, {childName}!</p>
			)}
		</main>
	);
}
