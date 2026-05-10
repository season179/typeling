export type GraduationStatus = "no sessions yet" | "graduated" | "in progress";

export function graduationStatus(
	rolling3: number | null,
	targetWpm: number,
): GraduationStatus {
	if (rolling3 === null) return "no sessions yet";
	return rolling3 >= targetWpm ? "graduated" : "in progress";
}
