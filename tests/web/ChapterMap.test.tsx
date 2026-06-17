import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ChapterMap } from "../../src/web/CompleteEpisode";
import { setupDom } from "./setup";

setupDom();

function renderMap(props: {
	totalEpisodes: number;
	completedUpTo: number;
	storySlug?: string;
}) {
	const { hook, history } = memoryLocation({
		path: "/play/winni-s1/complete/0",
		record: true,
	});
	const result = render(
		<Router hook={hook}>
			<ChapterMap
				storySlug={props.storySlug ?? "winni-s1"}
				totalEpisodes={props.totalEpisodes}
				completedUpTo={props.completedUpTo}
			/>
		</Router>,
	);
	return { ...result, history };
}

describe("ChapterMap", () => {
	it("renders one node per episode from season length (28 after the split)", () => {
		const { getAllByTestId } = renderMap({
			totalEpisodes: 28,
			completedUpTo: 5,
		});
		expect(getAllByTestId("chapter-cell")).toHaveLength(28);
	});

	it("scales to any season length, not a hardcoded count", () => {
		const { getAllByTestId } = renderMap({
			totalEpisodes: 14,
			completedUpTo: 0,
		});
		expect(getAllByTestId("chapter-cell")).toHaveLength(14);
	});

	it("marks completed, current, and upcoming chapters correctly", () => {
		const { getAllByTestId } = renderMap({
			totalEpisodes: 28,
			completedUpTo: 3,
		});
		const cells = getAllByTestId("chapter-cell");

		// 0..3 completed (and unlocked), 3 is current, 4..27 upcoming/locked.
		expect(cells[0]?.getAttribute("data-status")).toBe("completed");
		expect(cells[3]?.getAttribute("data-status")).toBe("completed");
		expect(cells[3]?.getAttribute("data-current")).toBe("true");
		expect((cells[3] as HTMLButtonElement).disabled).toBe(false);

		expect(cells[4]?.getAttribute("data-status")).toBe("upcoming");
		expect((cells[4] as HTMLButtonElement).disabled).toBe(true);
		expect(cells[27]?.getAttribute("data-status")).toBe("upcoming");
	});

	it("navigates to a completed chapter's episode on click", () => {
		const { getAllByTestId, history } = renderMap({
			totalEpisodes: 28,
			completedUpTo: 10,
		});
		const cells = getAllByTestId("chapter-cell");

		fireEvent.click(cells[7] as HTMLButtonElement);
		expect(history.at(-1)).toBe("/play/winni-s1/episode/7");
	});
});
