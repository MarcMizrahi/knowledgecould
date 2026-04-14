import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { listDocuments, deleteDocument, type KnowledgeDoc } from "@/lib/api";
import { SOURCE_ICONS, formatDate } from "@/lib/utils";
import { X, MessageCircle, Search, Trash2, Plus, RefreshCw } from "lucide-react";

// ── Colour map ────────────────────────────────────────────────────────────────

// All knowledge points: soft blue. Tags (topics): warm gold spectrum.
const DOC_COLOR: [number, number, number] = [96, 165, 250];
const SUPERTAG_COLOR: [number, number, number] = [255, 200, 40]; // bright gold for domains
const TAG_COLOR: [number, number, number] = [251, 191, 36];       // gold for sub-topics
const DEF_COLOR: [number, number, number] = [96, 165, 250];

// ── Topic hierarchy ──────────────────────────────────────────────────────────
// Super-tags are large conceptual domains; sub-tags orbit within them.
const TAXONOMY: Record<string, string[]> = {
  "philosophy":      ["ethics", "epistemology", "aesthetics", "religion", "mythology"],
  "science":         ["biology", "physics", "mathematics", "space", "plants"],
  "technology":      ["AI", "ai", "deep-learning", "neural-networks", "computer-science", "computer-architecture"],
  "arts":            ["art", "photography", "cinema", "music", "architecture"],
  "literature":      ["french-literature", "poetry", "linguistics"],
  "social sciences": ["sociology", "psychology", "economics", "politics", "history", "education", "law", "journalism", "crime"],
};

// Build reverse lookup: child → parent
const CHILD_TO_PARENT = new Map<string, string>();
for (const [parent, children] of Object.entries(TAXONOMY)) {
  for (const child of children) {
    CHILD_TO_PARENT.set(child.toLowerCase(), parent);
  }
}

// ── 3-D maths ─────────────────────────────────────────────────────────────────

type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

const MAT3_ID: Mat3 = [1,0,0, 0,1,0, 0,0,1];

function mul3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0]*b[0]+a[1]*b[3]+a[2]*b[6], a[0]*b[1]+a[1]*b[4]+a[2]*b[7], a[0]*b[2]+a[1]*b[5]+a[2]*b[8],
    a[3]*b[0]+a[4]*b[3]+a[5]*b[6], a[3]*b[1]+a[4]*b[4]+a[5]*b[7], a[3]*b[2]+a[4]*b[5]+a[5]*b[8],
    a[6]*b[0]+a[7]*b[3]+a[8]*b[6], a[6]*b[1]+a[7]*b[4]+a[8]*b[7], a[6]*b[2]+a[7]*b[5]+a[8]*b[8],
  ];
}

function applyMat3(m: Mat3, x: number, y: number, z: number): [number, number, number] {
  return [m[0]*x+m[1]*y+m[2]*z, m[3]*x+m[4]*y+m[5]*z, m[6]*x+m[7]*y+m[8]*z];
}

function rotX(a: number): Mat3 { const c=Math.cos(a),s=Math.sin(a); return [1,0,0, 0,c,-s, 0,s,c]; }
function rotY(a: number): Mat3 { const c=Math.cos(a),s=Math.sin(a); return [c,0,s, 0,1,0, -s,0,c]; }

// ── Types ─────────────────────────────────────────────────────────────────────

interface SimNode {
  id: string; type: "doc" | "tag"; label: string;
  wx: number; wy: number; wz: number;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; az: number;
  radius: number; color: [number, number, number];
  doc?: KnowledgeDoc;
}

interface SimEdge { source: string; target: string; restLength: number; strong: boolean; }

interface Dust { x: number; y: number; r: number; alpha: number; speed: number; phase: number; }

interface Interaction {
  active: boolean;
  nodeId: string | null;
  lastMx: number; lastMy: number;
  hasMoved: boolean;
}

// ── Graph ─────────────────────────────────────────────────────────────────────

function buildGraph3D(docs: KnowledgeDoc[], sR: number): { nodes: SimNode[]; edges: SimEdge[] } {
  const nodes: SimNode[] = [];
  const edgeSet = new Set<string>();
  const edges: SimEdge[] = [];

  const addEdge = (a: string, b: string, rest: number, strong: boolean) => {
    const k = [a, b].sort().join("|");
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    edges.push({ source: a, target: b, restLength: rest, strong });
  };

  const tagIds = new Map<string, string>();
  const tagArr = [...new Set(docs.flatMap(d => d.tags))];
  const phi_g  = Math.PI * (3 - Math.sqrt(5));
  tagArr.forEach((tag, i) => {
    const t   = i / Math.max(tagArr.length, 1);
    const y   = 1 - t * 2;
    const r   = Math.sqrt(Math.max(0, 1 - y * y));
    const ang = phi_g * i;
    const rad = sR * 0.45;
    const id  = `tag:${tag}`;
    tagIds.set(tag, id);
    nodes.push({
      id, type: "tag", label: tag,
      wx: r * Math.cos(ang) * rad, wy: y * rad, wz: r * Math.sin(ang) * rad,
      vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0,
      radius: 8, color: TAG_COLOR,
    });
  });

  const N = Math.max(docs.length, 1);
  docs.forEach((doc, i) => {
    const color  = DOC_COLOR;
    const t      = i / N;
    const y      = 1 - t * 2;
    const r      = Math.sqrt(Math.max(0, 1 - y * y));
    const ang    = phi_g * i;
    const rad    = sR * (0.75 + Math.random() * 0.3);
    const id     = `doc:${doc.id}`;
    nodes.push({
      id, type: "doc", label: doc.title,
      wx: r * Math.cos(ang) * rad, wy: y * rad, wz: r * Math.sin(ang) * rad,
      vx: (Math.random()-.5)*.3, vy: (Math.random()-.5)*.3, vz: (Math.random()-.5)*.3,
      ax: 0, ay: 0, az: 0,
      radius: 5 + Math.min(doc.chunk_count / 10, 5),
      color, doc,
    });
    doc.tags.forEach(t2 => {
      const tid = tagIds.get(t2);
      if (tid) addEdge(id, tid, sR * 0.55, true);
    });
  });

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      if (docs[i].tags.some(t2 => docs[j].tags.includes(t2)))
        addEdge(`doc:${docs[i].id}`, `doc:${docs[j].id}`, sR * 0.65, false);
    }
  }

  const K = Math.min(3, nodes.length - 1);
  for (let i = 0; i < nodes.length; i++) {
    nodes
      .map((n, j) => ({ j, d: Math.hypot(n.wx-nodes[i].wx, n.wy-nodes[i].wy, n.wz-nodes[i].wz) }))
      .filter(x => x.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, K)
      .forEach(({ j }) => addEdge(nodes[i].id, nodes[j].id, sR * 0.6, false));
  }

  return { nodes, edges };
}

function buildDust(w: number, h: number): Dust[] {
  return Array.from({ length: 140 }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    r: Math.random() * 1.1 + 0.2,
    alpha: Math.random() * 0.3 + 0.04,
    speed: Math.random() * 0.25 + 0.04,
    phase: Math.random() * Math.PI * 2,
  }));
}

// ── Physics (3-D) ─────────────────────────────────────────────────────────────

function step3D(nodes: SimNode[], edges: SimEdge[], sR: number, damp = 1) {
  const map = new Map(nodes.map(n => [n.id, n]));
  nodes.forEach(n => { n.ax = 0; n.ay = 0; n.az = 0; });

  for (const e of edges) {
    const a = map.get(e.source), b = map.get(e.target);
    if (!a || !b) continue;
    const dx = b.wx-a.wx, dy = b.wy-a.wy, dz = b.wz-a.wz;
    const d  = Math.hypot(dx, dy, dz) || 0.001;
    const f  = (d - e.restLength) * 0.003 / d;
    a.ax += dx*f; a.ay += dy*f; a.az += dz*f;
    b.ax -= dx*f; b.ay -= dy*f; b.az -= dz*f;
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = b.wx-a.wx, dy = b.wy-a.wy, dz = b.wz-a.wz;
      const d  = Math.hypot(dx, dy, dz) || 0.001;
      const mn = (a.radius + b.radius) * 5 + 18;
      if (d < mn) {
        const f = ((mn-d)/mn) * 0.4 / d;
        a.ax -= dx*f; a.ay -= dy*f; a.az -= dz*f;
        b.ax += dx*f; b.ay += dy*f; b.az += dz*f;
      }
    }
  }

  nodes.forEach(n => {
    n.ax -= n.wx * 0.0003; n.ay -= n.wy * 0.0003; n.az -= n.wz * 0.0003;
    n.ax += (Math.random()-.5)*.018;
    n.ay += (Math.random()-.5)*.018;
    n.az += (Math.random()-.5)*.018;
    n.vx = (n.vx + n.ax) * 0.97;
    n.vy = (n.vy + n.ay) * 0.97;
    n.vz = (n.vz + n.az) * 0.97;
    const spd = Math.hypot(n.vx, n.vy, n.vz);
    if (spd > 1.0) { n.vx /= spd; n.vy /= spd; n.vz /= spd; }
    n.wx += n.vx * damp; n.wy += n.vy * damp; n.wz += n.vz * damp;
    const r = Math.hypot(n.wx, n.wy, n.wz);
    if (r > sR * 1.35) {
      const f = (r - sR * 1.35) * 0.04 / r;
      n.vx -= n.wx * f; n.vy -= n.wy * f; n.vz -= n.wz * f;
    }
  });
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function paint3D(
  ctx: CanvasRenderingContext2D,
  nodes: SimNode[],
  edges: SimEdge[],
  dust: Dust[],
  hoverId: string | null,
  selectId: string | null,
  linkedIds: Set<string>,
  rot: Mat3,
  sR: number,
  userScale: number,
  t: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const w   = ctx.canvas.width / dpr;
  const h   = ctx.canvas.height / dpr;
  const cx  = w / 2, cy = h / 2;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const d of dust) {
    const ox = Math.sin(t * d.speed + d.phase) * 2;
    const oy = Math.cos(t * d.speed * 0.7 + d.phase) * 1.5;
    ctx.beginPath();
    ctx.arc(d.x + ox, d.y + oy, d.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,180,255,${d.alpha})`;
    ctx.fill();
  }

  type Projected = {
    n: SimNode;
    sx: number; sy: number; sz: number;
    depth: number;
    active: boolean;
    linked: boolean;
  };

  const proj: Projected[] = nodes.map(n => {
    const [rx, ry, rz] = applyMat3(rot, n.wx, n.wy, n.wz);
    const depth = Math.max(0, Math.min(1, (rz + sR) / (2 * sR)));
    return {
      n,
      sx: cx + rx * userScale,
      sy: cy + ry * userScale,
      sz: rz,
      depth,
      active: n.id === hoverId || n.id === selectId,
      linked: linkedIds.has(n.id),
    };
  });

  proj.sort((a, b) => a.sz - b.sz);
  const projMap = new Map(proj.map(p => [p.n.id, p]));

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const e of edges) {
    const pa = projMap.get(e.source), pb = projMap.get(e.target);
    if (!pa || !pb) continue;
    const avgDepth = (pa.depth + pb.depth) / 2;
    const base     = e.strong ? 0.5 : 0.22;
    const alpha    = base * avgDepth;
    if (alpha < 0.015) continue;
    const g = ctx.createLinearGradient(pa.sx, pa.sy, pb.sx, pb.sy);
    g.addColorStop(0, `rgba(${pa.n.color},${alpha})`);
    g.addColorStop(1, `rgba(${pb.n.color},${alpha})`);
    ctx.beginPath(); ctx.moveTo(pa.sx, pa.sy); ctx.lineTo(pb.sx, pb.sy);
    ctx.strokeStyle = g;
    ctx.lineWidth   = e.strong ? 1.1 : 0.55;
    ctx.stroke();
  }

  for (const { n, sx, sy, depth, active, linked } of proj) {
    const [r, g, b] = n.color;
    const sz  = 0.35 + 0.65 * depth;
    const opa = 0.25 + 0.75 * depth;
    const rad = n.radius * sz;

    const glowMult  = active ? 8 : n.type === "tag" ? 6 : 5;
    const glowAlpha = (active ? 0.6 : n.type === "tag" ? 0.32 : 0.2) * opa;
    const gr = n.radius * glowMult * sz;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    glow.addColorStop(0,    `rgba(${r},${g},${b},${glowAlpha})`);
    glow.addColorStop(0.45, `rgba(${r},${g},${b},${glowAlpha * 0.25})`);
    glow.addColorStop(1,    `rgba(${r},${g},${b},0)`);
    ctx.beginPath(); ctx.arc(sx, sy, gr, 0, Math.PI * 2);
    ctx.fillStyle = glow; ctx.fill();

    const core = ctx.createRadialGradient(sx - rad * 0.3, sy - rad * 0.3, 0, sx, sy, rad);
    core.addColorStop(0,    `rgba(255,255,255,${0.98 * opa})`);
    core.addColorStop(0.35, `rgba(${r},${g},${b},${0.92 * opa})`);
    core.addColorStop(1,    `rgba(${r},${g},${b},${0.5 * opa})`);
    ctx.beginPath(); ctx.arc(sx, sy, rad, 0, Math.PI * 2);
    ctx.fillStyle = core; ctx.fill();

    if (n.type === "tag") {
      const s = rad * 2.8;
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.4 * opa})`;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(sx-s, sy); ctx.lineTo(sx+s, sy);
      ctx.moveTo(sx, sy-s); ctx.lineTo(sx, sy+s);
      ctx.stroke();
    }

    if (n.type === "tag" || active || linked) {
      const txt = n.label.length > 24 ? n.label.slice(0, 22) + "…" : n.label;
      const fs  = n.type === "tag" ? 11 : linked ? 10 : 10;
      ctx.font      = n.type === "tag" ? `bold ${fs}px system-ui,sans-serif` : `${fs}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      const labelOpa = active ? 1 : linked ? 0.9 : 0.8;
      ctx.fillStyle = `rgba(${r},${g},${b},${labelOpa * opa})`;
      ctx.fillText(txt, sx, sy + rad + 13);
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NebulaCanvas() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const nodesRef    = useRef<SimNode[]>([]);
  const edgesRef    = useRef<SimEdge[]>([]);
  const dustRef     = useRef<Dust[]>([]);
  const hoverRef    = useRef<string | null>(null);
  const selectRef   = useRef<string | null>(null);
  const docsRef     = useRef<KnowledgeDoc[]>([]);
  const rotRef      = useRef<Mat3>([...MAT3_ID] as Mat3);
  const angVelRef   = useRef({ rx: 0, ry: 0.0006 });
  const scaleRef    = useRef(1);
  const sphereRRef  = useRef(300);
  const interactRef = useRef<Interaction>({ active: false, nodeId: null, lastMx: 0, lastMy: 0, hasMoved: false });
  const holdingTagRef = useRef(false);
  const dampRef     = useRef(1); // 1 = full speed, 0 = stopped
  const rafRef      = useRef<number>(0);

  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [docs, setDocs]       = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  docsRef.current = docs;

  const project = useCallback((wx: number, wy: number, wz: number) => {
    const canvas = canvasRef.current!;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    const [rx, ry, rz] = applyMat3(rotRef.current, wx, wy, wz);
    return { sx: w/2 + rx * scaleRef.current, sy: h/2 + ry * scaleRef.current, sz: rz };
  }, []);

  const nodeAtScreen = useCallback((mx: number, my: number): SimNode | null => {
    const sR = sphereRRef.current;
    let best: SimNode | null = null, bestZ = -Infinity;
    for (const n of nodesRef.current) {
      const { sx, sy, sz } = project(n.wx, n.wy, n.wz);
      const depth  = Math.max(0, Math.min(1, (sz + sR) / (2 * sR)));
      const hitRad = n.radius * (0.35 + 0.65 * depth) + 8;
      if (Math.hypot(sx - mx, sy - my) < hitRad && sz > bestZ) { best = n; bestZ = sz; }
    }
    return best;
  }, [project]);

  const rebuild = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    const docCount = docsRef.current.length;
    // Scale sphere radius with document count so the nebula grows organically
    // Base size from viewport, then expand as more docs are added
    const baseSR = Math.min(w, h) * 0.38;
    const growthFactor = docCount <= 5 ? 1 : 1 + Math.log2(docCount / 5) * 0.35;
    const sR = baseSR * growthFactor;
    sphereRRef.current = sR;
    // Auto-zoom out so the whole nebula stays visible
    scaleRef.current = 1 / growthFactor;
    const { nodes, edges } = buildGraph3D(docsRef.current, sR);
    nodesRef.current = nodes;
    edgesRef.current = edges;
    dustRef.current  = buildDust(w, h);
  }, []);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try { setDocs(await listDocuments()); }
    catch { setDocs([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  useEffect(() => {
    rebuild();
    if (selectRef.current)
      setSelectedNode(nodesRef.current.find(x => x.id === selectRef.current) ?? null);
  }, [docs, rebuild]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = canvas.offsetWidth  * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      rebuild();
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = (t: number) => {
      // Dampen when holding a tag node
      if (holdingTagRef.current) {
        dampRef.current = Math.max(0, dampRef.current - 0.02);
      } else {
        dampRef.current = Math.min(1, dampRef.current + 0.03);
      }
      // Also dampen based on zoom level: more zoomed in → slower movement
      // scale range: 0.2 (zoomed out) to 5 (zoomed in). At scale=1 → full speed, scale=5 → stopped
      const zoomDamp = Math.max(0, 1 - Math.max(0, scaleRef.current - 1) / 4);
      const damp = dampRef.current * zoomDamp;

      const av = angVelRef.current;
      rotRef.current = mul3(rotY(av.ry * damp), rotRef.current);
      rotRef.current = mul3(rotX(av.rx * damp), rotRef.current);
      av.ry = av.ry * 0.96 + 0.0006 * (1 - Math.abs(av.ry) * 50);
      av.rx *= 0.94;

      step3D(nodesRef.current, edgesRef.current, sphereRRef.current, damp);
      // Compute linked node IDs for the selected node
      const linked = new Set<string>();
      const sel = selectRef.current;
      if (sel) {
        for (const e of edgesRef.current) {
          if (e.source === sel) linked.add(e.target);
          else if (e.target === sel) linked.add(e.source);
        }
      }

      paint3D(
        ctx, nodesRef.current, edgesRef.current, dustRef.current,
        hoverRef.current, selectRef.current, linked,
        rotRef.current, sphereRRef.current, scaleRef.current, t / 1000,
      );
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      scaleRef.current = Math.max(0.2, Math.min(5, scaleRef.current * factor));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [rebuild]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect   = canvasRef.current!.getBoundingClientRect();
    const mx     = e.clientX - rect.left, my = e.clientY - rect.top;
    const node   = nodeAtScreen(mx, my);
    hoverRef.current = node?.id ?? null;
    holdingTagRef.current = node?.type === "tag";
    interactRef.current = { active: true, nodeId: node?.id ?? null, lastMx: mx, lastMy: my, hasMoved: false };
    canvasRef.current!.style.cursor = node ? "pointer" : "grabbing";
  }, [nodeAtScreen]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx   = e.clientX - rect.left, my = e.clientY - rect.top;
    const ix   = interactRef.current;

    if (!ix.active) {
      const n = nodeAtScreen(mx, my);
      hoverRef.current = n?.id ?? null;
      canvasRef.current!.style.cursor = n ? "pointer" : "grab";
      return;
    }

    const dx = mx - ix.lastMx, dy = my - ix.lastMy;
    if (Math.hypot(dx, dy) > 2) ix.hasMoved = true;

    angVelRef.current.ry = dx * 0.007;
    angVelRef.current.rx = dy * 0.007;
    canvasRef.current!.style.cursor = "grabbing";

    ix.lastMx = mx; ix.lastMy = my;
  }, [nodeAtScreen]);

  const onPointerUp = useCallback(() => {
    holdingTagRef.current = false;
    const ix = interactRef.current;
    if (!ix.hasMoved && ix.nodeId) {
      const id    = ix.nodeId;
      const newId = id === selectRef.current ? null : id;
      selectRef.current = newId;
      setSelectedNode(newId ? (nodesRef.current.find(n => n.id === newId) ?? null) : null);
    }
    interactRef.current = { active: false, nodeId: null, lastMx: 0, lastMy: 0, hasMoved: false };
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
  }, []);

  const onPointerLeave = useCallback(() => {
    if (!interactRef.current.active) hoverRef.current = null;
  }, []);

  const handleDelete = async (docId: string) => {
    if (!confirm("Remove this document from your nebula?")) return;
    setDeleting(true);
    try {
      await deleteDocument(docId);
      selectRef.current = null;
      setSelectedNode(null);
      await loadDocs();
    } finally { setDeleting(false); }
  };

  return (
    <div className="relative w-full h-full select-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-muted-foreground text-sm animate-pulse tracking-widest">Mapping your nebula…</p>
        </div>
      )}

      {!loading && docs.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
          <p className="gradient-text text-3xl font-bold font-display">Your nebula is empty</p>
          <p className="text-muted-foreground text-sm">Upload documents to see them appear as stars</p>
          <Link
            to="/upload"
            className="pointer-events-auto px-5 py-2 rounded-lg bg-primary/20 border border-primary/30 text-primary text-sm hover:bg-primary/30 transition-colors"
          >
            Add your first document →
          </Link>
        </div>
      )}

      {/* Controls */}
      <div className="absolute top-3 left-3 flex gap-2">
        <button onClick={loadDocs} className="glass rounded-lg p-2 text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
          <RefreshCw size={14} />
        </button>
        <Link to="/upload" className="glass rounded-lg p-2 text-muted-foreground hover:text-foreground transition-colors" title="Add document">
          <Plus size={14} />
        </Link>
      </div>

      {!loading && docs.length > 0 && (
        <div className="absolute bottom-4 left-4 pointer-events-none">
          <p className="text-[11px] text-muted-foreground/50">
            {docs.length} stars · drag to spin · scroll to zoom · click a star to explore
          </p>
        </div>
      )}

      {!loading && docs.length > 0 && (
        <div className="absolute bottom-4 right-4 flex flex-col gap-1 pointer-events-none">
          {[...new Set(docs.map(d => d.source_type))].map(t => (
            <div key={t} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
              <span>{SOURCE_ICONS[t]}</span><span className="capitalize">{t}</span>
            </div>
          ))}
        </div>
      )}

      {/* Info panel */}
      {selectedNode && (
        <div className="absolute top-3 right-3 w-72 glass rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{selectedNode.label}</p>
              {selectedNode.type === "doc" && selectedNode.doc && (
                <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                  {SOURCE_ICONS[selectedNode.doc.source_type]} {selectedNode.doc.source_type}
                  {" · "}{selectedNode.doc.chunk_count} chunks
                </p>
              )}
              {selectedNode.type === "tag" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tag · {docs.filter(d => d.tags.includes(selectedNode.label)).length} documents
                </p>
              )}
            </div>
            <button onClick={() => { selectRef.current = null; setSelectedNode(null); }} className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5">
              <X size={14} />
            </button>
          </div>

          {selectedNode.type === "doc" && selectedNode.doc && (
            <>
              {selectedNode.doc.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedNode.doc.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded-full text-[10px] bg-primary/20 text-primary border border-primary/25">{t}</span>
                  ))}
                </div>
              )}
              {selectedNode.doc.content_preview && (
                <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{selectedNode.doc.content_preview}</p>
              )}
              <p className="text-[10px] text-muted-foreground/60">Added {formatDate(selectedNode.doc.created_at)}</p>
              <div className="flex gap-2">
                <Link to="/chat" search={{ doc: selectedNode.doc.id }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary/20 border border-primary/30 text-primary text-xs hover:bg-primary/30 transition-colors">
                  <MessageCircle size={11} /> Chat
                </Link>
                <Link to="/search" search={{ doc: selectedNode.doc.id }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-nebula-blue/20 border border-nebula-blue/30 text-nebula-blue text-xs hover:bg-nebula-blue/30 transition-colors">
                  <Search size={11} /> Search
                </Link>
                <button onClick={() => handleDelete(selectedNode.doc!.id)} disabled={deleting} className="px-2.5 py-1.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs hover:bg-destructive/20 transition-colors disabled:opacity-50">
                  <Trash2 size={11} />
                </button>
              </div>
            </>
          )}

          {selectedNode.type === "tag" && (
            <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
              {docs.filter(d => d.tags.includes(selectedNode.label)).map(d => (
                <button
                  key={d.id}
                  onClick={() => {
                    const n = nodesRef.current.find(x => x.id === `doc:${d.id}`);
                    if (n) { selectRef.current = n.id; setSelectedNode(n); }
                  }}
                  className="text-left text-xs text-muted-foreground hover:text-foreground py-1 px-2 rounded hover:bg-accent/10 transition-colors truncate"
                >
                  {SOURCE_ICONS[d.source_type]} {d.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
