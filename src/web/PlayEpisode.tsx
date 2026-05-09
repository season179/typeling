import { useEffect, useState } from "react";
import { useParams } from "wouter";

interface EpisodeData {
	text: string;
	episode_idx: number;
	season_slug: string;
}

export default function PlayEpisode() {
	const { childId } = useParams<{ childId: string }>();

	const [episode, setEpisode] = useState<EpisodeData | null>(null);
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
				const res = await fetch(`/api/children/${childId}/current-episode`, {
					signal: controller.signal,
				});
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				setEpisode(await res.json());
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

	if (!episode) {
		return null;
	}

	return (
		<main className="flex min-h-screen items-center justify-center">
			<p className="font-mono">{episode.text}</p>
		</main>
	);
}
