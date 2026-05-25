"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Swal from "sweetalert2";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────
type Point = {
  x: number; y: number; r: number;
  cx1: number; cy1: number; cx2: number; cy2: number;
  curve: boolean;
};
type Guide = { axis: "x" | "y"; value: number; center: boolean };
type SnapResult = { x: number; y: number; guides: Guide[] };
type SelHandle = { idx: number; which: "in" | "out" } | null;
type CodeMode = "svg" | "css" | "tailwind";
type FillType = "solid" | "linear" | "radial" | "metallic";
type GradStop = { color: string; pos: number };
type GradParams = { fillType: FillType; stops: GradStop[]; gradAngle: number };
type PanelTab = "canvas" | "props" | "code";

// ─── Constants ───────────────────────────────────────────────────
const W = 400, H = 400, MAX_HIST = 60, SNAP_THR = 8, GRID = 20;

// ─── SweetAlert toast ────────────────────────────────────────────
const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2000,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.addEventListener("mouseenter", Swal.stopTimer);
    toast.addEventListener("mouseleave", Swal.resumeTimer);
  },
});

// ─── Point helpers ────────────────────────────────────────────────
const mkPt = (x: number, y: number, r = 0, curve = false): Point =>
  ({ x, y, r, cx1: -30, cy1: 0, cx2: 30, cy2: 0, curve });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function autoH(arr: Point[], i: number): Point {
  const n = arr.length;
  const pv = arr[(i - 1 + n) % n], cu = arr[i], nx = arr[(i + 1) % n], t = 0.35;
  return { ...cu, cx1: -(nx.x - pv.x) * t, cy1: -(nx.y - pv.y) * t, cx2: (nx.x - pv.x) * t, cy2: (nx.y - pv.y) * t };
}

function buildPath(pts: Point[]): string {
  if (!pts || pts.length < 2) return "";
  const anyCurve = pts.some(p => p.curve);
  const anyR = pts.some(p => p.r > 0);
  if (anyCurve) {
    const n = pts.length; let d = "";
    for (let i = 0; i < n; i++) {
      const p = pts[i], nx = pts[(i + 1) % n];
      if (i === 0) d += `M ${p.x},${p.y}`;
      if (p.curve || nx.curve)
        d += ` C ${rv(p.x + p.cx2)},${rv(p.y + p.cy2)} ${rv(nx.x + nx.cx1)},${rv(nx.y + nx.cy1)} ${nx.x},${nx.y}`;
      else d += ` L ${nx.x},${nx.y}`;
    }
    return d + " Z";
  }
  if (anyR) {
    const n = pts.length; let d = "";
    for (let i = 0; i < n; i++) {
      const pv = pts[(i - 1 + n) % n], cu = pts[i], nx = pts[(i + 1) % n];
      const rad = cu.r || 0;
      if (rad <= 0) { d += (i === 0 ? `M ${cu.x},${cu.y}` : ` L ${cu.x},${cu.y}`); continue; }
      const tp = norm(pv.x - cu.x, pv.y - cu.y), tn = norm(nx.x - cu.x, nx.y - cu.y);
      const safe = Math.min(rad, dst(cu, pv) * 0.45, dst(cu, nx) * 0.45);
      const p1x = cu.x + tp[0] * safe, p1y = cu.y + tp[1] * safe;
      const p2x = cu.x + tn[0] * safe, p2y = cu.y + tn[1] * safe;
      if (i === 0) d += `M ${rv(p1x)},${rv(p1y)}`; else d += ` L ${rv(p1x)},${rv(p1y)}`;
      const cross = tp[0] * tn[1] - tp[1] * tn[0];
      d += ` A ${rv(safe)},${rv(safe)} 0 0,${cross < 0 ? 1 : 0} ${rv(p2x)},${rv(p2y)}`;
    }
    return d + " Z";
  }
  return "M " + pts.map(p => `${p.x},${p.y}`).join(" L ") + " Z";
}

const rv = (v: number) => Math.round(v * 10) / 10;
const norm = (x: number, y: number): [number, number] => {
  const l = Math.sqrt(x * x + y * y) || 1; return [x / l, y / l];
};
const dst = (a: Point, b: Point) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const hexRgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a.toFixed(2)})`;
};
const pct = (v: number, max: number) => (v / max * 100).toFixed(1).replace(".0", "") + "%";

// ─── Presets ──────────────────────────────────────────────────────
const nGon = (n: number, r: number, cx: number, cy: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = Math.PI * 2 / n * i - Math.PI / 2;
    return [Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))];
  });
const starP = (n: number, ro: number, ri: number, cx: number, cy: number): [number, number][] =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = Math.PI * 2 / (n * 2) * i - Math.PI / 2, rv2 = i % 2 === 0 ? ro : ri;
    return [Math.round(cx + rv2 * Math.cos(a)), Math.round(cy + rv2 * Math.sin(a))];
  });
const heartP = (): [number, number][] =>
  Array.from({ length: 16 }, (_, i) => {
    const t = Math.PI * 2 / 16 * i;
    return [Math.round(200 + 120 * (16 * Math.sin(t) ** 3) / 16), Math.round(210 - 120 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16)];
  });

const PRESETS: { name: string; pts: [number, number][] }[] = [
  { name: "Square",   pts: [[80,80],[320,80],[320,320],[80,320]] },
  { name: "Triangle", pts: [[200,60],[340,340],[60,340]] },
  { name: "Pentagon", pts: nGon(5, 160, 200, 200) },
  { name: "Hexagon",  pts: nGon(6, 155, 200, 200) },
  { name: "Star 5",   pts: starP(5, 160, 80, 200, 200) },
  { name: "Star 6",   pts: starP(6, 155, 75, 200, 200) },
  { name: "Arrow",    pts: [[60,150],[240,150],[240,80],[340,200],[240,320],[240,250],[60,250]] },
  { name: "Diamond",  pts: [[200,50],[360,200],[200,350],[40,200]] },
  { name: "Cross",    pts: [[140,60],[260,60],[260,140],[340,140],[340,260],[260,260],[260,340],[140,340],[140,260],[60,260],[60,140],[140,140]] },
  { name: "Heart",    pts: heartP() },
  { name: "Leaf",     pts: [[200,60],[320,130],[340,200],[320,270],[200,340],[80,270],[60,200],[80,130]] },
  { name: "Wave",     pts: [[60,220],[110,160],[160,220],[210,160],[260,220],[310,160],[340,200],[340,300],[60,300]] },
];

// ─── Metallic presets ────────────────────────────────────────────
const METALLIC_PRESETS: { name: string; stops: GradStop[] }[] = [
  { name: "Silver", stops: [{color:"#e8e8e8",pos:0},{color:"#a0a0a0",pos:35},{color:"#f5f5f5",pos:50},{color:"#989898",pos:65},{color:"#e0e0e0",pos:100}] },
  { name: "Gold",   stops: [{color:"#c8960c",pos:0},{color:"#ffd700",pos:35},{color:"#ffe88a",pos:50},{color:"#daa520",pos:65},{color:"#b8860b",pos:100}] },
  { name: "Copper", stops: [{color:"#a05020",pos:0},{color:"#cd7f32",pos:35},{color:"#e8a060",pos:50},{color:"#b8722c",pos:65},{color:"#8b4513",pos:100}] },
  { name: "Chrome", stops: [{color:"#f0f0f0",pos:0},{color:"#c0c0c0",pos:20},{color:"#ffffff",pos:40},{color:"#808080",pos:60},{color:"#d8d8d8",pos:80},{color:"#f0f0f0",pos:100}] },
];

// ─── Code generators ─────────────────────────────────────────────
const genClip = (pts: Point[]) => "polygon(" + pts.map(p => `${pct(p.x, W)} ${pct(p.y, H)}`).join(", ") + ")";

const gradCSSValue = (stops: GradStop[], fillType: FillType, angle: number): string => {
  const s = stops.map(st => `${st.color} ${st.pos}%`).join(", ");
  if (fillType === "radial") return `radial-gradient(circle at center, ${s})`;
  return `linear-gradient(${fillType === "metallic" ? 135 : angle}deg, ${s})`;
};

const genSVG = (pts: Point[], fill: string, op: number, sw: number, sc: string, g?: GradParams, outW = 400, outH = 400) => {
  let fillStr = op < 1 ? hexRgba(fill, op) : fill, defs = "", opAttr = "";
  if (g) {
    fillStr = "url(#g)";
    if (op < 1) opAttr = ` fill-opacity="${op.toFixed(2)}"`;
    const svgStops = g.stops.map(s => `<stop offset="${s.pos}%" stop-color="${s.color}"/>`).join("\n      ");
    if (g.fillType === "linear")
      defs = `  <defs>\n    <linearGradient id="g" gradientUnits="objectBoundingBox" gradientTransform="rotate(${g.gradAngle},0.5,0.5)" x1="0" y1="0.5" x2="1" y2="0.5">\n      ${svgStops}\n    </linearGradient>\n  </defs>\n`;
    else if (g.fillType === "radial")
      defs = `  <defs>\n    <radialGradient id="g" cx="50%" cy="50%" r="50%">\n      ${svgStops}\n    </radialGradient>\n  </defs>\n`;
    else
      defs = `  <defs>\n    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">\n      ${svgStops}\n    </linearGradient>\n  </defs>\n`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 400 400">\n${defs}  <path d="${buildPath(pts)}" fill="${fillStr}"${opAttr}${sw > 0 ? ` stroke="${sc}" stroke-width="${sw}"` : ""}/>\n</svg>`;
};

const genCSS = (pts: Point[], fill: string, op: number, sw: number, sc: string, g?: GradParams, outW = 400, outH = 400) => {
  const bg = g ? gradCSSValue(g.stops, g.fillType, g.gradAngle) : (op < 1 ? hexRgba(fill, op) : fill);
  const opProp = g && op < 1 ? `\n  opacity: ${op.toFixed(2)};` : "";
  return `.my-shape {\n  width: ${outW}px;\n  height: ${outH}px;\n  clip-path: ${genClip(pts)};\n  background: ${bg};${opProp}${sw > 0 ? `\n  outline: ${sw}px solid ${sc};` : ""}\n}`;
};

const genTW = (pts: Point[], fill: string, g?: GradParams, outW = 400, outH = 400) => {
  const clip = genClip(pts).replace(/\s/g, "_");
  if (g) {
    const css = gradCSSValue(g.stops, g.fillType, g.gradAngle).replace(/\s/g, "_");
    return `<div\n  className="[clip-path:${clip}]\n    w-[${outW}px] h-[${outH}px]\n    [background:${css}]"\n/>`;
  }
  return `<div\n  className="[clip-path:${clip}]\n    w-[${outW}px] h-[${outH}px]\n    bg-[${fill}]"\n/>`;
};


// ─── Snap engine ─────────────────────────────────────────────────
function computeSnap(rawX: number, rawY: number, dragIdx: number, allPts: Point[], snapOn: boolean): SnapResult {
  if (!snapOn) return { x: Math.round(rawX), y: Math.round(rawY), guides: [] };
  let x = rawX, y = rawY;
  const guides: Guide[] = [];
  const others = allPts.filter((_, i) => i !== dragIdx);
  const cxs = [W / 2, 0, W, ...others.map(p => p.x)];
  const cys = [H / 2, 0, H, ...others.map(p => p.y)];

  let bdx = SNAP_THR + 1, sx: number | null = null;
  for (const cx of cxs) { const d = Math.abs(rawX - cx); if (d < bdx) { bdx = d; sx = cx; } }
  if (sx !== null && bdx <= SNAP_THR) {
    x = sx; guides.push({ axis: "x", value: sx, center: sx === W / 2 });
  } else {
    const gx = Math.round(rawX / GRID) * GRID;
    if (Math.abs(rawX - gx) < SNAP_THR / 2) x = gx;
  }

  let bdy = SNAP_THR + 1, sy: number | null = null;
  for (const cy of cys) { const d = Math.abs(rawY - cy); if (d < bdy) { bdy = d; sy = cy; } }
  if (sy !== null && bdy <= SNAP_THR) {
    y = sy; guides.push({ axis: "y", value: sy, center: sy === H / 2 });
  } else {
    const gy = Math.round(rawY / GRID) * GRID;
    if (Math.abs(rawY - gy) < SNAP_THR / 2) y = gy;
  }

  return { x: Math.round(x), y: Math.round(y), guides };
}

// ─── UI Atoms ─────────────────────────────────────────────────────
interface BtnProps {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}
const Btn = ({ onClick, children, active, disabled, title, className }: BtnProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={cn(
      "h-[30px] px-[11px] rounded-full border border-white/[.12] text-xs font-medium",
      "inline-flex items-center gap-[5px] whitespace-nowrap transition-all duration-[140ms]",
      active ? "bg-sb-blue text-white shadow-[0_0_14px_rgba(129,140,248,.5)]" : "bg-white/[.06] text-sb-mid",
      disabled ? "opacity-50 cursor-not-allowed text-sb-muted" : "cursor-pointer",
      className,
    )}
  >
    {children}
  </button>
);

interface SliderProps {
  label: string; value: number; min: number; max: number;
  step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; onStart?: () => void; unit?: string;
}
const Slider = ({ label, value, min, max, step = 1, onChange, onCommit, onStart, unit = "" }: SliderProps) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);

  const commit = (raw?: string) => {
    setEditing(false);
    const n = parseFloat(raw ?? draft);
    if (!isNaN(n)) {
      const clamped = Math.min(max, Math.max(min, Math.round(n)));
      setDraft(String(clamped)); onChange(clamped); if (onCommit) onCommit(clamped);
    } else { setDraft(String(value)); }
  };

  return (
    <div className="mb-[10px]">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] text-sb-mid font-medium">{label}</span>
        {editing ? (
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(String(value)); } }}
            className="w-[50px] text-right font-mono text-[11px] text-sb-blue border-[1.5px] border-sb-blue rounded-[5px] px-[5px] py-px outline-none bg-[#1a1a2e]"
            autoFocus onFocus={e => e.target.select()}
          />
        ) : (
          <span
            onClick={() => { setEditing(true); setDraft(String(value)); }}
            title="Click to type value"
            className="text-[11px] font-mono text-sb-blue cursor-text min-w-[36px] text-right border-b border-dashed border-sb-blue/40 pb-px"
          >
            {value}{unit}
          </span>
        )}
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onPointerDown={() => onStart?.()}
        onChange={e => { onChange(+e.target.value); setDraft(String(+e.target.value)); }}
        onPointerUp={e => onCommit && onCommit(+(e.target as HTMLInputElement).value)}
        className="w-full cursor-ew-resize"
      />
    </div>
  );
};

const ColorRow = ({ color, onChange }: { color: string; onChange: (c: string) => void }) => (
  <div className="flex gap-2 items-center mb-[10px]">
    <div className="w-7 h-7 rounded-md border-[1.5px] border-white/[.12] overflow-hidden shrink-0">
      <input type="color" value={color} onChange={e => onChange(e.target.value)} className="w-full h-full border-none cursor-pointer" />
    </div>
    <span className="font-mono text-[11px] text-sb-mid">{color}</span>
  </div>
);

interface SecProps { children: React.ReactNode; noBorder?: boolean; accent?: boolean; }
const Sec = ({ children, noBorder, accent }: SecProps) => (
  <div className={cn(
    "px-4 py-[14px]",
    !noBorder && "border-b border-white/[.07]",
    accent && "border-l-[3px] border-l-sb-orange bg-sb-orange/[.08]",
  )}>
    {children}
  </div>
);

const SecTitle = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex items-center justify-between mb-[10px]">
    <span className="text-[10px] font-semibold tracking-[0.5px] uppercase text-sb-muted flex items-center gap-[6px]">
      <span className="inline-block w-[3px] h-[12px] rounded-full shrink-0" style={{ background: "linear-gradient(to bottom, #818cf8, #f472b6)" }} />
      {children}
    </span>
    {right}
  </div>
);

// ══════════════════════════════════════════════════════════════════
export default function ShapeBuilder() {

  // ─── History ────────────────────────────────────────────────
  const initPts = (): Point[] => {
    const raw = PRESETS[0].pts.map(([x, y]) => mkPt(x, y, 0));
    return raw.map((_, i) => autoH(raw, i));
  };
  const histStack = useRef<Point[][]>([initPts()]);
  const histIdx = useRef(0);
  const [, forceRender] = useState(0);
  const tick = () => forceRender(n => n + 1);

  const pts = histStack.current[histIdx.current] || [];
  const canUndo = histIdx.current > 0;
  const canRedo = histIdx.current < histStack.current.length - 1;

  const pushHist = useCallback((newPts: Point[]) => {
    const stack = histStack.current, idx = histIdx.current;
    const next = [...stack.slice(0, idx + 1), newPts].slice(-MAX_HIST);
    histStack.current = next; histIdx.current = next.length - 1; tick();
  }, []);
  const undoHist = useCallback(() => { if (histIdx.current > 0) { histIdx.current--; tick(); } }, []);
  const redoHist = useCallback(() => { if (histIdx.current < histStack.current.length - 1) { histIdx.current++; tick(); } }, []);
  const resetHist = useCallback((newPts: Point[]) => { histStack.current = [newPts]; histIdx.current = 0; tick(); }, []);

  // ─── UI state ───────────────────────────────────────────────
  const [sel, setSel]           = useState(-1);
  const [selH, setSelH]         = useState<SelHandle>(null);
  const [curves, setCurves]     = useState(false);
  const [activeP, setActiveP]   = useState(0);
  const [globalR, setGlobalR]   = useState(0);
  const [snapOn, setSnapOn]     = useState(true);
  const [fill, setFill]         = useState("#818cf8");
  const [fillOp, setFillOp]     = useState(100);
  const [fillType, setFillType] = useState<FillType>("solid");
  const [gradStops, setGradStops] = useState<GradStop[]>([
    { color: "#818cf8", pos: 0 },
    { color: "#ff9500", pos: 100 },
  ]);
  const [gradAngle, setGradAngle] = useState(135);
  const [sw, setSw]             = useState(0);
  const [sc, setSc]             = useState("#000000");
  const [shBlur, setShBlur]     = useState(0);
  const [shY, setShY]           = useState(0);
  const [shOp, setShOp]         = useState(25);
  const [codeMode, setCodeMode] = useState<CodeMode>("svg");
  const [rotate, setRotate]     = useState(0);
  const [flipH, setFlipH]       = useState(false);
  const [flipV, setFlipV]       = useState(false);
  const [panel, setPanel]       = useState<PanelTab>("canvas");
  const [winW, setWinW]         = useState(0);
  const [preview, setPreview]   = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  const [ctxMenu, setCtxMenu]   = useState<{ x: number; y: number; idx: number } | null>(null);
  const [outW, setOutW]         = useState(400);
  const [outH, setOutH]         = useState(400);
  const [liveSelR, setLiveSelR] = useState(0);

  useEffect(() => {
    setWinW(window.innerWidth);
    const f = () => setWinW(window.innerWidth);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  const isMobile = winW > 0 && winW < 640;
  const isTablet = winW >= 640 && winW < 960;

  const svgRef      = useRef<SVGSVGElement | null>(null);
  const scaleRef    = useRef(1);
  const areaRef     = useRef<HTMLDivElement | null>(null);
  const [svgDim, setSvgDim] = useState({ w: W, h: H });

  useEffect(() => {
    const upd = () => {
      if (!areaRef.current) return;
      const { clientWidth: cw, clientHeight: ch } = areaRef.current;
      const pad = isMobile ? 20 : 48;
      const s = Math.min((cw - pad * 2) / W, (ch - pad * 2) / H, 1);
      scaleRef.current = s;
      setSvgDim({ w: Math.round(W * s), h: Math.round(H * s) });
    };
    upd();
    const ro = new ResizeObserver(upd);
    if (areaRef.current) ro.observe(areaRef.current);
    return () => ro.disconnect();
  }, [isMobile]);


  // ─── Transform helpers ───────────────────────────────────────
  const doFlipH = () => {
    rotateBaseRef.current = null; rotateOriginRef.current = null; setRotate(0);
    setFlipH(v => !v);
    pushHist(pts.map(p => ({ ...p, x: Math.round(2 * (W / 2) - p.x) })));
  };
  const doFlipV = () => {
    rotateBaseRef.current = null; rotateOriginRef.current = null; setRotate(0);
    setFlipV(v => !v);
    pushHist(pts.map(p => ({ ...p, y: Math.round(2 * (H / 2) - p.y) })));
  };
  const applyPreset = (i: number) => {
    setActiveP(i); setCurves(false); setSel(-1); setSelH(null); setGlobalR(0);
    setFlipH(false); setFlipV(false); setRotate(0);
    rotateBaseRef.current = null; rotateOriginRef.current = null;
    const raw = PRESETS[i].pts.map(([x, y]) => mkPt(x, y, 0));
    resetHist(raw.map((_, j) => autoH(raw, j)));
  };

  const addClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (preview || spaceHeldRef.current) return;
    if ((e.target as Element).closest("[data-h]") || (e.target as Element).closest("[data-e]")) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / scaleRef.current;
    const rawY = (e.clientY - rect.top) / scaleRef.current;
    const { x, y } = computeSnap(rawX, rawY, -1, pts, snapOn);
    const np = mkPt(clamp(x, 0, W), clamp(y, 0, H), globalR, curves);
    const a = [...pts, np]; const ni = a.length - 1;
    a[ni] = autoH(a, ni); if (ni > 0) a[ni - 1] = autoH(a, ni - 1); a[0] = autoH(a, 0);
    pushHist(a); setSel(ni); setSelH(null);
  };

  // ─── Live DOM painting (60fps drag) ──────────────────────────
  const livePtsRef = useRef<Point[]>(pts);
  useEffect(() => { livePtsRef.current = pts; }, [pts]);
  const snapOnRef = useRef(snapOn);
  useEffect(() => { snapOnRef.current = snapOn; }, [snapOn]);
  const draggingRef = useRef(false);
  const rotateOriginRef = useRef<Point[] | null>(null);
  const rotateBaseRef   = useRef<Point[] | null>(null);
  const rotateAtStartRef = useRef(0);
  const rotateStateRef  = useRef(rotate);
  useEffect(() => { rotateStateRef.current = rotate; }, [rotate]);
  const selRef = useRef(sel);
  useEffect(() => { selRef.current = sel; }, [sel]);
  useEffect(() => { setLiveSelR(selPt?.r || 0); }, [sel, pts]);

  const paintLive = useCallback((lp: Point[], guideList: Guide[] = []) => {
    const pathEl    = svgRef.current?.querySelector<SVGPathElement>("#live-path");
    const handlesEl = svgRef.current?.querySelector<SVGGElement>("#live-handles");
    const guidesEl  = svgRef.current?.querySelector<SVGGElement>("#live-guides");
    const guideLabel = document.getElementById("guide-label");
    if (!pathEl || !handlesEl || !guidesEl) return;

    pathEl.setAttribute("d", buildPath(lp));

    lp.forEach((p, i) => {
      const g = handlesEl.querySelector<SVGGElement>(`[data-ai="${i}"]`);
      if (!g) return;
      g.querySelector<SVGCircleElement>(".ah-outer")?.setAttribute("cx", String(p.x));
      g.querySelector<SVGCircleElement>(".ah-outer")?.setAttribute("cy", String(p.y));
      g.querySelector<SVGCircleElement>(".ah-inner")?.setAttribute("cx", String(p.x));
      g.querySelector<SVGCircleElement>(".ah-inner")?.setAttribute("cy", String(p.y));
      const txt = g.querySelector("text");
      if (txt) { txt.setAttribute("x", String(p.x + 12)); txt.setAttribute("y", String(p.y - 10)); }
      if (p.curve) {
        const co = handlesEl.querySelector<SVGRectElement>(`[data-co="${i}"]`);
        const ci = handlesEl.querySelector<SVGRectElement>(`[data-ci="${i}"]`);
        const lo = handlesEl.querySelector<SVGLineElement>(`[data-lo="${i}"]`);
        const li = handlesEl.querySelector<SVGLineElement>(`[data-li="${i}"]`);
        if (co) { co.setAttribute("x", String(p.x + p.cx2 - 5)); co.setAttribute("y", String(p.y + p.cy2 - 5)); co.setAttribute("transform", `rotate(45,${p.x + p.cx2},${p.y + p.cy2})`); }
        if (ci) { ci.setAttribute("x", String(p.x + p.cx1 - 5)); ci.setAttribute("y", String(p.y + p.cy1 - 5)); ci.setAttribute("transform", `rotate(45,${p.x + p.cx1},${p.y + p.cy1})`); }
        if (lo) { lo.setAttribute("x1", String(p.x)); lo.setAttribute("y1", String(p.y)); lo.setAttribute("x2", String(p.x + p.cx2)); lo.setAttribute("y2", String(p.y + p.cy2)); }
        if (li) { li.setAttribute("x1", String(p.x)); li.setAttribute("y1", String(p.y)); li.setAttribute("x2", String(p.x + p.cx1)); li.setAttribute("y2", String(p.y + p.cy1)); }
      }
    });

    guidesEl.innerHTML = "";
    guideList.forEach(g => {
      const col = g.center ? "#ff3b30" : "#818cf8";
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      if (g.axis === "x") { line.setAttribute("x1", String(g.value)); line.setAttribute("y1", "0"); line.setAttribute("x2", String(g.value)); line.setAttribute("y2", String(H)); }
      else { line.setAttribute("x1", "0"); line.setAttribute("y1", String(g.value)); line.setAttribute("x2", String(W)); line.setAttribute("y2", String(g.value)); }
      line.setAttribute("stroke", col); line.setAttribute("stroke-width", "1.2");
      line.setAttribute("stroke-dasharray", g.center ? "none" : "5 3"); line.setAttribute("opacity", "0.9");
      guidesEl.appendChild(line);
    });

    if (guideList.length > 0) {
      const p = lp[lp.length - 1] || lp[0];
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(p.x)); circle.setAttribute("cy", String(p.y));
      circle.setAttribute("r", "13"); circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", "#ff3b30"); circle.setAttribute("stroke-width", "1.5"); circle.setAttribute("opacity", "0.8");
      guidesEl.appendChild(circle);
    }

    if (guideLabel) {
      if (guideList.length > 0) {
        guideLabel.textContent = guideList.map(g => g.axis === "x" ? `x=${g.value}` : `y=${g.value}`).join("  ·  ");
        guideLabel.style.display = "block";
      } else { guideLabel.style.display = "none"; }
    }
  }, []);

  const startRotate = useCallback(() => {
    const origin = livePtsRef.current.map(p => ({ ...p }));
    rotateOriginRef.current = origin;
    rotateAtStartRef.current = rotateStateRef.current;
    if (!rotateBaseRef.current) rotateBaseRef.current = origin;
  }, []);

  const liveRotate = useCallback((deg: number) => {
    if (!rotateOriginRef.current) {
      const origin = livePtsRef.current.map(p => ({ ...p }));
      rotateOriginRef.current = origin;
      rotateAtStartRef.current = rotateStateRef.current;
      if (!rotateBaseRef.current) rotateBaseRef.current = origin;
    }
    setRotate(deg);
    const delta = deg - rotateAtStartRef.current;
    const rad = (delta * Math.PI) / 180, cx = W / 2, cy = H / 2;
    const rotated = rotateOriginRef.current.map(p => {
      const dx = p.x - cx, dy = p.y - cy;
      return { ...p, x: Math.round(cx + dx * Math.cos(rad) - dy * Math.sin(rad)), y: Math.round(cy + dx * Math.sin(rad) + dy * Math.cos(rad)) };
    });
    livePtsRef.current = rotated;
    paintLive(rotated);
  }, [paintLive]);

  const commitRotate = useCallback((deg: number) => {
    if (!rotateOriginRef.current) return;
    const delta = deg - rotateAtStartRef.current;
    const rad = (delta * Math.PI) / 180, cx = W / 2, cy = H / 2;
    const rotated = rotateOriginRef.current.map(p => {
      const dx = p.x - cx, dy = p.y - cy;
      return { ...p, x: Math.round(cx + dx * Math.cos(rad) - dy * Math.sin(rad)), y: Math.round(cy + dx * Math.sin(rad) + dy * Math.cos(rad)) };
    });
    if (delta !== 0) pushHist(rotated);
    rotateOriginRef.current = null;
  }, [pushHist]);

  useEffect(() => {
    let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
    const down = (e: KeyboardEvent) => {
      const inInput = !!(e.target as HTMLElement).closest("input,textarea");
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undoHist(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redoHist(); }
      if (e.code === "Space" && !inInput) { e.preventDefault(); spaceHeldRef.current = true; setSpaceHeld(true); }
      if (e.key === "Escape") setCtxMenu(null);
      if (!inInput && (e.key === "Delete" || e.key === "Backspace") && selRef.current >= 0) {
        e.preventDefault();
        setCtxMenu(null);
        const cur = histStack.current[histIdx.current];
        if (cur.length > 3) {
          const i = selRef.current;
          const a = cur.filter((_, j) => j !== i);
          pushHist(a); setSel(s => Math.min(s, a.length - 1)); setSelH(null);
        }
      }
      if (!inInput && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && selRef.current >= 0) {
        e.preventDefault();
        const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        const dy = e.key === "ArrowUp"   ? -1 : e.key === "ArrowDown"  ? 1 : 0;
        const step = e.shiftKey ? 10 : 1;
        const idx = selRef.current;
        const lp = livePtsRef.current.map(p => ({ ...p }));
        lp[idx] = { ...lp[idx], x: clamp(lp[idx].x + dx * step, 0, W), y: clamp(lp[idx].y + dy * step, 0, H) };
        livePtsRef.current = lp;
        paintLive(lp);
        if (nudgeTimer) clearTimeout(nudgeTimer);
        nudgeTimer = setTimeout(() => { pushHist(livePtsRef.current.map(p => ({ ...p }))); nudgeTimer = null; }, 400);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") { spaceHeldRef.current = false; setSpaceHeld(false); }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      if (nudgeTimer) clearTimeout(nudgeTimer);
    };
  }, [undoHist, redoHist, paintLive, pushHist, setSel, setSelH]);

  const dragAnchor = (e: React.MouseEvent, idx: number) => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
    draggingRef.current = true; setSel(idx); setSelH(null);
    const ox = livePtsRef.current[idx].x, oy = livePtsRef.current[idx].y;
    const sx = e.clientX, sy = e.clientY, s = scaleRef.current;
    const startPts = livePtsRef.current.map(p => ({ ...p }));
    const mv = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const { x, y, guides: g } = computeSnap(clamp(ox + (ev.clientX - sx) / s, 0, W), clamp(oy + (ev.clientY - sy) / s, 0, H), idx, startPts, snapOnRef.current);
      const lp = startPts.map(p => ({ ...p })); lp[idx] = { ...lp[idx], x, y };
      livePtsRef.current = lp; paintLive(lp, g);
    };
    const up = () => {
      if (!draggingRef.current) return; draggingRef.current = false;
      const fp = livePtsRef.current.map(p => ({ ...p })); paintLive(fp, []); pushHist(fp);
      document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); document.removeEventListener("mouseleave", up);
    };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); document.addEventListener("mouseleave", up);
  };

  const dragCtrl = (e: React.MouseEvent, idx: number, which: "in" | "out") => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
    draggingRef.current = true; setSel(idx); setSelH({ idx, which });
    const p = livePtsRef.current[idx];
    const ox = which === "out" ? p.cx2 : p.cx1, oy = which === "out" ? p.cy2 : p.cy1;
    const sx = e.clientX, sy = e.clientY, s = scaleRef.current;
    const startPts = livePtsRef.current.map(q => ({ ...q }));
    const mv = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s;
      const lp = startPts.map(q => ({ ...q })); const np = { ...lp[idx] };
      if (which === "out") { np.cx2 = ox + dx; np.cy2 = oy + dy; if (!ev.altKey) { np.cx1 = -(ox + dx); np.cy1 = -(oy + dy); } }
      else { np.cx1 = ox + dx; np.cy1 = oy + dy; if (!ev.altKey) { np.cx2 = -(ox + dx); np.cy2 = -(oy + dy); } }
      lp[idx] = np; livePtsRef.current = lp; paintLive(lp);
    };
    const up = () => {
      if (!draggingRef.current) return; draggingRef.current = false;
      pushHist(livePtsRef.current.map(p => ({ ...p })));
      document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); document.removeEventListener("mouseleave", up);
    };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up); document.addEventListener("mouseleave", up);
  };

  const insertEdge = (i: number) => {
    const nx = pts[(i + 1) % pts.length];
    const mx = Math.round((pts[i].x + nx.x) / 2), my = Math.round((pts[i].y + nx.y) / 2);
    const a = [...pts]; a.splice(i + 1, 0, mkPt(mx, my, globalR, curves));
    a[i + 1] = autoH(a, i + 1); a[i] = autoH(a, i); a[(i + 2) % a.length] = autoH(a, (i + 2) % a.length);
    pushHist(a); setSel(i + 1); setSelH(null);
  };

  const toggleCurve = (i: number) => {
    const a = pts.map(p => ({ ...p })); const nc = !a[i].curve;
    a[i] = nc ? { ...autoH(a, i), curve: true } : { ...a[i], curve: false };
    pushHist(a); setSelH(null);
  };

  const toggleAllCurves = () => {
    const nc = !curves; setCurves(nc); setSelH(null);
    pushHist(pts.map((p, i) => nc ? { ...autoH(pts, i), curve: true } : { ...p, curve: false }));
  };

  const delPt = (i: number) => {
    if (pts.length <= 3) return;
    const a = pts.filter((_, j) => j !== i);
    pushHist(a); setSel(s => Math.min(s, a.length - 1)); setSelH(null);
  };

  const dupPt = (i: number) => {
    const p = pts[i];
    const a = [...pts];
    const np = mkPt(clamp(p.x + 16, 0, W), clamp(p.y + 16, 0, H), p.r, p.curve);
    a.splice(i + 1, 0, np);
    a[i + 1] = autoH(a, i + 1);
    if (i >= 0) a[i] = autoH(a, i);
    if (i + 2 < a.length) a[i + 2] = autoH(a, i + 2);
    pushHist(a); setSel(i + 1); setSelH(null);
  };

  const addCenter = () => {
    const cx = Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length);
    const cy = Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length);
    const a = [...pts, mkPt(cx + 20, cy + 20, globalR, curves)];
    const ni = a.length - 1; a[ni] = autoH(a, ni); pushHist(a); setSel(ni);
  };

  const setSelRadius = (r: number) => {
    if (sel < 0 || sel >= pts.length) return;
    const a = pts.map(p => ({ ...p })); a[sel] = { ...a[sel], r }; pushHist(a);
  };

  // ─── Derived ────────────────────────────────────────────────
  const op = fillOp / 100;
  const applyFilter = (blur: number, y: number, opacity: number) => {
    const svg = svgRef.current; if (!svg) return;
    svg.style.filter = (blur > 0 || y !== 0) ? `drop-shadow(0 ${y}px ${blur}px rgba(0,0,0,${(opacity / 100).toFixed(2)}))` : "";
  };

  const rawCode = () => {
    const g: GradParams | undefined = fillType !== "solid" ? { fillType, stops: gradStops, gradAngle } : undefined;
    if (codeMode === "svg") return genSVG(pts, fill, op, sw, sc, g, outW, outH);
    if (codeMode === "css") return genCSS(pts, fill, op, sw, sc, g, outW, outH);
    return genTW(pts, fill, g, outW, outH);
  };

  const doCopy = () => {
    navigator.clipboard.writeText(rawCode())
      .then(() => Toast.fire({ icon: "success", title: "Copied to clipboard!" }))
      .catch(() => Toast.fire({ icon: "error", title: "Failed to copy" }));
  };

  const pathD = buildPath(pts);
  const pathFill = fillType === "solid" ? fill : "url(#sbGrad)";
  const shFilter = (shBlur > 0 || shY !== 0) ? `drop-shadow(0 ${shY}px ${shBlur}px rgba(0,0,0,${(shOp / 100).toFixed(2)}))` : "none";
  const selPt = sel >= 0 && sel < pts.length ? pts[sel] : null;

  // ─── Canvas ──────────────────────────────────────────────────
  const Canvas = () => (
    <div ref={areaRef} className="flex-1 bg-sb-light relative overflow-hidden flex items-center justify-center" style={{ minHeight: isMobile ? 280 : 0 }}>
      {/* Grid */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px)", backgroundSize: "20px 20px" }} />
      {/* Aurora glow */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 45% 40% at 18% 22%, rgba(129,140,248,.13) 0%, transparent 65%), radial-gradient(ellipse 38% 48% at 82% 75%, rgba(244,114,182,.11) 0%, transparent 60%), radial-gradient(ellipse 55% 35% at 65% 12%, rgba(52,211,153,.07) 0%, transparent 60%)" }} />
      {/* Decorative corner — top-right rings */}
      <div className="absolute top-3 right-3 pointer-events-none" style={{ opacity: 0.18 }}>
        <svg width="88" height="88" viewBox="0 0 88 88" fill="none">
          <circle cx="44" cy="44" r="40" stroke="#818cf8" strokeWidth="0.8"/>
          <circle cx="44" cy="44" r="28" stroke="#818cf8" strokeWidth="0.5"/>
          <circle cx="44" cy="44" r="16" stroke="#f472b6" strokeWidth="0.6"/>
          <line x1="4"  y1="44" x2="84" y2="44" stroke="#818cf8" strokeWidth="0.5"/>
          <line x1="44" y1="4"  x2="44" y2="84" stroke="#818cf8" strokeWidth="0.5"/>
        </svg>
      </div>
      {/* Decorative corner — bottom-left triangles */}
      <div className="absolute bottom-14 left-3 pointer-events-none" style={{ opacity: 0.14 }}>
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <polygon points="32,4 60,52 4,52"  stroke="#f472b6" strokeWidth="0.9" fill="none"/>
          <polygon points="32,16 50,48 14,48" stroke="#818cf8" strokeWidth="0.5" fill="none"/>
          <polygon points="32,27 42,44 22,44" stroke="#f472b6" strokeWidth="0.4" fill="none"/>
        </svg>
      </div>

      <svg
        ref={svgRef} width={svgDim.w} height={svgDim.h} viewBox={`0 0 ${W} ${H}`}
        onClick={addClick}
        onMouseDown={e => {
          if (e.button !== 0 || !spaceHeldRef.current) return;
          if ((e.target as Element).closest("[data-h]") || (e.target as Element).closest("[data-e]")) return;
          e.preventDefault();
          const startPts = livePtsRef.current.map(p => ({ ...p }));
          const sx = e.clientX, sy = e.clientY, s = scaleRef.current;
          const mv = (ev: MouseEvent) => {
            const dx = Math.round((ev.clientX - sx) / s), dy = Math.round((ev.clientY - sy) / s);
            const lp = startPts.map(p => ({ ...p, x: clamp(p.x + dx, 0, W), y: clamp(p.y + dy, 0, H) }));
            livePtsRef.current = lp; paintLive(lp);
          };
          const up = () => {
            pushHist(livePtsRef.current.map(p => ({ ...p })));
            document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up);
          };
          document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
        }}
        style={{ cursor: preview ? "default" : spaceHeld ? "grab" : "crosshair", position: "relative", zIndex: 1, filter: shFilter !== "none" ? shFilter : undefined, boxShadow: "0 0 0 1px rgba(129,140,248,.15), 0 8px 40px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3)", touchAction: "none" }}
      >
        <defs>
          {fillType === "linear" && (
            <linearGradient id="sbGrad" gradientUnits="objectBoundingBox" gradientTransform={`rotate(${gradAngle},0.5,0.5)`} x1="0" y1="0.5" x2="1" y2="0.5">
              {gradStops.map((s, i) => <stop key={i} offset={`${s.pos}%`} stopColor={s.color} />)}
            </linearGradient>
          )}
          {fillType === "radial" && (
            <radialGradient id="sbGrad" cx="50%" cy="50%" r="50%">
              {gradStops.map((s, i) => <stop key={i} offset={`${s.pos}%`} stopColor={s.color} />)}
            </radialGradient>
          )}
          {fillType === "metallic" && (
            <linearGradient id="sbGrad" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
              {gradStops.map((s, i) => <stop key={i} offset={`${s.pos}%`} stopColor={s.color} />)}
            </linearGradient>
          )}
        </defs>
        <path id="live-path" d={pathD} fill={pathFill} fillOpacity={op} stroke={sw > 0 ? sc : "none"} strokeWidth={sw} />

        {snapOn && !preview && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={W/2} y1={0} x2={W/2} y2={H} stroke="#818cf8" strokeWidth={0.7} strokeDasharray="4 4" opacity={0.15} />
            <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="#818cf8" strokeWidth={0.7} strokeDasharray="4 4" opacity={0.15} />
          </g>
        )}

        <g id="live-guides" style={{ pointerEvents: "none" }} />

        {!preview && pts.map((p, i) => {
          const nx = pts[(i + 1) % pts.length], mx = (p.x + nx.x) / 2, my = (p.y + nx.y) / 2;
          return (
            <g key={`e${i}`} data-e="1" onClick={ev => { ev.stopPropagation(); insertEdge(i); }} style={{ cursor: "pointer" }}
              onMouseEnter={ev => ev.currentTarget.querySelectorAll("circle,line").forEach((el) => ((el as HTMLElement).style.opacity = "1"))}
              onMouseLeave={ev => ev.currentTarget.querySelectorAll("circle,line").forEach((el) => ((el as HTMLElement).style.opacity = "0"))}>
              <circle cx={mx} cy={my} r={12} fill="rgba(255,255,255,.9)" stroke="#818cf8" strokeWidth={1.5} opacity={0} style={{ transition: "opacity .15s" }} />
              <line x1={mx-4} y1={my} x2={mx+4} y2={my} stroke="#818cf8" strokeWidth={2} strokeLinecap="round" opacity={0} style={{ transition: "opacity .15s" }} />
              <line x1={mx} y1={my-4} x2={mx} y2={my+4} stroke="#818cf8" strokeWidth={2} strokeLinecap="round" opacity={0} style={{ transition: "opacity .15s" }} />
            </g>
          );
        })}

        <g id="live-handles">
          {!preview && pts.map((p, i) => p.curve && (
            <g key={`c${i}`}>
              <line data-lo={i} x1={p.x} y1={p.y} x2={p.x+p.cx2} y2={p.y+p.cy2} stroke="rgba(129,140,248,.4)" strokeWidth={1.2} strokeDasharray="3 2" />
              <rect data-co={i} x={p.x+p.cx2-5} y={p.y+p.cy2-5} width={10} height={10}
                transform={`rotate(45,${p.x+p.cx2},${p.y+p.cy2})`}
                fill={selH?.idx===i&&selH?.which==="out"?"#818cf8":"#fff"} stroke="#818cf8" strokeWidth={1.5}
                data-h="1" style={{ cursor: "grab" }} onMouseDown={ev => dragCtrl(ev, i, "out")} />
              <line data-li={i} x1={p.x} y1={p.y} x2={p.x+p.cx1} y2={p.y+p.cy1} stroke="rgba(129,140,248,.4)" strokeWidth={1.2} strokeDasharray="3 2" />
              <rect data-ci={i} x={p.x+p.cx1-5} y={p.y+p.cy1-5} width={10} height={10}
                transform={`rotate(45,${p.x+p.cx1},${p.y+p.cy1})`}
                fill={selH?.idx===i&&selH?.which==="in"?"#818cf8":"#fff"} stroke="#818cf8" strokeWidth={1.5}
                data-h="1" style={{ cursor: "grab" }} onMouseDown={ev => dragCtrl(ev, i, "in")} />
            </g>
          ))}
          {!preview && pts.map((p, i) => (
            <g key={`a${i}`} data-ai={i} data-h="1"
              onMouseDown={ev => dragAnchor(ev, i)}
              onDoubleClick={ev => { ev.stopPropagation(); toggleCurve(i); }}
              onClick={ev => { ev.stopPropagation(); setSel(i); setSelH(null); }}
              onContextMenu={ev => { ev.preventDefault(); ev.stopPropagation(); setCtxMenu({ x: ev.clientX, y: ev.clientY, idx: i }); setSel(i); }}
              style={{ cursor: "grab" }}>
              <circle className="ah-outer" cx={p.x} cy={p.y} r={9} fill={sel===i?"#818cf8":"#fff"} stroke="#818cf8" strokeWidth={2} style={{ filter: "drop-shadow(0 1px 4px rgba(0,0,0,.18))" }} />
              <circle className="ah-inner" cx={p.x} cy={p.y} r={3.5} fill={sel===i?"#fff":"#818cf8"} />
              {(p.curve||p.r>0) && <circle cx={p.x} cy={p.y} r={2.5} fill="#ff9500" />}
              <text x={p.x+12} y={p.y-10} fontSize={9} fill="#aeaeb2" fontFamily="monospace">{i+1}</text>
            </g>
          ))}
        </g>
      </svg>

      <div id="guide-label" className="hidden absolute top-3 left-1/2 -translate-x-1/2 bg-sb-blue/90 text-white text-[10px] font-mono px-[10px] py-[3px] rounded-full pointer-events-none whitespace-nowrap" />

      {!isMobile && !preview && (
        <div className="absolute bottom-[14px] left-1/2 -translate-x-1/2 bg-[#0e0e1a]/80 backdrop-blur-lg border border-white/[.1] rounded-full px-[14px] py-1 text-[11px] text-sb-mid whitespace-nowrap pointer-events-none">
          {spaceHeld ? "Release Space to exit move mode" : "Click to add · Drag point · Double-click to curve · Hold Space to move shape · Right-click point for menu"}
        </div>
      )}
    </div>
  );

  // ─── Props panel ─────────────────────────────────────────────
  const PropsPanel = () => (
    <div className="overflow-y-auto flex-1">
      <Sec>
        <SecTitle>Presets</SecTitle>
        <div className="grid grid-cols-3 gap-[5px]">
          {PRESETS.map((p, i) => (
            <div key={i} onClick={() => applyPreset(i)}
              className={cn("aspect-square rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer p-1 transition-all duration-[140ms] border-[1.5px]",
                activeP === i ? "bg-sb-blue/20 border-sb-blue" : "bg-white/[.04] border-white/[.06]")}>
              <svg viewBox="0 0 400 400" width={28} height={28}>
                <path d={"M " + p.pts.map(([x, y]) => `${x},${y}`).join(" L ") + " Z"} fill={activeP === i ? "#818cf8" : "#94a3b8"} />
              </svg>
              <span className={cn("text-[9px] font-semibold", activeP === i ? "text-sb-blue" : "text-sb-mid")}>{p.name}</span>
            </div>
          ))}
        </div>
      </Sec>

      {!curves && (
        <Sec accent>
          <SecTitle>Corner Radius</SecTitle>
          <Slider label="All corners" value={globalR} min={0} max={100} unit="px"
            onChange={r => { setGlobalR(r); const a = pts.map(p => ({ ...p, r })); svgRef.current?.querySelector("#live-path")?.setAttribute("d", buildPath(a)); }}
            onCommit={r => { setGlobalR(r); pushHist(pts.map(p => ({ ...p, r }))); }} />
          {selPt && (
            <>
              <div className="text-[10px] text-sb-muted mb-[6px] -mt-1">Point {sel + 1} only</div>
              <Slider label="This corner" value={liveSelR} min={0} max={100} unit="px"
                onChange={r => { setLiveSelR(r); const a = pts.map(p => ({ ...p })); a[sel] = { ...a[sel], r }; svgRef.current?.querySelector("#live-path")?.setAttribute("d", buildPath(a)); }}
                onCommit={r => { setLiveSelR(r); setSelRadius(r); }} />
            </>
          )}
          <div className="text-[10px] text-sb-muted">Orange dot = rounded · Double-click point to bezier</div>
        </Sec>
      )}

      <Sec>
        <SecTitle>Fill</SecTitle>

        {/* Type tabs — visual gradient previews */}
        <div className="grid grid-cols-4 gap-[5px] mb-3">
          {(["solid","linear","radial","metallic"] as FillType[]).map(t => {
            const prev =
              t === "solid"    ? fill :
              t === "linear"   ? `linear-gradient(90deg, ${gradStops[0]?.color}, ${gradStops[gradStops.length-1]?.color})` :
              t === "radial"   ? `radial-gradient(circle, ${gradStops[0]?.color} 0%, ${gradStops[gradStops.length-1]?.color} 100%)` :
              gradCSSValue(METALLIC_PRESETS[1].stops, "metallic", 135);
            const active = fillType === t;
            return (
              <button key={t} onClick={() => setFillType(t)}
                className={cn("relative h-[48px] rounded-xl cursor-pointer border-[1.5px] transition-all duration-[150ms] overflow-hidden flex flex-col justify-end pb-[5px]",
                  active ? "border-sb-blue shadow-[0_0_12px_rgba(129,140,248,.35)]" : "border-white/[.08] hover:border-white/[.2]")}>
                <div className="absolute inset-0" style={{ background: prev }} />
                <div className="absolute inset-0" style={{ background: active ? "rgba(0,0,0,.25)" : "rgba(0,0,0,.45)" }} />
                <span className="relative text-[8px] font-bold uppercase tracking-widest text-white text-center w-full">{t}</span>
              </button>
            );
          })}
        </div>

        {/* Solid: large clickable swatch */}
        {fillType === "solid" && (
          <div className="mb-2">
            <div className="relative h-[52px] rounded-xl border border-white/[.08] mb-[7px] overflow-hidden cursor-pointer group transition-colors hover:border-white/[.2]"
              style={{ background: fill }}>
              <input type="color" value={fill} onChange={e => setFill(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-white/90 text-[10px] font-semibold drop-shadow">Click to change</span>
              </div>
            </div>
            <div className="flex items-center gap-2 px-[2px]">
              <div className="w-5 h-5 rounded-md border border-white/[.15] overflow-hidden shrink-0">
                <input type="color" value={fill} onChange={e => setFill(e.target.value)} className="w-full h-full border-none cursor-pointer" />
              </div>
              <span className="font-mono text-[11px] text-sb-mid">{fill.toUpperCase()}</span>
            </div>
          </div>
        )}

        {fillType !== "solid" && (<>
          {/* Metallic quick-start presets */}
          {fillType === "metallic" && (
            <div className="grid grid-cols-4 gap-[4px] mb-3">
              {METALLIC_PRESETS.map((m, i) => (
                <button key={i} title={m.name}
                  onClick={() => setGradStops(m.stops.map(s => ({ ...s })))}
                  className="h-[26px] rounded-lg cursor-pointer text-[8px] font-bold text-white border border-white/[.1] transition-all hover:scale-105 hover:border-white/[.3]"
                  style={{ background: gradCSSValue(m.stops, "metallic", 135), textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>
                  {m.name}
                </button>
              ))}
            </div>
          )}

          {/* Interactive gradient bar — click to add stop, drag handle to reposition */}
          <div className="relative mb-3 select-none" style={{ height: 58 }}>
            <div
              className="absolute rounded-xl border border-white/[.08]"
              style={{ top: 0, left: 8, right: 8, height: 36, background: gradCSSValue(gradStops, fillType, gradAngle), cursor: gradStops.length < 6 ? "crosshair" : "default" }}
              onClick={e => {
                if (gradStops.length >= 6) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = Math.round(Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)));
                const sorted = [...gradStops].sort((a, b) => a.pos - b.pos);
                const L = sorted.filter(s => s.pos <= pos).pop() ?? sorted[0];
                const R = sorted.find(s => s.pos > pos) ?? sorted[sorted.length - 1];
                let color = L.color;
                if (L !== R && R.pos > L.pos) {
                  const t = (pos - L.pos) / (R.pos - L.pos);
                  const hx = (h: string) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
                  const lc = hx(L.color), rc = hx(R.color);
                  const lp = (a: number, b: number) => Math.round(a + (b - a) * t);
                  color = "#" + [lp(lc[0],rc[0]), lp(lc[1],rc[1]), lp(lc[2],rc[2])].map(v => v.toString(16).padStart(2,"0")).join("");
                }
                setGradStops(ss => [...ss, { color, pos }]);
              }} />
            {/* Draggable stop handles */}
            {gradStops.map((stop, i) => (
              <div key={i}
                className="absolute flex flex-col items-center"
                style={{ bottom: 0, left: `calc(8px + (100% - 16px) * ${stop.pos / 100})`, transform: "translateX(-50%)", cursor: "ew-resize", zIndex: 2 }}
                onMouseDown={e => {
                  e.preventDefault(); e.stopPropagation();
                  const container = e.currentTarget.parentElement!;
                  const mv = (ev: MouseEvent) => {
                    const rect = container.getBoundingClientRect();
                    const pos = Math.round(Math.max(0, Math.min(100, (ev.clientX - rect.left - 8) / (rect.width - 16) * 100)));
                    setGradStops(ss => ss.map((s, j) => j === i ? { ...s, pos } : s));
                  };
                  const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
                  document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
                }}>
                <div className="w-px h-[8px] bg-white/40" />
                <div className="w-[16px] h-[16px] rounded-full border-2 border-white shadow-[0_2px_8px_rgba(0,0,0,.65)]"
                  style={{ background: stop.color }} />
              </div>
            ))}
          </div>

          {/* Stop rows — color + position number input */}
          <div className="flex flex-col gap-[4px] mb-2">
            {gradStops.map((stop, i) => (
              <div key={i} className="flex items-center gap-[6px] bg-white/[.03] rounded-lg px-[8px] py-[5px]">
                <div className="w-[20px] h-[20px] rounded-md border border-white/[.12] overflow-hidden shrink-0">
                  <input type="color" value={stop.color}
                    onChange={e => setGradStops(ss => ss.map((s, j) => j === i ? { ...s, color: e.target.value } : s))}
                    className="w-full h-full border-none cursor-pointer" />
                </div>
                <span className="text-[9px] font-mono text-sb-muted flex-1 truncate">{stop.color.toUpperCase()}</span>
                <input type="number" value={stop.pos} min={0} max={100}
                  onChange={e => setGradStops(ss => ss.map((s, j) => j === i ? { ...s, pos: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) } : s))}
                  className="w-[34px] h-[18px] rounded border border-white/[.12] bg-white/[.05] text-[9px] font-mono text-center text-sb-blue outline-none focus:border-sb-blue/60 px-0.5" />
                <span className="text-[9px] text-sb-muted">%</span>
                {gradStops.length > 2 && (
                  <button onClick={() => setGradStops(ss => ss.filter((_, j) => j !== i))}
                    className="w-[14px] h-[14px] flex items-center justify-center text-sb-muted cursor-pointer border-none bg-transparent shrink-0 hover:text-sb-red text-[14px] leading-none">×</button>
                )}
              </div>
            ))}
          </div>

          {gradStops.length < 6 && (
            <p className="text-[9px] text-sb-muted mb-2">Click the gradient bar to add a stop</p>
          )}

          {(fillType === "linear" || fillType === "metallic") && (
            <Slider label="Angle" value={gradAngle} min={0} max={360} unit="°"
              onChange={setGradAngle} onCommit={setGradAngle} />
          )}
        </>)}

        <Slider label="Opacity" value={fillOp} min={0} max={100} unit="%"
          onChange={v => { setFillOp(v); const el = svgRef.current?.querySelector<SVGPathElement>("#live-path"); if(el) el.setAttribute("fill-opacity", String(v/100)); }}
          onCommit={setFillOp} />
      </Sec>

      <Sec>
        <SecTitle>Stroke</SecTitle>
        <Slider label="Width" value={sw} min={0} max={20} unit="px"
          onChange={v => { setSw(v); const el = svgRef.current?.querySelector("#live-path"); if(el){ el.setAttribute("stroke", v > 0 ? sc : "none"); el.setAttribute("stroke-width", String(v)); } }}
          onCommit={setSw} />
        {sw > 0 && <ColorRow color={sc} onChange={setSc} />}
      </Sec>

      <Sec>
        <SecTitle>Shadow</SecTitle>
        <Slider label="Blur" value={shBlur} min={0} max={40} onChange={v => { setShBlur(v); applyFilter(v, shY, shOp); }} onCommit={setShBlur} />
        <Slider label="Y offset" value={shY} min={-20} max={40} unit="px" onChange={v => { setShY(v); applyFilter(shBlur, v, shOp); }} onCommit={setShY} />
        <Slider label="Opacity" value={shOp} min={0} max={100} unit="%" onChange={v => { setShOp(v); applyFilter(shBlur, shY, v); }} onCommit={setShOp} />
      </Sec>

      <Sec>
        <SecTitle>Transform</SecTitle>
        <Slider label="Rotate" value={rotate} min={-180} max={180} unit="°" onStart={startRotate} onChange={liveRotate} onCommit={commitRotate} />
        <div className="flex gap-[6px]">
          <button onClick={doFlipH} className={cn("flex-1 h-8 rounded-lg border border-white/[.12] cursor-pointer text-[11px] font-medium flex items-center justify-center gap-[5px] transition-all duration-[140ms]", flipH ? "bg-sb-blue/20 text-sb-blue" : "bg-white/[.06] text-sb-mid")}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 3v14M4 6l3 4-3 4M16 6l-3 4 3 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Flip H
          </button>
          <button onClick={doFlipV} className={cn("flex-1 h-8 rounded-lg border border-white/[.12] cursor-pointer text-[11px] font-medium flex items-center justify-center gap-[5px] transition-all duration-[140ms]", flipV ? "bg-sb-blue/20 text-sb-blue" : "bg-white/[.06] text-sb-mid")}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M3 10h14M6 4l4 3 4-3M6 16l4-3 4 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Flip V
          </button>
        </div>
        {rotate !== 0 && (
          <button onClick={() => {
              if (rotateBaseRef.current) {
                pushHist(rotateBaseRef.current.map(p => ({ ...p })));
                rotateBaseRef.current = null;
                rotateOriginRef.current = null;
              }
              setRotate(0);
            }} className="mt-[6px] w-full h-[26px] rounded-md border border-white/[.1] bg-transparent cursor-pointer text-[10px] text-sb-muted">
            Reset rotation
          </button>
        )}
      </Sec>

      <Sec noBorder>
        <SecTitle right={<Btn onClick={addCenter} className="!h-[22px] !px-[9px] !text-[10px]">+ Add</Btn>}>
          Points <span className="text-sb-blue ml-1">{pts.length}</span>
        </SecTitle>
        <div className="flex flex-col gap-[3px] max-h-[220px] overflow-y-auto">
          {pts.map((p, i) => (
            <div key={i} onClick={() => { setSel(i); setSelH(null); }}
              className={cn("flex items-center gap-[5px] px-2 py-[5px] rounded-lg cursor-pointer transition-all duration-[120ms] border-[1.5px]", sel === i ? "bg-sb-blue/20 border-sb-blue" : "bg-white/[.04] border-white/[.06]")}>
              <div className={cn("w-[7px] h-[7px] rounded-full shrink-0", (p.curve || p.r > 0) ? "bg-sb-orange" : "bg-sb-blue")} />
              <span className="text-[11px] font-medium flex-1">P{i + 1}</span>
              <span className="text-[9px] font-mono text-sb-muted">{p.x},{p.y}</span>
              {!curves && p.r > 0 && <span className="text-[9px] font-mono text-sb-orange">r{p.r}</span>}
              <button onClick={e => { e.stopPropagation(); toggleCurve(i); }} className={cn("w-5 h-4 rounded border border-white/[.12] bg-transparent cursor-pointer text-[9px]", p.curve ? "text-sb-orange" : "text-sb-mid")}>
                {p.curve ? "~" : "—"}
              </button>
              <button onClick={e => { e.stopPropagation(); delPt(i); }} className="w-[18px] h-[18px] rounded-full border-none bg-transparent cursor-pointer text-sb-muted text-sm flex items-center justify-center">×</button>
            </div>
          ))}
        </div>
      </Sec>
    </div>
  );

  // ─── Code panel ──────────────────────────────────────────────
  const CODE_TABS: { mode: CodeMode; label: string }[] = [
    { mode: "svg", label: "SVG" }, { mode: "css", label: "clip-path" },
    { mode: "tailwind", label: "Tailwind" },
  ];

  const CodePanel = () => (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-[14px] pt-3 pb-2 border-b border-white/[.07] shrink-0">
        <div className="flex items-center justify-between mb-[10px]">
          <div className="text-[13px] font-semibold bg-gradient-to-r from-sb-blue to-sb-orange bg-clip-text text-transparent">Output Code</div>
          <div className="flex items-center gap-[5px]">
            <span className="text-[10px] text-sb-muted">W</span>
            <input type="number" value={outW} min={1} max={9999}
              onChange={e => setOutW(Math.max(1, parseInt(e.target.value) || 400))}
              className="w-[52px] h-[22px] rounded-md border border-white/[.12] bg-white/[.05] text-[11px] font-mono text-center text-sb-mid outline-none focus:border-sb-blue/60 px-1" />
            <span className="text-[10px] text-sb-muted">H</span>
            <input type="number" value={outH} min={1} max={9999}
              onChange={e => setOutH(Math.max(1, parseInt(e.target.value) || 400))}
              className="w-[52px] h-[22px] rounded-md border border-white/[.12] bg-white/[.05] text-[11px] font-mono text-center text-sb-mid outline-none focus:border-sb-blue/60 px-1" />
          </div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {CODE_TABS.map(({ mode, label }) => (
            <button key={mode} onClick={() => setCodeMode(mode)}
              className={cn("px-[10px] py-1 rounded-full text-[11px] font-medium cursor-pointer transition-all",
                codeMode === mode ? "bg-sb-blue text-white border-none shadow-[0_0_10px_rgba(129,140,248,.4)]" : "bg-transparent text-sb-mid border-[1.5px] border-white/[.12]")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="rounded-xl overflow-hidden" style={{ background: "#060609", boxShadow: "0 0 0 1px rgba(129,140,248,.12), 0 4px 20px rgba(0,0,0,.4)" }}>
          <div className="h-[2px]" style={{ background: "linear-gradient(90deg, #818cf8, #f472b6, #34d399)" }} />
          <pre className="p-[14px] text-[10.5px] leading-[1.8] text-[#c8cfe8] whitespace-pre-wrap break-all m-0">{rawCode()}</pre>
        </div>
      </div>
      <div className="p-[10px] px-3 border-t border-white/[.07] shrink-0">
        <button onClick={doCopy} className="w-full h-[38px] rounded-xl bg-gradient-to-r from-sb-blue to-sb-orange text-white border-none text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-[6px] transition-all duration-150 hover:opacity-90" style={{ animation: "glow-pulse 2.8s ease-in-out infinite" }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="2" stroke="white" strokeWidth="1.5" /><path d="M3 11V3a2 2 0 012-2h8" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Copy Code
        </button>
      </div>
    </div>
  );

  const TABS: { id: PanelTab; icon: string; label: string }[] = [
    { id: "props", icon: "⊞", label: "Props" },
    { id: "canvas", icon: "◇", label: "Canvas" },
    { id: "code", icon: "</>", label: "Code" },
  ];

  return (
    <div className="font-sans bg-sb-light h-screen flex flex-col antialiased overflow-hidden">

      {/* Topbar */}
      <div className="h-[50px] flex items-center px-3 gap-2 bg-[#0e0e1a]/95 backdrop-blur-xl shrink-0 z-50 relative">
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent 0%, #818cf8 30%, #f472b6 70%, transparent 100%)" }} />
        <span className="font-bold text-[15px] tracking-[-0.4px] whitespace-nowrap text-white" style={{ filter: "drop-shadow(0 0 12px rgba(129,140,248,.55))" }}>
          Shape<span className="bg-gradient-to-r from-sb-blue to-sb-orange bg-clip-text text-transparent">Builder</span>
        </span>
        {!isMobile && <span className="w-px h-[18px] shrink-0" style={{ background: "linear-gradient(to bottom, #818cf8, #f472b6)" , opacity: 0.4 }} />}
        <div className="ml-auto flex gap-[5px] items-center">
          <Btn onClick={undoHist} disabled={!canUndo} title="Undo ⌘Z" className="!px-[9px]">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M4 7h9a5 5 0 010 10H7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M4 7l3-3M4 7l3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            {!isMobile && "Undo"}
          </Btn>
          <Btn onClick={redoHist} disabled={!canRedo} title="Redo ⌘⇧Z" className="!px-[9px]">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M16 7H7a5 5 0 000 10h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M16 7l-3-3M16 7l-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            {!isMobile && "Redo"}
          </Btn>
          <Btn onClick={() => setSnapOn(v => !v)} active={snapOn} title="Smart guides">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M10 2v16M2 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" /></svg>
            {!isMobile && "Snap"}
          </Btn>
          <Btn onClick={toggleAllCurves} active={curves}>
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M3 16 C3 16 6 4 10 10 S17 4 17 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            {!isMobile && (curves ? "Curves ON" : "Curves")}
          </Btn>
          <Btn onClick={() => setPreview(v => !v)} active={preview} title="Preview (hide handles)">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><ellipse cx="10" cy="10" rx="8" ry="5" stroke="currentColor" strokeWidth="1.7"/><circle cx="10" cy="10" r="2.5" fill="currentColor"/></svg>
            {!isMobile && "Preview"}
          </Btn>
          <Btn onClick={() => applyPreset(activeP)} title="Reset shape">↺</Btn>
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu !== null && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }} />
          <div className="fixed z-[100] min-w-[152px] rounded-xl overflow-hidden border border-white/[.1]"
            style={{ left: Math.min(ctxMenu.x, (winW || 800) - 168), top: ctxMenu.y, background: "linear-gradient(135deg, #0f0f22, #0a0a18)", boxShadow: "0 8px 32px rgba(0,0,0,.6), 0 0 0 1px rgba(129,140,248,.18)" }}>
            <div className="px-3 py-[7px] text-[9px] uppercase tracking-widest text-sb-muted border-b border-white/[.07] flex items-center gap-[6px]">
              <span className="inline-block w-[3px] h-[10px] rounded-full shrink-0" style={{ background: "linear-gradient(to bottom, #818cf8, #f472b6)" }} />
              Point {ctxMenu.idx + 1}
            </div>
            <button onClick={() => { toggleCurve(ctxMenu.idx); setCtxMenu(null); }}
              className="w-full text-left px-3 py-[9px] text-[12px] text-sb-mid hover:bg-white/[.06] cursor-pointer flex items-center gap-2 transition-colors">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M3 16 C3 16 6 4 10 10 S17 4 17 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
              {pts[ctxMenu.idx]?.curve ? "Set as corner" : "Set as curve"}
            </button>
            <button onClick={() => { dupPt(ctxMenu.idx); setCtxMenu(null); }}
              className="w-full text-left px-3 py-[9px] text-[12px] text-sb-mid hover:bg-white/[.06] cursor-pointer flex items-center gap-2 transition-colors">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><rect x="7" y="7" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M4 13V4a1 1 0 011-1h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Duplicate
            </button>
            <button onClick={() => {
                const cur = histStack.current[histIdx.current];
                if (cur.length > 3) { const a = cur.filter((_, j) => j !== ctxMenu.idx); pushHist(a); setSel(s => Math.min(s, a.length - 1)); setSelH(null); }
                setCtxMenu(null);
              }}
              className="w-full text-left px-3 py-[9px] text-[12px] text-sb-red hover:bg-sb-red/[.08] cursor-pointer flex items-center gap-2 transition-colors border-t border-white/[.05]">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
              Delete
            </button>
          </div>
        </>
      )}

      {/* Layout */}
      {!isMobile ? (
        <div className={cn("grid flex-1 min-h-0", isTablet ? "grid-cols-[220px_1fr]" : "grid-cols-[220px_1fr_288px]")}>
          <div className="border-r border-white/[.07] flex flex-col overflow-hidden" style={{ background: "linear-gradient(160deg, #0f0f22 0%, #0a0a16 100%)" }}>{PropsPanel()}</div>
          {Canvas()}
          {!isTablet && <div className="border-l border-white/[.07] flex flex-col overflow-hidden" style={{ background: "linear-gradient(200deg, #0a0a16 0%, #0f0f22 100%)" }}>{CodePanel()}</div>}
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {panel === "canvas" && <div className="flex-1 flex flex-col">{Canvas()}</div>}
          {panel === "props"  && <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "linear-gradient(160deg, #0f0f22 0%, #0a0a16 100%)" }}>{PropsPanel()}</div>}
          {panel === "code"   && <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "linear-gradient(200deg, #0a0a16 0%, #0f0f22 100%)" }}>{CodePanel()}</div>}
          <div className="h-14 bg-[#0e0e1a]/95 backdrop-blur-xl border-t border-white/[.07] flex shrink-0">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setPanel(t.id)}
                className={cn("flex-1 flex flex-col items-center justify-center gap-0.5 border-none bg-transparent cursor-pointer text-[10px] font-medium transition-colors duration-[140ms]", panel === t.id ? "text-sb-blue" : "text-sb-muted")}>
                <span className="text-lg leading-none">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
