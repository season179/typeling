import { Composition } from "remotion";
import { PixelFirstChapter } from "./PixelFirstChapter";
import season from "../seasons/rainbow-door-s1.json";
import {
	RainbowDoorVideo,
	type RainbowDoorVideoProps,
	VIDEO_DURATION_IN_FRAMES,
	VIDEO_FPS,
	VIDEO_HEIGHT,
	VIDEO_WIDTH,
} from "./RainbowDoorVideo";

export const RemotionRoot = () => {
	return (
		<>
			<Composition
				id="RainbowDoor"
				component={RainbowDoorVideo}
				durationInFrames={VIDEO_DURATION_IN_FRAMES}
				fps={VIDEO_FPS}
				width={VIDEO_WIDTH}
				height={VIDEO_HEIGHT}
				defaultProps={
					{
						season,
					} satisfies RainbowDoorVideoProps
				}
			/>
			<Composition
				id="PixelFirstChapter"
				component={PixelFirstChapter}
				durationInFrames={1350}
				fps={30}
				width={1920}
				height={1080}
			/>
		</>
	);
};
