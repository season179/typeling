const INVALID = /[^A-Za-z0-9 .,!?'";:()\n-]/;

export class CharsetError extends Error {
	position: number;
	char: string;

	constructor(position: number, char: string) {
		super(`Invalid character '${char}' at position ${position}`);
		this.name = "CharsetError";
		this.position = position;
		this.char = char;
	}
}

export function assertCharset(text: string): void {
	const idx = text.search(INVALID);
	if (idx !== -1) {
		throw new CharsetError(idx, text.charAt(idx));
	}
}
