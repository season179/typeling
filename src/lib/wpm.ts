export function wpmFromCharsAndMs(charCount: number, activeMs: number): number {
	if (activeMs === 0) return 0;
	return charCount / 5 / (activeMs / 60000);
}
