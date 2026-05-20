import {
	type KeyboardEvent,
	type TouchEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type WheelEvent,
} from "react";
import { findActiveWordIndex } from "../lib/audioPlayback";
import { tokenizeStoryText } from "../lib/storyWordTokens";

interface AudioWord {
	index: number;
	text: string;
	start: number;
	end: number;
}

interface EpisodeAudioPayload {
	audio_url: string;
	duration_seconds: number;
	words: AudioWord[];
}

interface StoryAudioPlayerProps {
	childId: string;
	episodeIdx: number;
	text: string;
	onTypeAgain: () => void;
}

type AudioLoadState = "loading" | "ready" | "unavailable";
type PlaybackState =
	| "idle"
	| "ready"
	| "playing"
	| "paused"
	| "ended"
	| "error";

const SCROLL_KEYS = new Set([
	" ",
	"ArrowDown",
	"ArrowUp",
	"End",
	"Home",
	"PageDown",
	"PageUp",
]);

function isEpisodeAudioPayload(value: unknown): value is EpisodeAudioPayload {
	if (!value || typeof value !== "object") return false;
	const candidate = value as EpisodeAudioPayload;
	return (
		typeof candidate.audio_url === "string" &&
		typeof candidate.duration_seconds === "number" &&
		Array.isArray(candidate.words) &&
		candidate.words.every(
			(word) =>
				Number.isInteger(word.index) &&
				typeof word.text === "string" &&
				Number.isFinite(word.start) &&
				Number.isFinite(word.end),
		)
	);
}

function requestFrame(callback: FrameRequestCallback): number {
	if (typeof window.requestAnimationFrame === "function") {
		return window.requestAnimationFrame(callback);
	}
	return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(id: number): void {
	if (typeof window.cancelAnimationFrame === "function") {
		window.cancelAnimationFrame(id);
	} else {
		window.clearTimeout(id);
	}
}

function readStoryButtonLabel(
	audioState: AudioLoadState,
	playbackState: PlaybackState,
): string {
	if (audioState === "unavailable" || playbackState === "error") {
		return "Read story";
	}
	if (playbackState === "playing") return "Pause story";
	if (playbackState === "ended") return "Read again";
	return "Read story";
}

export default function StoryAudioPlayer({
	childId,
	episodeIdx,
	text,
	onTypeAgain,
}: StoryAudioPlayerProps) {
	const tokens = useMemo(() => tokenizeStoryText(text), [text]);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const wordRefs = useRef(new Map<number, HTMLSpanElement>());
	const [audioState, setAudioState] = useState<AudioLoadState>("loading");
	const [audioData, setAudioData] = useState<EpisodeAudioPayload | null>(null);
	const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
	const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
	const isNarrating = playbackState === "playing";

	useEffect(() => {
		const controller = new AbortController();

		const loadAudio = async () => {
			setAudioState("loading");
			setAudioData(null);
			setPlaybackState("idle");
			setActiveWordIndex(null);

			try {
				const res = await fetch(
					`/api/children/${childId}/episodes/${episodeIdx}/audio`,
					{ signal: controller.signal },
				);
				if (!res.ok) {
					setAudioState("unavailable");
					return;
				}

				const payload = await res.json();
				if (!controller.signal.aborted && isEpisodeAudioPayload(payload)) {
					setAudioData(payload);
					setAudioState("ready");
					setPlaybackState("ready");
				} else if (!controller.signal.aborted) {
					setAudioState("unavailable");
				}
			} catch {
				if (!controller.signal.aborted) {
					setAudioState("unavailable");
				}
			}
		};

		void loadAudio();
		return () => controller.abort();
	}, [childId, episodeIdx]);

	const syncActiveWord = useCallback(() => {
		const audio = audioRef.current;
		if (!audio || !audioData) return;

		setActiveWordIndex(findActiveWordIndex(audioData.words, audio.currentTime));
	}, [audioData]);

	useEffect(() => {
		if (playbackState !== "playing") return;

		let frameId: number | null = null;
		const tick = () => {
			syncActiveWord();
			frameId = requestFrame(tick);
		};

		syncActiveWord();
		frameId = requestFrame(tick);
		return () => {
			if (frameId !== null) {
				cancelFrame(frameId);
			}
		};
	}, [playbackState, syncActiveWord]);

	useEffect(() => {
		if (!isNarrating || activeWordIndex === null) return;
		wordRefs.current
			.get(activeWordIndex)
			?.scrollIntoView({ block: "center", inline: "nearest" });
	}, [activeWordIndex, isNarrating]);

	const handleReadStoryClick = async () => {
		const audio = audioRef.current;
		if (!audio || !audioData || audioState !== "ready") return;

		if (playbackState === "playing") {
			audio.pause();
			setPlaybackState("paused");
			return;
		}

		if (playbackState === "ended") {
			audio.currentTime = 0;
			setActiveWordIndex(null);
		}

		try {
			await audio.play();
			setPlaybackState("playing");
		} catch {
			setPlaybackState("error");
		}
	};

	const handlePause = () => {
		setPlaybackState((state) => (state === "ended" ? state : "paused"));
	};

	const handleEnded = () => {
		setPlaybackState("ended");
		setActiveWordIndex(null);
	};

	const preventManualScroll = (
		event: WheelEvent<HTMLElement> | TouchEvent<HTMLElement>,
	) => {
		if (isNarrating) {
			event.preventDefault();
		}
	};

	const preventScrollKey = (event: KeyboardEvent<HTMLElement>) => {
		if (isNarrating && SCROLL_KEYS.has(event.key)) {
			event.preventDefault();
		}
	};

	const readStoryDisabled = audioState !== "ready" || playbackState === "error";
	const readStoryLabel = readStoryButtonLabel(audioState, playbackState);

	return (
		<>
			<fieldset className="reader-actions" aria-label="Chapter actions">
				<button
					type="button"
					data-testid="read-story-toggle"
					className="reader-mode reader-mode-active"
					disabled={readStoryDisabled}
					data-playing={isNarrating ? "true" : undefined}
					onClick={handleReadStoryClick}
				>
					{readStoryLabel}
				</button>
				<button type="button" className="reader-mode" onClick={onTypeAgain}>
					Type again
				</button>
			</fieldset>
			{audioData && (
				// biome-ignore lint/a11y/useMediaCaption: The visible story text is the synchronized transcript for this narration.
				<audio
					ref={audioRef}
					src={audioData.audio_url}
					preload="metadata"
					onPlay={() => setPlaybackState("playing")}
					onPause={handlePause}
					onEnded={handleEnded}
					onError={() => setPlaybackState("error")}
					onSeeked={syncActiveWord}
					onTimeUpdate={syncActiveWord}
				/>
			)}
			<article
				className={`reader-story ${isNarrating ? "reader-story-locked" : ""}`}
				data-testid="story-reader"
				aria-label="Narrated story text"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable story region needs focus so scroll-key input can be locked while narration plays.
				tabIndex={0}
				onWheel={preventManualScroll}
				onTouchMove={preventManualScroll}
				onKeyDown={preventScrollKey}
			>
				<p className="reader-story-text">
					{tokens.map((token, index) => {
						if (token.kind !== "word") {
							return (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: display tokens are stable for the loaded story text
									key={index}
								>
									{token.text}
								</span>
							);
						}

						const isActive = token.wordIndex === activeWordIndex;
						return (
							<span
								// biome-ignore lint/suspicious/noArrayIndexKey: display tokens are stable for the loaded story text
								key={index}
								ref={(element) => {
									if (element) {
										wordRefs.current.set(token.wordIndex, element);
									} else {
										wordRefs.current.delete(token.wordIndex);
									}
								}}
								className={`reader-word ${
									isActive ? "reader-word-active" : ""
								}`}
								data-testid={`story-word-${token.wordIndex}`}
								data-word-index={token.wordIndex}
								data-active={isActive ? "true" : undefined}
							>
								{token.text}
							</span>
						);
					})}
				</p>
			</article>
		</>
	);
}
