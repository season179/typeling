import { Window, GlobalWindow } from "happy-dom";
import { beforeAll, afterAll, afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";

const window = new GlobalWindow() as unknown as Window & typeof globalThis;

export function setupDom() {
	beforeAll(() => {
		// @ts-expect-error happy-dom globals
		globalThis.window = window;
		globalThis.document = window.document;
		globalThis.navigator = window.navigator;
	});

	afterAll(() => {
		window.close();
	});

	afterEach(() => {
		cleanup();
	});
}
