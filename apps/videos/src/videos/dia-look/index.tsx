import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { color, font, loadFonts } from "../../lib/ac-launch/theme";

loadFonts();

type Source = "before" | "after" | "dia";

interface Still {
  source: Source;
  file: string;
  x: number;
  y: number;
}

interface State {
  label: string;
  left: Still;
  right: Still;
}

interface Scene {
  title: string;
  body: string;
  layout: "side" | "stack";
  w: number;
  h: number;
  states: State[];
}

const FPS = 30;
const INTRO = Math.round(3 * FPS);
const OUTRO = Math.round(3.2 * FPS);
const STATE = Math.round(1.9 * FPS);
const LEAD = Math.round(0.4 * FPS);
const TAIL = Math.round(0.6 * FPS);
const FADE = 12;
const SCENE_FADE = 10;
const SIDE_BOX = { w: 860, h: 640 };
const STACK_BOX = { w: 1520, h: 300 };
const SIDE_TOP = 330;
const STACK_TOP = 300;
const STACK_GAP = 64;
const LEFT = 60;
const RIGHT = 1000;
const STACK_LEFT = 340;
const PANEL_RADIUS = 18;
const SIZES: Record<Source, [number, number]> = { before: [1360, 860], after: [1360, 860], dia: [1512, 949] };
const VERSIONS: Record<Source, string> = { before: "0.2.43-nightly.5", after: "main · 17b469a", dia: "Dia 1.55.1" };

const pair = (label: string, file: string, x: number, y: number): State => ({
  label,
  left: { source: "before", file, x, y },
  right: { source: "after", file, x, y },
});

const nextToDia = (label: string, dia: string, dx: number, dy: number, file: string, x: number, y: number): State => ({
  label,
  left: { source: "dia", file: dia, x: dx, y: dy },
  right: { source: "after", file, x, y },
});

const SCENES: Scene[] = [
  {
    title: "Pinned tiles",
    body: "A faint flat fill and a one-pixel hairline, Dia's own tokens. No bright glass rim, no dark fringe outside the edge.",
    layout: "side",
    w: 196,
    h: 60,
    states: [
      pair("Dark · rest", "01-sidebar-rest", 0, 46),
      pair("Dark · pointer on a tile", "02-pinned-hover", 0, 46),
      pair("Dark · YouTube selected", "02-pinned-selected", 0, 46),
      pair("Light · rest", "01-sidebar-rest-light", 0, 46),
      pair("Light · pointer on a tile", "02-pinned-hover-light", 0, 46),
    ],
  },
  {
    title: "Tab hover card",
    body: "Point at a tab: the card and its Pin, Bookmark and Split buttons are flat, with no tinted glass behind them.",
    layout: "side",
    w: 320,
    h: 190,
    states: [pair("Dark · pointer on a tab", "04-hovercard-open", 170, 170), pair("Light · pointer on a tab", "04-hovercard-open-light", 170, 170)],
  },
  {
    title: "Downloads",
    body: "The Downloads popover is a flat panel over the sidebar.",
    layout: "side",
    w: 340,
    h: 160,
    states: [pair("Dark", "06-downloads-open", 0, 38), pair("Light", "06-downloads-open-light", 0, 38)],
  },
  {
    title: "Site controls",
    body: "The site info popover and its buttons drop the glass too.",
    layout: "side",
    w: 320,
    h: 320,
    states: [pair("Dark", "06-siteinfo-open", 1040, 40), pair("Light", "06-siteinfo-open-light", 1040, 40)],
  },
  {
    title: "Sidebar address field",
    body: "With the address in the sidebar, the field is a flat fill that brightens under the pointer, like the tiles below it.",
    layout: "side",
    w: 196,
    h: 100,
    states: [
      pair("Dark · rest", "03-address-sidebar-rest", 0, 33),
      pair("Dark · pointer on the field", "03-address-sidebar-hover", 0, 33),
      pair("Light · rest", "03-address-sidebar-rest-light", 0, 33),
      pair("Light · pointer on the field", "03-address-sidebar-hover-light", 0, 33),
    ],
  },
  {
    title: "Next to Dia: pinned tiles",
    body: "Dia on the left, Ardia now on the right. Same fill, same hairline, same radius.",
    layout: "side",
    w: 196,
    h: 60,
    states: [
      nextToDia("Dark · rest", "02-pinned-rest-dia", 0, 46, "01-sidebar-rest", 0, 46),
      nextToDia("Light · rest", "01-sidebar-rest-light-dia", 0, 46, "01-sidebar-rest-light", 0, 46),
    ],
  },
  {
    title: "Next to Dia: New Tab",
    body: "Dia's field on the left, Ardia's on the right. Dia's says “Ask anything” because it has AI; Ardia doesn't.",
    layout: "stack",
    w: 700,
    h: 200,
    states: [
      nextToDia("Dark", "07-newtab-rest-dia", 496, 305, "07-newtab-rest", 420, 262),
      nextToDia("Light", "07-newtab-rest-light-dia", 496, 305, "07-newtab-rest-light", 420, 262),
    ],
  },
];

const sceneLength = (scene: Scene) => LEAD + scene.states.length * STATE + TAIL;
const starts = SCENES.map((_, i) => INTRO + SCENES.slice(0, i).reduce((sum, s) => sum + sceneLength(s), 0));
const total = INTRO + SCENES.reduce((sum, s) => sum + sceneLength(s), 0) + OUTRO;

export const meta = { width: 1920, height: 1080, fps: FPS, durationInFrames: total };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const label: CSSProperties = {
  fontFamily: font.mono,
  fontWeight: 460,
  fontStretch: "87.5%",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontSize: 20,
  color: color.ink2,
};

function boxFor(scene: Scene) {
  const max = scene.layout === "stack" ? STACK_BOX : SIDE_BOX;
  const k = Math.min(max.w / scene.w, max.h / scene.h);
  return { w: Math.round(scene.w * k), h: Math.round(scene.h * k), k };
}

type Place = { left: number; top: number; w: number; h: number };

function placements(scene: Scene): [Place, Place] {
  const { w, h } = boxFor(scene);
  if (scene.layout === "stack") {
    const top = STACK_TOP + (2 * STACK_BOX.h + STACK_GAP - (2 * h + STACK_GAP)) / 2;
    const left = STACK_LEFT + (STACK_BOX.w - w) / 2;
    return [
      { left, top, w, h },
      { left, top: top + h + STACK_GAP, w, h },
    ];
  }
  const top = SIDE_TOP + (SIDE_BOX.h - h) / 2;
  return [
    { left: LEFT + (SIDE_BOX.w - w) / 2, top, w, h },
    { left: RIGHT + (SIDE_BOX.w - w) / 2, top, w, h },
  ];
}

function SideLabel({ source, style }: { source: Source; style: CSSProperties }) {
  const after = source === "after";
  const dia = source === "dia";
  return (
    <div style={{ position: "absolute", display: "flex", flexDirection: "column", gap: 10, ...style }}>
      <div
        style={{
          ...label,
          alignSelf: "flex-start",
          fontSize: 34,
          fontWeight: 700,
          color: after ? color.paper : dia ? color.paper : color.ink,
          background: after ? color.blue : dia ? color.ink : "transparent",
          boxShadow: after || dia ? "none" : `inset 0 0 0 3px ${color.ink}`,
          padding: "9px 18px 8px",
          borderRadius: 10,
          lineHeight: 1,
        }}
      >
        {after ? "After" : dia ? "Dia" : "Before"}
      </div>
      <div style={{ ...label, fontSize: 18 }}>{VERSIONS[source]}</div>
    </div>
  );
}

function Panel({ scene, place, pick, frame }: { scene: Scene; place: Place; pick: (s: State) => Still; frame: number }) {
  const { k } = boxFor(scene);
  const current = Math.min(scene.states.length - 1, Math.max(0, Math.floor((frame - LEAD) / STATE)));
  return (
    <div
      style={{
        position: "absolute",
        left: place.left,
        top: place.top,
        width: place.w,
        height: place.h,
        overflow: "hidden",
        borderRadius: PANEL_RADIUS,
        background: color.paperDeep,
        boxShadow: "0 30px 70px rgba(22,19,15,0.16), 0 0 0 1px rgba(22,19,15,0.10)",
      }}
    >
      {scene.states.map((state, index) => {
        if (index > current) return null;
        const still = pick(state);
        const [sw, sh] = SIZES[still.source];
        const start = LEAD + index * STATE;
        const opacity = index === 0 ? 1 : interpolate(frame, [start, start + FADE], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
        return (
          <Img
            key={state.label}
            src={staticFile(`footage/dia-look/${still.source}/${still.file}.png`)}
            style={{ position: "absolute", left: -still.x * k, top: -still.y * k, width: sw * k, height: sh * k, maxWidth: "none", opacity }}
          />
        );
      })}
    </div>
  );
}

const number = (i: number) => `${String(i + 1).padStart(2, "0")} / ${String(SCENES.length).padStart(2, "0")}`;

function SceneView({ scene, index }: { scene: Scene; index: number }) {
  const frame = useCurrentFrame();
  const length = sceneLength(scene);
  const shown = interpolate(frame, [0, SCENE_FADE, length - SCENE_FADE, length], [0, 1, 1, 0], clamp);
  const current = Math.min(scene.states.length - 1, Math.max(0, Math.floor((frame - LEAD) / STATE)));
  const stateStart = LEAD + current * STATE;
  const labelIn = current === 0 ? 1 : interpolate(frame, [stateStart, stateStart + FADE], [0, 1], clamp);
  const [left, right] = placements(scene);
  const leftSource = scene.states[0]!.left.source;
  const stack = scene.layout === "stack";
  const labelStyle = (place: Place): CSSProperties => (stack ? { left: LEFT, top: place.top + 4 } : { left: place.left, top: place.top - 92 });
  return (
    <AbsoluteFill style={{ opacity: shown }}>
      <div style={{ position: "absolute", left: LEFT, top: 40, right: 60, display: "flex", justifyContent: "space-between" }}>
        <div style={{ ...label, color: color.ink }}>Ardia · Dia's flat look · before and after</div>
        <div style={{ ...label, color: color.blue }}>{number(index)}</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: LEFT,
          top: 84,
          width: 860,
          fontFamily: font.poster,
          fontWeight: 850,
          fontStretch: "75%",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          fontSize: 64,
          lineHeight: 0.98,
          color: color.ink,
        }}
      >
        {scene.title}
      </div>
      <div style={{ position: "absolute", left: RIGHT, top: 88, width: 860, fontFamily: font.serif, fontSize: 30, lineHeight: 1.28, color: color.ink }}>{scene.body}</div>
      <SideLabel source={leftSource} style={labelStyle(left)} />
      <SideLabel source="after" style={labelStyle(right)} />
      <Panel scene={scene} place={left} pick={(s) => s.left} frame={frame} />
      <Panel scene={scene} place={right} pick={(s) => s.right} frame={frame} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 1000, display: "flex", justifyContent: "center", opacity: labelIn }}>
        <div style={{ ...label, fontSize: 26, fontWeight: 620, color: color.paper, background: color.ink, padding: "10px 18px 9px", borderRadius: 10 }}>
          {scene.states[current]!.label}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Intro() {
  const frame = useCurrentFrame();
  const rise = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 24], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [delay, delay + 33], [28, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
  });
  const out = interpolate(frame, [INTRO - 15, INTRO], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, opacity: out }}>
      <div style={{ ...label, fontSize: 26, color: color.blue, ...rise(3) }}>Before and after</div>
      <div style={{ marginTop: 20, fontFamily: font.poster, fontWeight: 860, fontStretch: "75%", fontSize: 200, lineHeight: 0.9, color: color.ink, textTransform: "uppercase", ...rise(9) }}>
        Back to flat
      </div>
      <div style={{ marginTop: 30, maxWidth: 1100, fontFamily: font.serif, fontSize: 40, lineHeight: 1.25, color: color.ink2, ...rise(18) }}>
        Liquid glass is gone from Ardia. Every surface takes Dia's flat look again, measured against Dia.
      </div>
      <Img src={staticFile("brand/app-icon.png")} style={{ position: "absolute", right: 170, top: 330, width: 420, height: 420, ...rise(15) }} />
    </AbsoluteFill>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 18], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity }}>
      <Img src={staticFile("brand/app-icon.png")} style={{ width: 200, height: 200 }} />
      <div style={{ marginTop: 28, fontFamily: font.poster, fontWeight: 760, fontStretch: "87.5%", fontSize: 60, color: color.ink }}>Flat everywhere</div>
      <div style={{ marginTop: 16, fontFamily: font.serif, fontSize: 32, color: color.ink2 }}>The command bar, Peek, onboarding and the Picture in Picture controls too.</div>
      <div style={{ ...label, marginTop: 22, fontSize: 24, color: color.blue }}>ardia.dev</div>
    </AbsoluteFill>
  );
}

export default function DiaLook() {
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={INTRO}>
        <Intro />
      </Sequence>
      {SCENES.map((scene, i) => (
        <Sequence key={scene.title} from={starts[i]} durationInFrames={sceneLength(scene)}>
          <SceneView scene={scene} index={i} />
        </Sequence>
      ))}
      <Sequence from={total - OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}
