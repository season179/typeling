import { useEffect, useState } from "react";

export default function App() {
	const [health, setHealth] = useState<unknown>(null);

	useEffect(() => {
		const controller = new AbortController();

		const loadHealth = async () => {
			try {
				const res = await fetch("/api/health", { signal: controller.signal });
				setHealth(await res.json());
			} catch {
				if (!controller.signal.aborted) {
					setHealth({ error: true });
				}
			}
		};

		void loadHealth();

		return () => controller.abort();
	}, []);

	return (
		<main className="flex min-h-screen items-center justify-center">
			<h1 className="text-3xl font-bold">Typeling</h1>
			{health !== null && (
				<pre className="mt-4 text-sm">{JSON.stringify(health)}</pre>
			)}
		</main>
	);
}
