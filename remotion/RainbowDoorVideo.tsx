import type { CSSProperties, ReactNode } from "react";
import {
	AbsoluteFill,
	Easing,
	Html5Audio,
	interpolate,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";

export const VIDEO_FPS = 30;
export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_DURATION_IN_FRAMES = 22 * VIDEO_FPS;

type RainbowDoorEpisode = {
	idx: number;
	text: string;
};

type RainbowDoorSeason = {
	slug: string;
	name: string;
	theme: string;
	episodes: RainbowDoorEpisode[];
};

export type RainbowDoorVideoProps = {
	season: RainbowDoorSeason;
};

const rainbowColors = [
	"#f34f86",
	"#ff9736",
	"#ffe34a",
	"#57d66f",
	"#45bbff",
	"#8b63ff",
] as const;

const sparkleSeeds = [
	[10, 16, 0.1],
	[18, 33, 0.5],
	[27, 22, 1.2],
	[35, 44, 0.9],
	[49, 18, 1.8],
	[62, 35, 0.2],
	[73, 22, 1.5],
	[84, 42, 0.7],
	[91, 15, 1.1],
	[7, 52, 1.6],
] as const;

const leafSeeds = [
	[0, 0.2],
	[35, 1.1],
	[70, 2.2],
	[105, 0.7],
	[140, 1.9],
	[175, 2.8],
] as const;

export const RainbowDoorVideo = ({ season }: RainbowDoorVideoProps) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const chapter = season.episodes.find((episode) => episode.idx === 0);
	const portalOpen = smooth(frame, 15.1 * fps, 17.2 * fps, easeOut);
	const magicBuild = smooth(frame, 9.2 * fps, 15.8 * fps, easeInOut);
	const revealFlash = pulse(frame, 16.4 * fps, 1.1 * fps);
	const shake =
		portalOpen > 0 && portalOpen < 0.98 ? Math.sin(frame * 2.4) * 7 : 0;
	const cameraScale = interpolate(
		frame,
		[0, 4 * fps, 8 * fps, 13 * fps, 17 * fps, 20.6 * fps],
		[1.02, 1.08, 1.28, 1.34, 1.62, 1.06],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
	const cameraX = interpolate(
		frame,
		[0, 5 * fps, 9 * fps, 14.4 * fps, 18.5 * fps],
		[0, -34, -178, -206, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
	const cameraY = interpolate(
		frame,
		[0, 7 * fps, 14.5 * fps, 18.5 * fps],
		[0, -22, -52, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
	const lumaRun = smooth(frame, 0.3 * fps, 3.7 * fps, easeOut);
	const lumaLean = smooth(frame, 6.9 * fps, 9.4 * fps, easeInOut);

	return (
		<AbsoluteFill style={styles.stage}>
			<Html5Audio
				src={staticFile("rainbow-door-music.wav")}
				volume={(audioFrame) =>
					interpolate(
						audioFrame,
						[0, 12, VIDEO_DURATION_IN_FRAMES - 28, VIDEO_DURATION_IN_FRAMES],
						[0.78, 1, 1, 0.72],
						{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
					)
				}
			/>
			<div
				style={{
					...styles.world,
					transform: `translate(${cameraX + shake}px, ${cameraY}px) scale(${cameraScale})`,
				}}
			>
				<Sky frame={frame} magicBuild={magicBuild} />
				<Meadow />
				<OldOak frame={frame} />
				<RainbowPath frame={frame} portalOpen={portalOpen} />
				<TinyDoor
					frame={frame}
					openAmount={portalOpen}
					magicBuild={magicBuild}
					revealFlash={revealFlash}
				/>
				<Luma
					frame={frame}
					x={interpolate(lumaRun, [0, 1], [-120, 292])}
					y={390 + Math.sin(frame / 6) * 4 + lumaLean * 34}
					lean={lumaLean}
				/>
				<MagicLeaves frame={frame} magicBuild={magicBuild} />
				<Butterflies
					frame={frame}
					active={smooth(frame, 2 * fps, 7 * fps, easeOut)}
				/>
				<Sparkles
					frame={frame}
					intensity={0.35 + magicBuild * 1.4 + portalOpen}
				/>
			</div>
			<StoryBeats frame={frame} fps={fps} chapterText={chapter?.text ?? ""} />
			<WhooshWords frame={frame} fps={fps} />
			<TitleHit frame={frame} fps={fps} seasonName={season.name} />
			<div
				style={{
					...styles.flash,
					opacity: revealFlash * 0.56,
				}}
			/>
		</AbsoluteFill>
	);
};

const Sky = ({ frame, magicBuild }: { frame: number; magicBuild: number }) => {
	const pulseSun = 1 + Math.sin(frame / 12) * 0.035 + magicBuild * 0.04;
	return (
		<>
			<div
				style={{
					...styles.skyGlow,
					opacity: 0.36 + magicBuild * 0.26,
					transform: `scale(${1 + magicBuild * 0.24})`,
				}}
			/>
			<div
				style={{
					...styles.sun,
					transform: `scale(${pulseSun}) rotate(${frame * 0.18}deg)`,
				}}
			/>
			<Cloud x={108 + Math.sin(frame / 30) * 28} y={94} scale={0.88} />
			<Cloud x={776 + Math.sin(frame / 38) * -26} y={96} scale={1.08} />
			<Cloud x={1014 + Math.sin(frame / 34) * 20} y={210} scale={0.68} />
			<div style={styles.backHill} />
			<div style={styles.frontHill} />
		</>
	);
};

const Meadow = () => (
	<>
		<div style={styles.meadowFloor} />
		{[
			[90, 586, "#f34f86"],
			[172, 622, "#ffe34a"],
			[270, 596, "#45bbff"],
			[375, 634, "#8b63ff"],
			[930, 604, "#ff9736"],
			[1058, 636, "#57d66f"],
			[1168, 586, "#f34f86"],
		].map(([x, y, color]) => (
			<Flower
				key={`${x}-${y}`}
				x={x as number}
				y={y as number}
				color={color as string}
			/>
		))}
	</>
);

const Cloud = ({ x, y, scale }: { x: number; y: number; scale: number }) => (
	<div
		style={{ ...styles.cloud, left: x, top: y, transform: `scale(${scale})` }}
	>
		<div
			style={{ ...styles.cloudPuff, left: 0, top: 28, width: 112, height: 58 }}
		/>
		<div
			style={{ ...styles.cloudPuff, left: 58, top: 0, width: 96, height: 84 }}
		/>
		<div
			style={{ ...styles.cloudPuff, left: 126, top: 30, width: 96, height: 56 }}
		/>
	</div>
);

const OldOak = ({ frame }: { frame: number }) => {
	const sway = Math.sin(frame / 18) * 2.4;
	return (
		<div style={styles.oak}>
			<div style={styles.oakShadow} />
			<div style={styles.trunk} />
			<div style={{ ...styles.root, left: 42, transform: "rotate(-18deg)" }} />
			<div style={{ ...styles.root, right: 38, transform: "rotate(14deg)" }} />
			<div
				style={{
					...styles.leafMass,
					left: -92,
					top: -86,
					transform: `rotate(${sway}deg)`,
				}}
			/>
			<div
				style={{
					...styles.leafMass,
					left: 10,
					top: -138,
					transform: `rotate(${-sway}deg)`,
				}}
			/>
			<div
				style={{
					...styles.leafMass,
					left: 112,
					top: -84,
					transform: `rotate(${sway * 0.7}deg)`,
				}}
			/>
		</div>
	);
};

const RainbowPath = ({
	frame,
	portalOpen,
}: {
	frame: number;
	portalOpen: number;
}) => {
	const streak = (frame % 36) / 36;
	return (
		<div style={{ ...styles.pathWrap, opacity: 0.24 + portalOpen * 0.74 }}>
			{rainbowColors.map((color, index) => (
				<div
					key={color}
					style={{
						...styles.pathStripe,
						background: color,
						left: 526 + index * 44 - streak * 34,
						transform: `skewX(-22deg) translateY(${index * 3}px) scaleY(${0.76 + portalOpen * 0.42})`,
						opacity: 0.62 + portalOpen * 0.38,
					}}
				/>
			))}
		</div>
	);
};

const TinyDoor = ({
	frame,
	openAmount,
	magicBuild,
	revealFlash,
}: {
	frame: number;
	openAmount: number;
	magicBuild: number;
	revealFlash: number;
}) => {
	const glow =
		0.42 + Math.sin(frame / 5) * 0.08 + magicBuild * 0.52 + revealFlash * 0.7;
	const handleJiggle =
		frame > 8.4 * VIDEO_FPS && frame < 12.8 * VIDEO_FPS
			? Math.sin(frame * 1.6) * 11
			: 0;
	const doorBounce = 1 + pulse(frame, 4.2 * VIDEO_FPS, 1.4 * VIDEO_FPS) * 0.12;
	const beamOpacity = smooth(
		frame,
		11.2 * VIDEO_FPS,
		16.2 * VIDEO_FPS,
		easeInOut,
	);

	return (
		<div style={{ ...styles.doorScene, transform: `scale(${doorBounce})` }}>
			<div
				style={{
					...styles.portalRings,
					opacity: beamOpacity,
					transform: `scale(${0.78 + magicBuild * 0.55 + revealFlash * 0.2}) rotate(${frame * 1.4}deg)`,
				}}
			/>
			<div
				style={{
					...styles.doorGlow,
					opacity: glow,
					transform: `scale(${1 + glow * 0.3})`,
				}}
			/>
			{rainbowColors.map((color, index) => (
				<div
					key={color}
					style={{
						...styles.lightBeam,
						background: color,
						opacity: beamOpacity * (0.36 + revealFlash * 0.38),
						transform: `rotate(${-38 + index * 15 + Math.sin(frame / 8) * 3}deg) translateX(${70 + magicBuild * 110}px)`,
					}}
				/>
			))}
			<div style={styles.doorFrame}>
				<div
					style={{
						...styles.doorPanel,
						transform: `perspective(680px) rotateY(${-openAmount * 66}deg)`,
					}}
				>
					{rainbowColors.map((color, index) => (
						<div
							key={color}
							style={{
								...styles.doorStripe,
								background: color,
								left: `${index * 16.67}%`,
							}}
						/>
					))}
					<div
						style={{
							...styles.doorKnob,
							transform: `rotate(${handleJiggle}deg) scale(${1 + magicBuild * 0.18})`,
						}}
					/>
				</div>
			</div>
		</div>
	);
};

const Luma = ({
	frame,
	x,
	y,
	lean,
}: {
	frame: number;
	x: number;
	y: number;
	lean: number;
}) => {
	const runTilt = Math.sin(frame / 4) * (1 - lean) * 7 - lean * 12;
	const armSwing = Math.sin(frame / 3.5) * 22;
	return (
		<div
			style={{
				...styles.luma,
				left: x,
				top: y,
				transform: `rotate(${runTilt}deg) scale(${1 + lean * 0.08})`,
			}}
		>
			<div style={styles.lumaShadow} />
			<div style={styles.lumaHead} />
			<div style={styles.lumaHair} />
			<div style={styles.lumaBody} />
			<div
				style={{
					...styles.lumaArm,
					left: 12,
					transform: `rotate(${-28 + armSwing - lean * 38}deg)`,
				}}
			/>
			<div
				style={{
					...styles.lumaArm,
					right: 12,
					transform: `rotate(${26 - armSwing + lean * 28}deg)`,
				}}
			/>
			<div
				style={{
					...styles.lumaLeg,
					left: 24,
					transform: `rotate(${18 - armSwing * 0.4}deg)`,
				}}
			/>
			<div
				style={{
					...styles.lumaLeg,
					right: 24,
					transform: `rotate(${-18 + armSwing * 0.4}deg)`,
				}}
			/>
		</div>
	);
};

const StoryBeats = ({
	frame,
	fps,
	chapterText,
}: {
	frame: number;
	fps: number;
	chapterText: string;
}) => {
	const beats = [
		{ start: 0.5, end: 3.8, text: "One sunny morning..." },
		{ start: 3.8, end: 7.0, text: "Something strange appeared." },
		{ start: 7.0, end: 10.8, text: "A tiny rainbow door!" },
		{
			start: 10.8,
			end: 14.7,
			text: chapterText.includes("Hello?")
				? '"Hello? Is anyone there?"'
				: '"Hello?"',
		},
		{ start: 14.7, end: 18.8, text: "The little door began to glow." },
	];
	return (
		<>
			{beats.map((beat) => (
				<BeatText
					key={beat.text}
					frame={frame}
					start={beat.start * fps}
					end={beat.end * fps}
				>
					{beat.text}
				</BeatText>
			))}
		</>
	);
};

const BeatText = ({
	frame,
	start,
	end,
	children,
}: {
	frame: number;
	start: number;
	end: number;
	children: ReactNode;
}) => {
	const enter = smooth(frame, start, start + 12, easeOut);
	const exit = 1 - smooth(frame, end - 10, end, easeInOut);
	const active = Math.min(enter, exit);
	const y = interpolate(enter, [0, 1], [24, 0]);
	return (
		<div
			style={{
				...styles.beatText,
				opacity: active,
				transform: `translateY(${y}px) scale(${0.94 + enter * 0.06})`,
			}}
		>
			{children}
		</div>
	);
};

const WhooshWords = ({ frame, fps }: { frame: number; fps: number }) => {
	const glowPop = pulse(frame, 4.3 * fps, 1.3 * fps);
	const whoosh = pulse(frame, 16.5 * fps, 1.4 * fps);
	return (
		<>
			<ActionWord
				text="GLOW!"
				x={734}
				y={210}
				color="#ffe34a"
				progress={glowPop}
				rotate={-8}
			/>
			<ActionWord
				text="WHOOSH!"
				x={680}
				y={145}
				color="#45bbff"
				progress={whoosh}
				rotate={7}
			/>
		</>
	);
};

const ActionWord = ({
	text,
	x,
	y,
	color,
	progress,
	rotate,
}: {
	text: string;
	x: number;
	y: number;
	color: string;
	progress: number;
	rotate: number;
}) => (
	<div
		style={{
			...styles.actionWord,
			left: x,
			top: y,
			color,
			opacity: progress,
			transform: `rotate(${rotate}deg) scale(${0.72 + progress * 0.58})`,
		}}
	>
		{text}
	</div>
);

const TitleHit = ({
	frame,
	fps,
	seasonName,
}: {
	frame: number;
	fps: number;
	seasonName: string;
}) => {
	const titleIn = smooth(frame, 18.6 * fps, 19.7 * fps, easeOut);
	const subtitleIn = smooth(frame, 19.6 * fps, 20.4 * fps, easeOut);
	return (
		<div
			style={{
				...styles.titleHit,
				opacity: titleIn,
				transform: `translateY(${interpolate(titleIn, [0, 1], [58, 0])}px) scale(${0.9 + titleIn * 0.1})`,
			}}
		>
			<div style={styles.titleBadge}>Chapter 1 trailer</div>
			<div style={styles.titleText}>{seasonName}</div>
			<div
				style={{
					...styles.subtitle,
					opacity: subtitleIn,
					transform: `translateY(${interpolate(subtitleIn, [0, 1], [22, 0])}px)`,
				}}
			>
				The Tiny Door
			</div>
		</div>
	);
};

const Butterflies = ({ frame, active }: { frame: number; active: number }) => (
	<>
		{rainbowColors.slice(0, 4).map((color, index) => (
			<div
				key={color}
				style={{
					...styles.butterfly,
					left: 450 + index * 78 + Math.sin(frame / 7 + index) * 28,
					top: 270 + Math.cos(frame / 8 + index) * 42,
					background: color,
					opacity: active,
					transform: `rotate(${Math.sin(frame / 5 + index) * 26}deg) scale(${0.8 + active * 0.4})`,
				}}
			/>
		))}
	</>
);

const MagicLeaves = ({
	frame,
	magicBuild,
}: {
	frame: number;
	magicBuild: number;
}) => (
	<>
		{leafSeeds.map(([offset, phase], index) => {
			const travel = ((frame + offset) % 180) / 180;
			const x = 820 - travel * 360 + Math.sin(frame / 11 + phase) * 28;
			const y = 282 + Math.sin(travel * Math.PI) * -120 + index * 22;
			return (
				<div
					key={`${offset}-${phase}`}
					style={{
						...styles.magicLeaf,
						left: x,
						top: y,
						opacity: 0.2 + magicBuild * 0.75,
						transform: `rotate(${frame * 4 + index * 50}deg) scale(${0.72 + magicBuild * 0.48})`,
					}}
				/>
			);
		})}
	</>
);

const Sparkles = ({
	frame,
	intensity,
}: {
	frame: number;
	intensity: number;
}) => (
	<>
		{sparkleSeeds.map(([left, top, phase], index) => {
			const twinkle = Math.abs(Math.sin(frame / 7 + phase));
			return (
				<div
					key={`${left}-${top}-${phase}`}
					style={{
						...styles.sparkle,
						left: `${left}%`,
						top: `${top}%`,
						opacity: Math.min(1, (0.18 + twinkle * 0.82) * intensity),
						transform: `scale(${0.42 + twinkle * 0.72 + intensity * 0.16}) rotate(${frame * 2.1 + index * 32}deg)`,
					}}
				/>
			);
		})}
	</>
);

const Flower = ({ x, y, color }: { x: number; y: number; color: string }) => (
	<div style={{ ...styles.flower, left: x, top: y }}>
		<div style={{ ...styles.petal, left: -10, top: -8, background: color }} />
		<div style={{ ...styles.petal, left: 10, top: -8, background: color }} />
		<div style={{ ...styles.petal, left: 0, top: -22, background: color }} />
		<div style={styles.flowerCenter} />
	</div>
);

function smooth(
	frame: number,
	start: number,
	end: number,
	easing: (input: number) => number,
) {
	return interpolate(frame, [start, end], [0, 1], {
		easing,
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
}

function pulse(frame: number, center: number, width: number) {
	const distance = Math.abs(frame - center);
	return Math.max(0, 1 - distance / width);
}

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.45, 0, 0.55, 1);

const styles: Record<string, CSSProperties> = {
	stage: {
		background:
			"linear-gradient(180deg, #bff1ff 0%, #f9f4ff 48%, #d8ffd6 100%)",
		color: "#24213a",
		fontFamily:
			'Avenir Next, "Trebuchet MS", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
		overflow: "hidden",
	},
	world: {
		position: "absolute",
		inset: 0,
		transformOrigin: "56% 58%",
	},
	skyGlow: {
		position: "absolute",
		left: 472,
		top: 104,
		width: 520,
		height: 420,
		borderRadius: "50%",
		background:
			"radial-gradient(circle, rgba(255,255,255,0.9), rgba(255,227,74,0.44) 38%, rgba(139,99,255,0.18) 62%, transparent 74%)",
	},
	sun: {
		position: "absolute",
		right: 116,
		top: 58,
		width: 146,
		height: 146,
		borderRadius: "50%",
		background:
			"radial-gradient(circle, #fff9b7 0 28%, #ffe34a 30% 63%, #ff9736 65%)",
		boxShadow: "0 22px 78px rgba(255, 151, 54, 0.38)",
	},
	cloud: {
		position: "absolute",
		width: 222,
		height: 96,
	},
	cloudPuff: {
		position: "absolute",
		borderRadius: 999,
		background: "rgba(255, 255, 255, 0.9)",
		boxShadow: "0 18px 44px rgba(96, 74, 145, 0.12)",
	},
	backHill: {
		position: "absolute",
		left: -120,
		right: -120,
		bottom: 112,
		height: 270,
		borderRadius: "50% 50% 0 0",
		background:
			"linear-gradient(180deg, rgba(139,99,255,0.16), rgba(87,214,111,0.14))",
	},
	frontHill: {
		position: "absolute",
		left: -80,
		right: -80,
		bottom: -118,
		height: 318,
		borderRadius: "50% 50% 0 0",
		background: "linear-gradient(180deg, #b5f7cb, #43bd5e)",
		boxShadow: "0 -26px 70px rgba(46, 150, 64, 0.18)",
	},
	meadowFloor: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		height: 142,
		background:
			"linear-gradient(180deg, rgba(255,255,255,0), rgba(28,123,53,0.22))",
	},
	oak: {
		position: "absolute",
		left: 724,
		bottom: 130,
		width: 310,
		height: 360,
	},
	oakShadow: {
		position: "absolute",
		left: 26,
		right: 10,
		bottom: -16,
		height: 48,
		borderRadius: "50%",
		background: "rgba(58, 87, 40, 0.2)",
	},
	trunk: {
		position: "absolute",
		left: 118,
		bottom: 0,
		width: 84,
		height: 246,
		borderRadius: "44px 44px 18px 18px",
		background: "linear-gradient(90deg, #9f6837, #71421f 54%, #b47a43)",
		boxShadow: "inset 14px 0 0 rgba(255,255,255,0.1)",
	},
	root: {
		position: "absolute",
		bottom: 2,
		width: 120,
		height: 30,
		borderRadius: 999,
		background: "#815029",
	},
	leafMass: {
		position: "absolute",
		width: 184,
		height: 156,
		borderRadius: "50%",
		background:
			"radial-gradient(circle at 38% 32%, #8aea79, #4bbf5e 62%, #379c48)",
		boxShadow: "0 22px 48px rgba(47, 138, 68, 0.25)",
		transformOrigin: "50% 80%",
	},
	pathWrap: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 84,
		height: 188,
		overflow: "hidden",
	},
	pathStripe: {
		position: "absolute",
		bottom: -54,
		width: 72,
		height: 300,
		borderRadius: 38,
		boxShadow: "0 18px 46px rgba(74, 51, 120, 0.14)",
		transformOrigin: "50% 100%",
	},
	doorScene: {
		position: "absolute",
		left: 654,
		top: 318,
		width: 142,
		height: 198,
		transformOrigin: "50% 100%",
	},
	portalRings: {
		position: "absolute",
		left: -126,
		top: -138,
		width: 392,
		height: 392,
		borderRadius: "50%",
		background:
			"conic-gradient(from 90deg, rgba(243,79,134,0.62), rgba(255,227,74,0.62), rgba(87,214,111,0.62), rgba(69,187,255,0.62), rgba(139,99,255,0.62), rgba(243,79,134,0.62))",
		filter: "blur(1px)",
	},
	doorGlow: {
		position: "absolute",
		left: -72,
		top: -96,
		width: 290,
		height: 330,
		borderRadius: "50% 50% 34% 34%",
		background:
			"radial-gradient(circle, rgba(255,255,255,0.98), rgba(255,227,74,0.72) 34%, rgba(243,79,134,0.36) 56%, transparent 76%)",
	},
	lightBeam: {
		position: "absolute",
		left: 66,
		top: 84,
		width: 230,
		height: 26,
		borderRadius: 999,
		transformOrigin: "0 50%",
		mixBlendMode: "screen",
		filter: "blur(0.4px)",
	},
	doorFrame: {
		position: "absolute",
		inset: 0,
		borderRadius: "52% 52% 18px 18px / 25% 25% 18px 18px",
		background: "#fff8d0",
		padding: 8,
		boxShadow: "0 18px 42px rgba(64, 42, 93, 0.28)",
	},
	doorPanel: {
		position: "absolute",
		inset: 8,
		borderRadius: "52% 52% 14px 14px / 24% 24% 14px 14px",
		overflow: "hidden",
		transformOrigin: "left center",
		border: "4px solid rgba(255,255,255,0.92)",
		boxShadow: "inset 0 -18px 0 rgba(80,54,120,0.12)",
	},
	doorStripe: {
		position: "absolute",
		top: 0,
		bottom: 0,
		width: "17%",
	},
	doorKnob: {
		position: "absolute",
		right: 18,
		top: "52%",
		width: 22,
		height: 22,
		borderRadius: "50%",
		background: "#ffe34a",
		border: "4px solid #fff9b7",
		boxShadow: "0 0 24px rgba(255, 227, 74, 0.95)",
		transformOrigin: "50% 50%",
	},
	luma: {
		position: "absolute",
		width: 104,
		height: 158,
		transformOrigin: "50% 92%",
	},
	lumaShadow: {
		position: "absolute",
		left: 8,
		right: 8,
		bottom: -10,
		height: 24,
		borderRadius: "50%",
		background: "rgba(74, 51, 120, 0.16)",
	},
	lumaHead: {
		position: "absolute",
		left: 30,
		top: 0,
		width: 46,
		height: 46,
		borderRadius: "50%",
		background: "#ffd6a8",
		border: "4px solid rgba(255,255,255,0.9)",
		zIndex: 2,
	},
	lumaHair: {
		position: "absolute",
		left: 25,
		top: -4,
		width: 58,
		height: 31,
		borderRadius: "50% 50% 24% 24%",
		background: "#5b392a",
		zIndex: 3,
	},
	lumaBody: {
		position: "absolute",
		left: 18,
		top: 48,
		width: 70,
		height: 82,
		borderRadius: "28px 28px 19px 19px",
		background: "linear-gradient(180deg, #ff78c8, #7466ff)",
		boxShadow: "0 13px 28px rgba(74, 51, 120, 0.22)",
		zIndex: 1,
	},
	lumaArm: {
		position: "absolute",
		top: 58,
		width: 18,
		height: 62,
		borderRadius: 999,
		background: "#ffd6a8",
		transformOrigin: "top center",
		zIndex: 0,
	},
	lumaLeg: {
		position: "absolute",
		top: 118,
		width: 20,
		height: 48,
		borderRadius: 999,
		background: "#33305c",
		transformOrigin: "top center",
	},
	beatText: {
		position: "absolute",
		left: 58,
		bottom: 54,
		maxWidth: 640,
		padding: "18px 28px",
		borderRadius: 26,
		background: "rgba(255, 255, 255, 0.9)",
		border: "4px solid rgba(255, 227, 74, 0.9)",
		boxShadow: "0 22px 62px rgba(55, 36, 96, 0.18)",
		fontSize: 42,
		lineHeight: 1.06,
		fontWeight: 950,
		letterSpacing: 0,
	},
	actionWord: {
		position: "absolute",
		fontSize: 58,
		lineHeight: 1,
		fontWeight: 1000,
		letterSpacing: 0,
		WebkitTextStroke: "8px white",
		textShadow: "0 14px 26px rgba(70, 42, 112, 0.18)",
		transformOrigin: "50% 50%",
	},
	titleHit: {
		position: "absolute",
		left: 0,
		right: 0,
		top: 74,
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		textAlign: "center",
		pointerEvents: "none",
	},
	titleBadge: {
		padding: "10px 20px",
		borderRadius: 999,
		background: "#24213a",
		color: "#ffe34a",
		fontSize: 22,
		fontWeight: 950,
		textTransform: "uppercase",
		letterSpacing: 0,
	},
	titleText: {
		marginTop: 16,
		color: "#ffffff",
		fontSize: 94,
		lineHeight: 0.95,
		fontWeight: 1000,
		letterSpacing: 0,
		WebkitTextStroke: "7px #24213a",
		textShadow: "0 24px 50px rgba(36, 33, 58, 0.22)",
	},
	subtitle: {
		marginTop: 8,
		color: "#24213a",
		fontSize: 46,
		lineHeight: 1,
		fontWeight: 950,
		padding: "12px 24px",
		borderRadius: 24,
		background: "rgba(255,255,255,0.88)",
		border: "4px solid #45bbff",
	},
	flash: {
		position: "absolute",
		inset: 0,
		background: "white",
		pointerEvents: "none",
		mixBlendMode: "screen",
	},
	butterfly: {
		position: "absolute",
		width: 34,
		height: 24,
		borderRadius: "50% 50% 50% 50%",
		boxShadow: "18px 0 0 rgba(255,255,255,0.68), 9px 9px 0 rgba(36,33,58,0.18)",
	},
	magicLeaf: {
		position: "absolute",
		width: 32,
		height: 18,
		borderRadius: "80% 0 80% 0",
		background: "#57d66f",
		boxShadow: "inset 8px 0 0 rgba(255,255,255,0.2)",
	},
	sparkle: {
		position: "absolute",
		width: 26,
		height: 26,
		background: "#fff7a8",
		clipPath:
			"polygon(50% 0, 61% 36%, 100% 50%, 61% 64%, 50% 100%, 39% 64%, 0 50%, 39% 36%)",
		filter: "drop-shadow(0 0 12px rgba(255, 227, 74, 0.85))",
	},
	flower: {
		position: "absolute",
		width: 34,
		height: 46,
	},
	petal: {
		position: "absolute",
		width: 22,
		height: 22,
		borderRadius: "50%",
	},
	flowerCenter: {
		position: "absolute",
		left: 4,
		top: -7,
		width: 14,
		height: 14,
		borderRadius: "50%",
		background: "#ffe34a",
	},
};
