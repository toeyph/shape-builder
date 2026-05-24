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
type CodeMode = "svg" | "css" | "mask" | "tailwind";
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

const genSVG = (pts: Point[], fill: string, op: number, sw: number, sc: string, g?: GradParams) => {
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">\n${defs}  <path d="${buildPath(pts)}" fill="${fillStr}"${opAttr}${sw > 0 ? ` stroke="${sc}" stroke-width="${sw}"` : ""}/>\n</svg>`;
};

const genCSS = (pts: Point[], fill: string, op: number, sw: number, sc: string, g?: GradParams) => {
  const bg = g ? gradCSSValue(g.stops, g.fillType, g.gradAngle) : (op < 1 ? hexRgba(fill, op) : fill);
  const opProp = g && op < 1 ? `\n  opacity: ${op.toFixed(2)};` : "";
  return `.my-shape {\n  clip-path: ${genClip(pts)};\n  background: ${bg};${opProp}${sw > 0 ? `\n  outline: ${sw}px solid ${sc};` : ""}\n}`;
};

const genMask = (pts: Point[], fill: string, op: number, g?: GradParams) => {
  const bg = g ? gradCSSValue(g.stops, g.fillType, g.gradAngle) : (op < 1 ? hexRgba(fill, op) : fill);
  const opProp = g && op < 1 ? `\n  opacity: ${op.toFixed(2)};` : "";
  return `.my-shape {\n  width:400px; height:400px;\n  background:${bg};${opProp}\n  mask:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><path d='${buildPath(pts)}'/></svg>") center/cover;\n}`;
};

const genTW = (pts: Point[], fill: string, g?: GradParams) => {
  if (g) {
    const css = gradCSSValue(g.stops, g.fillType, g.gradAngle).replace(/\s/g, "_");
    return `className="[clip-path:'${genClip(pts)}'] w-[400px] h-[400px] [background:${css}]"`;
  }
  return `className="[clip-path:'${genClip(pts)}'] w-[400px] h-[400px] bg-[${fill}]"`;
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
    x = sx; guides.push({ axis: "x", value: sx, center: sx === W / 2 || sx === H / 2 });
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
      "h-[30px] px-[11px] rounded-full border border-black/[.12] text-xs font-medium",
      "inline-flex items-center gap-[5px] whitespace-nowrap transition-all duration-[140ms]",
      active ? "bg-sb-blue text-white" : "bg-white text-sb-dark",
      disabled ? "opacity-50 cursor-not-allowed text-sb-muted" : "cursor-pointer",
      className,
    )}
  >
    {children}
  </button>
);

interface SliderProps {
  label: string; value: number; min: number; max: number;
  step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; unit?: string;
}
const Slider = ({ label, value, min, max, step = 1, onChange, onCommit, unit = "" }: SliderProps) => {
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
            className="w-[50px] text-right font-mono text-[11px] text-sb-blue border-[1.5px] border-sb-blue rounded-[5px] px-[5px] py-px outline-none bg-white"
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
        onChange={e => { onChange(+e.target.value); setDraft(String(+e.target.value)); }}
        onPointerUp={e => onCommit && onCommit(+(e.target as HTMLInputElement).value)}
        className="w-full cursor-ew-resize"
      />
    </div>
  );
};

const ColorRow = ({ color, onChange }: { color: string; onChange: (c: string) => void }) => (
  <div className="flex gap-2 items-center mb-[10px]">
    <div className="w-7 h-7 rounded-md border-[1.5px] border-black/[.15] overflow-hidden shrink-0">
      <input type="color" value={color} onChange={e => onChange(e.target.value)} className="w-full h-full border-none cursor-pointer" />
    </div>
    <span className="font-mono text-[11px] text-sb-mid">{color}</span>
  </div>
);

interface SecProps { children: React.ReactNode; noBorder?: boolean; accent?: boolean; }
const Sec = ({ children, noBorder, accent }: SecProps) => (
  <div className={cn(
    "px-4 py-[14px]",
    !noBorder && "border-b border-black/[.07]",
    accent && "border-l-[3px] border-l-sb-orange bg-sb-orange/[.04]",
  )}>
    {children}
  </div>
);

const SecTitle = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex items-center justify-between mb-[10px]">
    <span className="text-[10px] font-semibold tracking-[0.5px] uppercase text-sb-muted">{children}</span>
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
  const [fill, setFill]         = useState("#0071e3");
  const [fillOp, setFillOp]     = useState(100);
  const [fillType, setFillType] = useState<FillType>("solid");
  const [gradStops, setGradStops] = useState<GradStop[]>([
    { color: "#0071e3", pos: 0 },
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

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undoHist(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redoHist(); }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [undoHist, redoHist]);

  // ─── Transform helpers ───────────────────────────────────────
  const doFlipH = () => {
    setFlipH(v => !v);
    pushHist(pts.map(p => ({ ...p, x: Math.round(2 * (W / 2) - p.x) })));
  };
  const doFlipV = () => {
    setFlipV(v => !v);
    pushHist(pts.map(p => ({ ...p, y: Math.round(2 * (H / 2) - p.y) })));
  };
  const applyRotate = (deg: number) => {
    setRotate(deg);
    const rad = (deg * Math.PI) / 180, cx = W / 2, cy = H / 2;
    pushHist(pts.map(p => {
      const dx = p.x - cx, dy = p.y - cy;
      return { ...p, x: Math.round(cx + dx * Math.cos(rad) - dy * Math.sin(rad)), y: Math.round(cy + dx * Math.sin(rad) + dy * Math.cos(rad)) };
    }));
  };

  const applyPreset = (i: number) => {
    setActiveP(i); setCurves(false); setSel(-1); setSelH(null); setGlobalR(0);
    const raw = PRESETS[i].pts.map(([x, y]) => mkPt(x, y, 0));
    resetHist(raw.map((_, j) => autoH(raw, j)));
  };

  const addClick = (e: React.MouseEvent<SVGSVGElement>) => {
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
      const col = g.center ? "#ff3b30" : "#0071e3";
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
    if (codeMode === "svg")      return genSVG(pts, fill, op, sw, sc, g);
    if (codeMode === "css")      return genCSS(pts, fill, op, sw, sc, g);
    if (codeMode === "mask")     return genMask(pts, fill, op, g);
    return genTW(pts, fill, g);
  };

  const doCopy = () => {
    navigator.clipboard.writeText(rawCode()).then(() => {
      Toast.fire({ icon: "success", title: "Copied to clipboard!" });
    });
  };

  const pathD = buildPath(pts);
  const pathFill = fillType === "solid" ? fill : "url(#sbGrad)";
  const shFilter = (shBlur > 0 || shY !== 0) ? `drop-shadow(0 ${shY}px ${shBlur}px rgba(0,0,0,${(shOp / 100).toFixed(2)}))` : "none";
  const selPt = sel >= 0 && sel < pts.length ? pts[sel] : null;

  // ─── Canvas ──────────────────────────────────────────────────
  const Canvas = () => (
    <div ref={areaRef} className="flex-1 bg-sb-light relative overflow-hidden flex items-center justify-center" style={{ minHeight: isMobile ? 280 : 0 }}>
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(0,0,0,.032) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.032) 1px,transparent 1px)", backgroundSize: "20px 20px" }} />

      <svg
        ref={svgRef} width={svgDim.w} height={svgDim.h} viewBox={`0 0 ${W} ${H}`}
        onClick={addClick}
        style={{ cursor: "crosshair", position: "relative", zIndex: 1, filter: shFilter !== "none" ? shFilter : undefined, boxShadow: "0 6px 24px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.08)", touchAction: "none" }}
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

        {snapOn && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={W/2} y1={0} x2={W/2} y2={H} stroke="#0071e3" strokeWidth={0.7} strokeDasharray="4 4" opacity={0.15} />
            <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="#0071e3" strokeWidth={0.7} strokeDasharray="4 4" opacity={0.15} />
          </g>
        )}

        <g id="live-guides" style={{ pointerEvents: "none" }} />

        {pts.map((p, i) => {
          const nx = pts[(i + 1) % pts.length], mx = (p.x + nx.x) / 2, my = (p.y + nx.y) / 2;
          return (
            <g key={`e${i}`} data-e="1" onClick={ev => { ev.stopPropagation(); insertEdge(i); }} style={{ cursor: "pointer" }}
              onMouseEnter={ev => ev.currentTarget.querySelectorAll("circle,line").forEach((el) => ((el as HTMLElement).style.opacity = "1"))}
              onMouseLeave={ev => ev.currentTarget.querySelectorAll("circle,line").forEach((el) => ((el as HTMLElement).style.opacity = "0"))}>
              <circle cx={mx} cy={my} r={12} fill="rgba(255,255,255,.9)" stroke="#0071e3" strokeWidth={1.5} opacity={0} style={{ transition: "opacity .15s" }} />
              <line x1={mx-4} y1={my} x2={mx+4} y2={my} stroke="#0071e3" strokeWidth={2} strokeLinecap="round" opacity={0} style={{ transition: "opacity .15s" }} />
              <line x1={mx} y1={my-4} x2={mx} y2={my+4} stroke="#0071e3" strokeWidth={2} strokeLinecap="round" opacity={0} style={{ transition: "opacity .15s" }} />
            </g>
          );
        })}

        <g id="live-handles">
          {pts.map((p, i) => p.curve && (
            <g key={`c${i}`}>
              <line data-lo={i} x1={p.x} y1={p.y} x2={p.x+p.cx2} y2={p.y+p.cy2} stroke="rgba(0,113,227,.4)" strokeWidth={1.2} strokeDasharray="3 2" />
              <rect data-co={i} x={p.x+p.cx2-5} y={p.y+p.cy2-5} width={10} height={10}
                transform={`rotate(45,${p.x+p.cx2},${p.y+p.cy2})`}
                fill={selH?.idx===i&&selH?.which==="out"?"#0071e3":"#fff"} stroke="#0071e3" strokeWidth={1.5}
                data-h="1" style={{ cursor: "grab" }} onMouseDown={ev => dragCtrl(ev, i, "out")} />
              <line data-li={i} x1={p.x} y1={p.y} x2={p.x+p.cx1} y2={p.y+p.cy1} stroke="rgba(0,113,227,.4)" strokeWidth={1.2} strokeDasharray="3 2" />
              <rect data-ci={i} x={p.x+p.cx1-5} y={p.y+p.cy1-5} width={10} height={10}
                transform={`rotate(45,${p.x+p.cx1},${p.y+p.cy1})`}
                fill={selH?.idx===i&&selH?.which==="in"?"#0071e3":"#fff"} stroke="#0071e3" strokeWidth={1.5}
                data-h="1" style={{ cursor: "grab" }} onMouseDown={ev => dragCtrl(ev, i, "in")} />
            </g>
          ))}
          {pts.map((p, i) => (
            <g key={`a${i}`} data-ai={i} data-h="1"
              onMouseDown={ev => dragAnchor(ev, i)}
              onDoubleClick={ev => { ev.stopPropagation(); toggleCurve(i); }}
              onClick={ev => { ev.stopPropagation(); setSel(i); setSelH(null); }}
              style={{ cursor: "grab" }}>
              <circle className="ah-outer" cx={p.x} cy={p.y} r={9} fill={sel===i?"#0071e3":"#fff"} stroke="#0071e3" strokeWidth={2} style={{ filter: "drop-shadow(0 1px 4px rgba(0,0,0,.18))" }} />
              <circle className="ah-inner" cx={p.x} cy={p.y} r={3.5} fill={sel===i?"#fff":"#0071e3"} />
              {(p.curve||p.r>0) && <circle cx={p.x} cy={p.y} r={2.5} fill="#ff9500" />}
              <text x={p.x+12} y={p.y-10} fontSize={9} fill="#aeaeb2" fontFamily="monospace">{i+1}</text>
            </g>
          ))}
        </g>
      </svg>

      <div id="guide-label" className="hidden absolute top-3 left-1/2 -translate-x-1/2 bg-sb-blue/90 text-white text-[10px] font-mono px-[10px] py-[3px] rounded-full pointer-events-none whitespace-nowrap" />

      {!isMobile && (
        <div className="absolute bottom-[14px] left-1/2 -translate-x-1/2 bg-white/88 backdrop-blur-lg border border-black/[.1] rounded-full px-[14px] py-1 text-[11px] text-sb-mid whitespace-nowrap pointer-events-none">
          Click to add · Drag to move · Double-click to toggle curve
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
                activeP === i ? "bg-sb-blue/10 border-sb-blue" : "bg-sb-light border-transparent")}>
              <svg viewBox="0 0 400 400" width={28} height={28}>
                <path d={"M " + p.pts.map(([x, y]) => `${x},${y}`).join(" L ") + " Z"} fill={activeP === i ? "#0071e3" : "#636366"} />
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
              <Slider label="This corner" value={selPt.r || 0} min={0} max={100} unit="px"
                onChange={r => { const a = pts.map(p => ({ ...p })); a[sel] = { ...a[sel], r }; svgRef.current?.querySelector("#live-path")?.setAttribute("d", buildPath(a)); }}
                onCommit={r => setSelRadius(r)} />
            </>
          )}
          <div className="text-[10px] text-sb-muted">Orange dot = rounded · Double-click point to bezier</div>
        </Sec>
      )}

      <Sec>
        <SecTitle>Fill</SecTitle>

        {/* Type tabs */}
        <div className="flex gap-[4px] mb-[10px] flex-wrap">
          {(["solid","linear","radial","metallic"] as FillType[]).map(t => (
            <button key={t} onClick={() => setFillType(t)}
              className={cn("h-[22px] px-[8px] rounded-full text-[10px] font-medium cursor-pointer border transition-all duration-[120ms]",
                fillType === t ? "bg-sb-blue text-white border-sb-blue" : "bg-transparent text-sb-mid border-black/[.15]")}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {fillType === "solid" && <ColorRow color={fill} onChange={setFill} />}

        {fillType !== "solid" && (<>
          {/* Metallic quick-start presets */}
          {fillType === "metallic" && (
            <div className="grid grid-cols-4 gap-[4px] mb-[10px]">
              {METALLIC_PRESETS.map((m, i) => (
                <button key={i} title={m.name}
                  onClick={() => setGradStops(m.stops.map(s => ({ ...s })))}
                  className="h-[22px] rounded-md cursor-pointer text-[8px] font-bold text-white border border-black/[.12] transition-all hover:scale-105"
                  style={{ background: gradCSSValue(m.stops, "metallic", 135), textShadow: "0 1px 2px rgba(0,0,0,.55)" }}>
                  {m.name}
                </button>
              ))}
            </div>
          )}

          {/* Live gradient preview */}
          <div className="h-[26px] rounded-[8px] mb-[10px] border border-black/[.08]"
            style={{ background: gradCSSValue(gradStops, fillType, gradAngle) }} />

          {/* Stop rows */}
          {gradStops.map((stop, i) => (
            <div key={i} className="flex items-center gap-[5px] mb-[7px]">
              <div className="w-[22px] h-[22px] rounded-[5px] border-[1.5px] border-black/[.15] overflow-hidden shrink-0">
                <input type="color" value={stop.color}
                  onChange={e => setGradStops(ss => ss.map((s, j) => j === i ? { ...s, color: e.target.value } : s))}
                  className="w-full h-full border-none cursor-pointer" />
              </div>
              <input type="range" min={0} max={100} value={stop.pos}
                onChange={e => setGradStops(ss => ss.map((s, j) => j === i ? { ...s, pos: +e.target.value } : s))}
                className="flex-1 cursor-ew-resize" />
              <span className="text-[9px] font-mono text-sb-muted w-[26px] text-right shrink-0">{stop.pos}%</span>
              {gradStops.length > 2 && (
                <button onClick={() => setGradStops(ss => ss.filter((_, j) => j !== i))}
                  className="w-[14px] h-[14px] flex items-center justify-center text-sb-muted text-sm cursor-pointer border-none bg-transparent shrink-0 hover:text-sb-red leading-none">×</button>
              )}
            </div>
          ))}

          {gradStops.length < 6 && (
            <button onClick={() => {
              const sorted = [...gradStops].sort((a, b) => a.pos - b.pos);
              let maxGap = -1, insertAt = 0;
              for (let k = 0; k < sorted.length - 1; k++) {
                const gap = sorted[k+1].pos - sorted[k].pos;
                if (gap > maxGap) { maxGap = gap; insertAt = k; }
              }
              const bef = sorted[insertAt], aft = sorted[insertAt + 1];
              setGradStops(ss => [...ss, { color: bef.color, pos: Math.round((bef.pos + aft.pos) / 2) }]);
            }}
              className="text-[10px] text-sb-blue cursor-pointer bg-transparent border-none mb-[6px] hover:underline w-full text-left">
              + Add stop
            </button>
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
        <Slider label="Rotate" value={rotate} min={-180} max={180} unit="°" onChange={applyRotate} onCommit={applyRotate} />
        <div className="flex gap-[6px]">
          <button onClick={doFlipH} className={cn("flex-1 h-8 rounded-lg border border-black/[.12] cursor-pointer text-[11px] font-medium flex items-center justify-center gap-[5px] transition-all duration-[140ms]", flipH ? "bg-sb-blue/10 text-sb-blue" : "bg-sb-light text-sb-mid")}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 3v14M4 6l3 4-3 4M16 6l-3 4 3 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Flip H
          </button>
          <button onClick={doFlipV} className={cn("flex-1 h-8 rounded-lg border border-black/[.12] cursor-pointer text-[11px] font-medium flex items-center justify-center gap-[5px] transition-all duration-[140ms]", flipV ? "bg-sb-blue/10 text-sb-blue" : "bg-sb-light text-sb-mid")}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M3 10h14M6 4l4 3 4-3M6 16l4-3 4 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Flip V
          </button>
        </div>
        {rotate !== 0 && (
          <button onClick={() => { applyRotate(0); setRotate(0); }} className="mt-[6px] w-full h-[26px] rounded-md border border-black/[.1] bg-transparent cursor-pointer text-[10px] text-sb-muted">
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
              className={cn("flex items-center gap-[5px] px-2 py-[5px] rounded-lg cursor-pointer transition-all duration-[120ms] border-[1.5px]", sel === i ? "bg-sb-blue/10 border-sb-blue" : "bg-sb-light border-transparent")}>
              <div className={cn("w-[7px] h-[7px] rounded-full shrink-0", (p.curve || p.r > 0) ? "bg-sb-orange" : "bg-sb-blue")} />
              <span className="text-[11px] font-medium flex-1">P{i + 1}</span>
              <span className="text-[9px] font-mono text-sb-muted">{p.x},{p.y}</span>
              {!curves && p.r > 0 && <span className="text-[9px] font-mono text-sb-orange">r{p.r}</span>}
              <button onClick={e => { e.stopPropagation(); toggleCurve(i); }} className={cn("w-5 h-4 rounded border border-black/[.12] bg-transparent cursor-pointer text-[9px]", p.curve ? "text-sb-orange" : "text-sb-mid")}>
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
    { mode: "mask", label: "CSS mask" }, { mode: "tailwind", label: "Tailwind" },
  ];

  const CodePanel = () => (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-[14px] pt-3 pb-2 border-b border-black/[.07] shrink-0">
        <div className="text-[13px] font-semibold mb-[10px]">Output Code</div>
        <div className="flex gap-1 flex-wrap">
          {CODE_TABS.map(({ mode, label }) => (
            <button key={mode} onClick={() => setCodeMode(mode)}
              className={cn("px-[10px] py-1 rounded-full text-[11px] font-medium cursor-pointer transition-all",
                codeMode === mode ? "bg-sb-blue text-white border-none" : "bg-transparent text-sb-mid border-[1.5px] border-black/[.12]")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <pre className="bg-sb-dark rounded-xl p-[14px] text-[10.5px] leading-[1.8] text-[#d1d1d6] whitespace-pre-wrap break-all m-0">{rawCode()}</pre>
      </div>
      <div className="p-[10px] px-3 border-t border-black/[.07] shrink-0">
        <button onClick={doCopy} className="w-full h-[38px] rounded-xl bg-sb-blue hover:bg-[#0065cc] text-white border-none text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-[6px] transition-all duration-150">
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
      <div className="h-[50px] flex items-center px-3 gap-2 bg-white/[.92] backdrop-blur-xl border-b border-black/[.07] shrink-0 z-50">
        <span className="font-bold text-[15px] tracking-[-0.4px] whitespace-nowrap">
          Shape<span className="text-sb-blue">Builder</span>
        </span>
        {!isMobile && <span className="w-px h-[18px] bg-black/[.12] shrink-0" />}
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
          <Btn onClick={() => applyPreset(activeP)} title="Reset shape">↺</Btn>
          <Btn onClick={doCopy} active>
            {!isMobile && "Copy"}
          </Btn>
        </div>
      </div>

      {/* Layout */}
      {!isMobile ? (
        <div className={cn("grid flex-1 min-h-0", isTablet ? "grid-cols-[220px_1fr]" : "grid-cols-[220px_1fr_288px]")}>
          <div className="bg-white border-r border-black/[.07] flex flex-col overflow-hidden">{PropsPanel()}</div>
          {Canvas()}
          {!isTablet && <div className="bg-white border-l border-black/[.07] flex flex-col overflow-hidden">{CodePanel()}</div>}
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {panel === "canvas" && <div className="flex-1 flex flex-col">{Canvas()}</div>}
          {panel === "props"  && <div className="flex-1 bg-white flex flex-col overflow-hidden">{PropsPanel()}</div>}
          {panel === "code"   && <div className="flex-1 bg-white flex flex-col overflow-hidden">{CodePanel()}</div>}
          <div className="h-14 bg-white/[.92] backdrop-blur-xl border-t border-black/[.07] flex shrink-0">
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
