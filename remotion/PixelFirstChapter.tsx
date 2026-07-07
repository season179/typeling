import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  staticFile,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import pixelSeason from "../seasons/pixel-garden-s1.json";

const storyText = pixelSeason.episodes[0]?.text ?? "";
const FPS = 30;
const DURATION = 45 * FPS;

const COLORS = {
  navy: "#123f73",
  blue: "#37a9ff",
  blueDark: "#1370be",
  cyan: "#8ff3ff",
  cream: "#fff3c4",
  wood: "#9d633f",
  woodDark: "#684026",
  pink: "#ff87cf",
  orange: "#ffaf59",
  yellow: "#ffe16d",
  green: "#6fe08f",
  purple: "#a88cff",
  silver: "#d9efff",
};

const lines = [
  "In a cosy workshop filled with soft light, there lived a small blue robot named Pixel.",
  "Pixel's round eyes glowed a gentle blue. Each morning, Pixel woke with a happy little beep.",
  "The workshop was warm and tidy, with jars, tools, and colourful wires on every shelf.",
  "A kind old lamp gave the room a golden glow. Pixel loved this place. It was home.",
  "One morning, Pixel stretched their little arms and looked out of the window.",
  "The sky was pink and orange. Birds sang in the trees.",
  "\u201cWhat a lovely day,\u201d said Pixel in a soft, buzzy voice.",
];

const scenes = [
  { from: 0, label: "Cosy workshop" },
  { from: 150, label: "Pixel wakes up" },
  { from: 330, label: "A busy little workshop" },
  { from: 520, label: "Golden lamp glow" },
  { from: 700, label: "Stretch and explore" },
  { from: 900, label: "Morning outside" },
  { from: 1120, label: "A lovely day" },
];

const ease = {
  easing: Easing.bezier(0.16, 1, 0.3, 1),
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const progress = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], ease);

const map = (frame: number, input: [number, number], output: [number, number]) =>
  interpolate(frame, input, output, clamp);

const activeIndex = (frame: number) => {
  let index = 0;
  for (let i = 0; i < scenes.length; i++) {
    if (frame >= scenes[i]!.from) index = i;
  }
  return index;
};

const Star = ({ x, y, delay, color }: { x: number; y: number; delay: number; color: string }) => {
  const frame = useCurrentFrame();
  const local = (frame + delay) % 70;
  const scale = interpolate(local, [0, 18, 70], [0.55, 1.35, 0.55], clamp);
  const opacity = interpolate(local, [0, 18, 45, 70], [0.2, 1, 0.75, 0.2], clamp);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 36,
        height: 36,
        opacity,
        transform: `scale(${scale}) rotate(45deg)`,
        background: color,
        clipPath:
          "polygon(50% 0%, 61% 36%, 100% 50%, 61% 64%, 50% 100%, 39% 64%, 0% 50%, 39% 36%)",
        filter: `drop-shadow(0 0 18px ${color})`,
      }}
    />
  );
};

const SparkleBurst = ({ at, x, y }: { at: number; x: number; y: number }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, at + 34);
  const fade = 1 - progress(frame, at + 26, at + 58);
  const colors = [COLORS.cyan, COLORS.yellow, COLORS.pink, COLORS.green, COLORS.purple];
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: fade }}>
      {colors.map((color, i) => {
        const angle = (Math.PI * 2 * i) / colors.length;
        const dist = p * 170;
        return (
          <div
            key={color}
            style={{
              position: "absolute",
              width: 24,
              height: 24,
              borderRadius: 999,
              background: color,
              left: Math.cos(angle) * dist,
              top: Math.sin(angle) * dist,
              transform: `scale(${1 - p * 0.45})`,
              boxShadow: `0 0 26px ${color}`,
            }}
          />
        );
      })}
    </div>
  );
};

const WorkshopBackdrop = () => {
  const frame = useCurrentFrame();
  const pan = map(frame, [0, DURATION], [0, -100]);
  const warm = map(frame, [460, 650], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(180deg, #b9efff 0%, #fff0be 52%, #ffd3a3 100%)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 18% 18%, rgba(255, 225, 109, ${0.35 + warm * 0.18}) 0, transparent 29%), radial-gradient(circle at 78% 25%, rgba(143, 243, 255, 0.42) 0, transparent 26%)`,
        }}
      />
      <div style={{ transform: `translateX(${pan}px)`, position: "absolute", inset: 0 }}>
        <Lamp />
        <Window />
        <Shelf left={580} top={146} scale={0.95} />
        <Shelf left={1170} top={128} scale={1.15} />
        <Shelf left={1320} top={420} scale={0.78} />
        <Workbench />
        <Wires />
      </div>
      <Star x={310} y={190} delay={0} color={COLORS.cyan} />
      <Star x={1530} y={154} delay={18} color={COLORS.yellow} />
      <Star x={1660} y={520} delay={34} color={COLORS.pink} />
      <Star x={390} y={560} delay={44} color={COLORS.green} />
    </AbsoluteFill>
  );
};

const Lamp = () => {
  const frame = useCurrentFrame();
  const pop = progress(frame, 500, 545);
  const glow = 0.72 + Math.sin(frame / 18) * 0.11 + pop * 0.24;
  return (
    <div style={{ position: "absolute", left: 170, top: 84 }}>
      <div
        style={{
          position: "absolute",
          left: -110,
          top: 0,
          width: 390,
          height: 390,
          borderRadius: "50%",
          background: `rgba(255, 225, 109, ${0.38 * glow})`,
          filter: "blur(24px)",
        }}
      />
      <div style={{ position: "absolute", left: 66, top: 118, width: 28, height: 132, borderRadius: 20, background: COLORS.woodDark }} />
      <div style={{ position: "absolute", left: 8, top: 232, width: 162, height: 35, borderRadius: 24, background: COLORS.woodDark }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 174,
          height: 112,
          borderRadius: "86px 86px 32px 32px",
          background: "linear-gradient(180deg, #fff7a8, #ffc942)",
          boxShadow: "0 0 52px #ffe16d",
          transform: `scale(${1 + pop * 0.08})`,
        }}
      />
    </div>
  );
};

const Window = () => {
  const frame = useCurrentFrame();
  const sun = map(frame, [860, 1190], [0, 1]);
  const bob = Math.sin(frame / 15) * 10;
  return (
    <div
      style={{
        position: "absolute",
        left: 1260,
        top: 78,
        width: 520,
        height: 330,
        borderRadius: 42,
        border: "18px solid white",
        overflow: "hidden",
        boxShadow: "0 22px 50px rgba(26, 91, 135, 0.22)",
        background: "linear-gradient(180deg, #ffb8d8 0%, #ffd398 54%, #9be7ff 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 40 + sun * 115,
          top: 66 - sun * 28,
          width: 150,
          height: 150,
          borderRadius: "50%",
          background: "#fff06d",
          boxShadow: "0 0 70px #fff06d",
        }}
      />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 225 + i * 62 + Math.sin(frame / 28 + i) * 18,
            top: 105 + bob + i * 12,
            fontSize: 44,
            color: COLORS.navy,
            transform: `rotate(${i % 2 ? 11 : -9}deg)`,
          }}
        >
          ♪
        </div>
      ))}
      <div style={{ position: "absolute", bottom: 0, width: "100%", height: 86, background: "linear-gradient(180deg, #78df91, #37b867)" }} />
    </div>
  );
};

const Shelf = ({ left, top, scale }: { left: number; top: number; scale: number }) => {
  const frame = useCurrentFrame();
  const colors = [COLORS.pink, COLORS.green, COLORS.purple, COLORS.orange, COLORS.yellow, COLORS.cyan];
  return (
    <div style={{ position: "absolute", left, top, transform: `scale(${scale})` }}>
      <div style={{ position: "absolute", top: 120, width: 425, height: 28, borderRadius: 20, background: COLORS.wood, boxShadow: "0 12px 0 rgba(104, 64, 38, 0.15)" }} />
      {colors.slice(0, 5).map((color, i) => {
        const liquid = 46 + ((i * 17) % 35) + Math.sin(frame / 18 + i) * 4;
        return (
          <div key={color} style={{ position: "absolute", left: 26 + i * 77, top: 18 + (i % 2) * 18, width: 52, height: 98, borderRadius: "16px 16px 12px 12px", background: "rgba(255,255,255,0.62)", border: "5px solid rgba(255,255,255,0.9)", overflow: "hidden" }}>
            <div style={{ position: "absolute", bottom: 0, width: "100%", height: `${liquid}%`, background: color, boxShadow: `0 0 22px ${color}` }} />
          </div>
        );
      })}
    </div>
  );
};

const Workbench = () => (
  <div
    style={{
      position: "absolute",
      left: -140,
      bottom: 0,
      width: 2300,
      height: 250,
      background: `linear-gradient(180deg, ${COLORS.wood}, ${COLORS.woodDark})`,
      boxShadow: "0 -28px 60px rgba(90, 54, 31, 0.18)",
    }}
  />
);

const Wires = () => {
  const frame = useCurrentFrame();
  const colors = [COLORS.pink, COLORS.yellow, COLORS.green, COLORS.purple, COLORS.cyan];
  return (
    <>
      {colors.map((color, i) => {
        const fly = progress(frame, 300 + i * 24, 390 + i * 24);
        const wiggle = Math.sin(frame / (13 + i) + i) * 22;
        return (
          <div
            key={color}
            style={{
              position: "absolute",
              left: 930 + i * 130 + fly * 100,
              top: 665 + wiggle + (i % 2) * 38,
              width: 180,
              height: 20,
              borderRadius: 999,
              background: color,
              transform: `rotate(${-16 + i * 9 + fly * 20}deg) scaleX(${0.75 + fly * 0.35})`,
              boxShadow: `0 0 22px ${color}`,
            }}
          />
        );
      })}
    </>
  );
};

const PixelRobot = () => {
  const frame = useCurrentFrame();
  const scene = activeIndex(frame);
  const wake = progress(frame, 135, 190);
  const walk = progress(frame, 690, 850);
  const windowLook = progress(frame, 850, 960);
  const exit = progress(frame, 1240, 1340);
  const bob = Math.sin(frame / 10) * (8 + wake * 7);
  const x = 145 + walk * 760 + windowLook * 150 - exit * 60;
  const scale = 0.96 + wake * 0.12 + scene * 0.005;
  const bodyTilt = Math.sin(frame / 16) * 2 + wake * Math.sin(frame / 7) * 3;
  const armLeft = -24 - Math.sin(frame / 8) * 18 - walk * 18;
  const armRight = 24 + Math.sin(frame / 8) * 18 + walk * 15;
  const eyeGlow = 0.55 + wake * 0.35 + Math.sin(frame / 7) * 0.12;
  const mouthOpen = frame % 34 < 12 && frame > 1180 ? 1 : 0;

  return (
    <div style={{ position: "absolute", left: x, top: 395 + bob - windowLook * 38, width: 430, height: 480, transform: `scale(${scale}) rotate(${bodyTilt}deg)`, transformOrigin: "center bottom", filter: "drop-shadow(0 26px 24px rgba(35, 73, 99, 0.2))" }}>
      <div style={{ position: "absolute", left: 114, top: 0, width: 205, height: 166, borderRadius: "48px 48px 58px 58px", background: `linear-gradient(180deg, ${COLORS.blue}, #2d95e2)`, border: `10px solid ${COLORS.blueDark}` }}>
        <div style={{ position: "absolute", left: 40, top: 54, width: 46, height: 46, borderRadius: "50%", background: COLORS.cyan, boxShadow: `0 0 ${42 * eyeGlow}px ${COLORS.cyan}` }} />
        <div style={{ position: "absolute", right: 40, top: 54, width: 46, height: 46, borderRadius: "50%", background: COLORS.cyan, boxShadow: `0 0 ${42 * eyeGlow}px ${COLORS.cyan}` }} />
        <div style={{ position: "absolute", left: 76, top: 120, width: 58, height: 12 + mouthOpen * 16, borderRadius: 12, background: COLORS.navy }} />
        <div style={{ position: "absolute", left: 90, top: -36, width: 26, height: 42, borderRadius: 20, background: COLORS.blueDark }} />
        <div style={{ position: "absolute", left: 76, top: -66, width: 54, height: 54, borderRadius: "50%", background: COLORS.yellow, boxShadow: "0 0 28px #ffe16d" }} />
      </div>
      <div style={{ position: "absolute", left: 134, top: 164, width: 166, height: 210, borderRadius: "40px 40px 56px 56px", background: "linear-gradient(180deg, #74caff, #2e9ee8)", border: `10px solid ${COLORS.blueDark}` }}>
        <div style={{ position: "absolute", left: 42, top: 50, width: 82, height: 82, borderRadius: "50%", background: "#e1f8ff", border: `7px solid ${COLORS.blueDark}` }}>
          <div style={{ position: "absolute", left: 24, top: 24, width: 22, height: 22, borderRadius: "50%", background: COLORS.yellow, boxShadow: "0 0 18px #ffe16d" }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 54, top: 196, width: 105, height: 34, borderRadius: 20, background: COLORS.blueDark, transform: `rotate(${armLeft}deg)`, transformOrigin: "right center" }} />
      <div style={{ position: "absolute", right: 50, top: 196, width: 105, height: 34, borderRadius: 20, background: COLORS.blueDark, transform: `rotate(${armRight}deg)`, transformOrigin: "left center" }} />
      <div style={{ position: "absolute", left: 158, top: 366, width: 42, height: 82, borderRadius: 20, background: COLORS.blueDark, transform: `rotate(${walk ? Math.sin(frame / 5) * 10 : 0}deg)` }} />
      <div style={{ position: "absolute", right: 154, top: 366, width: 42, height: 82, borderRadius: 20, background: COLORS.blueDark, transform: `rotate(${walk ? -Math.sin(frame / 5) * 10 : 0}deg)` }} />
    </div>
  );
};

const KineticCaption = () => {
  const frame = useCurrentFrame();
  const idx = activeIndex(frame);
  const current = lines[idx] ?? lines[0] ?? "";
  const from = scenes[idx]?.from ?? 0;
  const chars = Math.floor(map(frame, [from + 6, from + 88], [0, current.length]));
  const enter = progress(frame, from, from + 25);
  const label = scenes[idx]?.label ?? "Pixel";

  return (
    <div style={{ position: "absolute", left: 82, bottom: 52, width: 1760, minHeight: 150, opacity: enter, transform: `translateY(${(1 - enter) * 44}px)`, fontFamily: "Arial Rounded MT Bold, Avenir Next, sans-serif" }}>
      <div style={{ display: "inline-block", padding: "9px 18px", borderRadius: 999, background: "rgba(18, 63, 115, 0.86)", color: "white", fontSize: 26, letterSpacing: 1.3, textTransform: "uppercase", marginBottom: 14 }}>
        {label}
      </div>
      <div style={{ maxWidth: 1300, padding: "24px 34px", borderRadius: 38, background: "rgba(255,255,255,0.82)", border: "6px solid rgba(255,255,255,0.92)", color: COLORS.navy, fontSize: 43, lineHeight: 1.15, boxShadow: "0 22px 50px rgba(18,63,115,0.16)" }}>
        {current.slice(0, chars)}
        <span style={{ color: COLORS.blue }}>{chars < current.length ? "▌" : ""}</span>
      </div>
    </div>
  );
};

const BeepWord = () => {
  const frame = useCurrentFrame();
  const pop = interpolate(frame, [154, 174, 220, 242], [0, 1, 1, 0], {
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ position: "absolute", left: 540, top: 300, transform: `scale(${pop}) rotate(-8deg)`, opacity: pop, padding: "24px 44px", borderRadius: 44, background: "white", border: `9px solid ${COLORS.blueDark}`, color: COLORS.blueDark, fontFamily: "Arial Rounded MT Bold, Avenir Next, sans-serif", fontSize: 74, boxShadow: "0 18px 0 rgba(19,112,190,0.18)" }}>
      BEEP!
    </div>
  );
};

const Sunbeam = () => {
  const frame = useCurrentFrame();
  const p = progress(frame, 860, 1015);
  return (
    <div style={{ position: "absolute", right: -160, top: 110, width: 760, height: 760, borderRadius: "50%", background: `rgba(255, 242, 120, ${0.26 * p})`, filter: "blur(12px)", transform: `scale(${0.5 + p})` }} />
  );
};

const AudioBed = () => (
  <>
    <Audio src={staticFile("audio/pixel-music.wav")} volume={0.38} />
    <Sequence from={140}>
      <Audio src={staticFile("audio/pixel-beep.wav")} volume={0.8} />
    </Sequence>
    <Sequence from={308}>
      <Audio src={staticFile("audio/pixel-whoosh.wav")} volume={0.35} />
    </Sequence>
    <Sequence from={505}>
      <Audio src={staticFile("audio/pixel-click.wav")} volume={0.5} />
    </Sequence>
    <Sequence from={870}>
      <Audio src={staticFile("audio/pixel-birds.wav")} volume={0.58} />
    </Sequence>
    <Sequence from={1165}>
      <Audio src={staticFile("audio/pixel-sparkle.wav")} volume={0.56} />
    </Sequence>
  </>
);

export const PixelFirstChapter = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const titleIn = progress(frame, 0, 40);
  const titleOut = progress(frame, 96, 140);
  const finalGlow = progress(frame, 1160, durationInFrames - 10);

  return (
    <AbsoluteFill>
      <AudioBed />
      <WorkshopBackdrop />
      <Sunbeam />
      <PixelRobot />
      <BeepWord />
      <SparkleBurst at={314} x={1050} y={650} />
      <SparkleBurst at={1168} x={1020} y={350} />
      <KineticCaption />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(circle at 50% 42%, rgba(143,243,255,${0.2 * finalGlow}), transparent 32%)` }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: titleIn - titleOut, transform: `scale(${0.86 + titleIn * 0.18 - titleOut * 0.08})`, fontFamily: "Arial Rounded MT Bold, Avenir Next, sans-serif" }}>
        <div style={{ padding: "52px 78px", borderRadius: 72, background: "rgba(255,255,255,0.9)", border: "10px solid white", color: COLORS.navy, textAlign: "center", boxShadow: "0 34px 90px rgba(18,63,115,0.24)" }}>
          <div style={{ fontSize: 48, color: "#5e7892", marginBottom: 12 }}>Pixel's Science Garden</div>
          <div style={{ fontSize: 118 }}>Pixel Wakes Up</div>
          <div style={{ fontSize: 40, color: "#5e7892", marginTop: 18 }}>Chapter 1 · a tiny animated short</div>
        </div>
      </div>
      <div style={{ position: "absolute", right: 50, top: 36, padding: "12px 20px", borderRadius: 999, color: "rgba(18,63,115,0.55)", background: "rgba(255,255,255,0.35)", fontFamily: "Arial Rounded MT Bold, Avenir Next, sans-serif", fontSize: 22 }}>
        {storyText ? "first chapter only" : "Pixel"}
      </div>
    </AbsoluteFill>
  );
};
