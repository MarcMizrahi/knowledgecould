import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { listDocuments, deleteDocument, type KnowledgeDoc } from "@/lib/api";
import { SOURCE_ICONS, formatDate } from "@/lib/utils";
import { X, MessageCircle, Search, Trash2, Plus, RefreshCw, ArrowLeft } from "lucide-react";

// ── Colour map ────────────────────────────────────────────────────────────────

// All knowledge points: soft blue. Tags (topics): warm gold spectrum.
const DOC_COLOR: [number, number, number] = [96, 165, 250];
const SUPERTAG_COLOR: [number, number, number] = [255, 200, 40]; // bright gold for domains
const TAG_COLOR: [number, number, number] = [251, 191, 36];       // gold for sub-topics
const DEF_COLOR: [number, number, number] = [96, 165, 250];

// ── Auto-derived topic hierarchy ──────────────────────────────────────────────
// Derives parent-child relationships from tag co-occurrence in documents.
// A tag becomes a "supertag" if it has many docs. A smaller tag becomes its
// child if most of its docs also carry the larger tag (high co-occurrence ratio).

function deriveTaxonomy(docs: KnowledgeDoc[]): {
  supertagNames: Set<string>;
  subtagToSuper: Map<string, string>;
  orphanTags: Set<string>;
} {
  // Count docs per tag
  const tagDocs = new Map<string, Set<string>>();
  for (const doc of docs) {
    for (const tag of doc.tags) {
      if (!tagDocs.has(tag)) tagDocs.set(tag, new Set());
      tagDocs.get(tag)!.add(doc.id);
    }
  }

  const allTags = [...tagDocs.keys()];
  if (allTags.length === 0) return { supertagNames: new Set(), subtagToSuper: new Map(), orphanTags: new Set() };

  // Sort tags by doc count descending — bigger tags are potential parents
  const sorted = allTags.sort((a, b) => (tagDocs.get(b)?.size || 0) - (tagDocs.get(a)?.size || 0));

  // Minimum docs to be a supertag: at least 5 docs, or top 20% of tags
  const superThreshold = Math.max(5, Math.floor(docs.length * 0.03));
  const supertagNames = new Set<string>();
  const subtagToSuper = new Map<string, string>();
  const claimed = new Set<string>();

  // Pass 1: identify supertags (tags with enough docs)
  for (const tag of sorted) {
    const count = tagDocs.get(tag)?.size || 0;
    if (count >= superThreshold) {
      supertagNames.add(tag);
    }
  }

  // If no supertags found, promote the top N tags
  if (supertagNames.size === 0) {
    const topN = Math.min(Math.max(2, Math.ceil(allTags.length * 0.2)), 8);
    for (let i = 0; i < Math.min(topN, sorted.length); i++) {
      supertagNames.add(sorted[i]);
    }
  }

  // Pass 2: for each non-supertag, find the best parent supertag
  // via co-occurrence ratio: what fraction of this tag's docs also have the parent?
  for (const tag of sorted) {
    if (supertagNames.has(tag) || claimed.has(tag)) continue;
    const myDocs = tagDocs.get(tag);
    if (!myDocs || myDocs.size === 0) continue;

    let bestParent: string | null = null;
    let bestRatio = 0;

    for (const parent of supertagNames) {
      if (parent === tag) continue;
      const parentDocs = tagDocs.get(parent);
      if (!parentDocs) continue;

      // Count how many of my docs also belong to this parent
      let overlap = 0;
      for (const docId of myDocs) {
        if (parentDocs.has(docId)) overlap++;
      }
      const ratio = overlap / myDocs.size;

      // Need at least 30% co-occurrence to be considered a child
      if (ratio > bestRatio && ratio >= 0.3) {
        bestRatio = ratio;
        bestParent = parent;
      }
    }

    if (bestParent) {
      subtagToSuper.set(tag, bestParent);
      claimed.add(tag);
    }
  }

  // Remaining tags that aren't supertags and have no parent
  const orphanTags = new Set<string>();
  for (const tag of allTags) {
    if (!supertagNames.has(tag) && !subtagToSuper.has(tag)) {
      orphanTags.add(tag);
    }
  }

  return { supertagNames, subtagToSuper, orphanTags };
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
  id: string; type: "doc" | "tag" | "supertag"; label: string;
  level: number; // 0 = supertag, 1 = tag, 2 = doc
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

function buildGraph3D(docs: KnowledgeDoc[], sR: number): { nodes: SimNode[]; edges: SimEdge[]; subtagToSuper: Map<string, string> } {
  const nodes: SimNode[] = [];
  const edgeSet = new Set<string>();
  const edges: SimEdge[] = [];
  // O(1) lookup of nodes by id during the build (avoids repeated O(n) `nodes.find`)
  const nodeById = new Map<string, SimNode>();

  const addEdge = (a: string, b: string, rest: number, strong: boolean) => {
    const k = [a, b].sort().join("|");
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    edges.push({ source: a, target: b, restLength: rest, strong });
  };

  const phi_g = Math.PI * (3 - Math.sqrt(5));

  // 1. Auto-derive the topic hierarchy from tag co-occurrence
  const { supertagNames, subtagToSuper, orphanTags } = deriveTaxonomy(docs);

  const nodeIds = new Map<string, string>(); // tag/supertag name → node id

  // 2. Create supertag nodes (level 0) — large gold spheres
  const superArr = [...supertagNames];
  superArr.forEach((st, i) => {
    const t = i / Math.max(superArr.length, 1);
    const y = 1 - t * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const ang = phi_g * i;
    const rad = sR * 0.35;
    const id = `supertag:${st}`;
    nodeIds.set(st, id);
    const node: SimNode = {
      id, type: "supertag", label: st, level: 0,
      wx: r * Math.cos(ang) * rad, wy: y * rad, wz: r * Math.sin(ang) * rad,
      vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0,
      radius: 12, color: SUPERTAG_COLOR,
    };
    nodes.push(node);
    nodeById.set(id, node);
  });

  // Connect supertags to each other weakly (spread them apart)
  for (let i = 0; i < superArr.length; i++) {
    for (let j = i + 1; j < superArr.length; j++) {
      addEdge(nodeIds.get(superArr[i])!, nodeIds.get(superArr[j])!, sR * 0.9, false);
    }
  }

  // 3. Create sub-tag nodes (level 1) — medium gold, positioned near parent
  const allSubtags = [...subtagToSuper.entries()];
  // Also add orphan tags as level-1 nodes
  const orphanArr = [...orphanTags];

  allSubtags.forEach(([tag, parentName], i) => {
    const parentId = nodeIds.get(parentName);
    const parentNode = parentId ? nodeById.get(parentId) ?? null : null;
    const offset = phi_g * i;
    const spread = sR * 0.2;
    const px = parentNode ? parentNode.wx : 0;
    const py = parentNode ? parentNode.wy : 0;
    const pz = parentNode ? parentNode.wz : 0;

    const id = `tag:${tag}`;
    nodeIds.set(tag, id);
    const node: SimNode = {
      id, type: "tag", label: tag, level: 1,
      wx: px + Math.cos(offset) * spread,
      wy: py + Math.sin(offset * 0.7) * spread * 0.5,
      wz: pz + Math.sin(offset) * spread,
      vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0,
      radius: 7, color: TAG_COLOR,
    };
    nodes.push(node);
    nodeById.set(id, node);

    // Strong edge to parent supertag
    if (parentId) addEdge(id, parentId, sR * 0.25, true);
  });

  orphanArr.forEach((tag, i) => {
    const t = i / Math.max(orphanArr.length, 1);
    const y = 1 - t * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const ang = phi_g * (i + allSubtags.length);
    const rad = sR * 0.5;

    const id = `tag:${tag}`;
    nodeIds.set(tag, id);
    const node: SimNode = {
      id, type: "tag", label: tag, level: 1,
      wx: r * Math.cos(ang) * rad, wy: y * rad, wz: r * Math.sin(ang) * rad,
      vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0,
      radius: 7, color: TAG_COLOR,
    };
    nodes.push(node);
    nodeById.set(id, node);
  });

  // 4. Create document nodes (level 2) — small blue, near their most specific tag
  const N = Math.max(docs.length, 1);
  docs.forEach((doc, i) => {
    // Find the most specific tag this doc has (prefer subtag over supertag)
    let bestTagId: string | null = null;
    let bestNode: SimNode | null = null;
    for (const tag of doc.tags) {
      const tid = nodeIds.get(tag);
      if (!tid) continue;
      const tnode = nodeById.get(tid);
      if (!tnode) continue;
      // Prefer subtags (level 1 with parent) over supertags
      if (!bestNode || (tnode.type === "tag" && bestNode.type === "supertag")) {
        bestTagId = tid;
        bestNode = tnode;
      }
    }

    const offset = phi_g * i;
    const spread = sR * 0.18;
    const px = bestNode ? bestNode.wx : 0;
    const py = bestNode ? bestNode.wy : 0;
    const pz = bestNode ? bestNode.wz : 0;

    const id = `doc:${doc.id}`;
    const node: SimNode = {
      id, type: "doc", label: doc.title, level: 2,
      wx: px + Math.cos(offset) * spread + (Math.random() - 0.5) * spread * 0.5,
      wy: py + Math.sin(offset * 1.3) * spread * 0.4,
      wz: pz + Math.sin(offset) * spread + (Math.random() - 0.5) * spread * 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      vz: (Math.random() - 0.5) * 0.3,
      ax: 0, ay: 0, az: 0,
      radius: 4 + Math.min(doc.chunk_count / 10, 4),
      color: DOC_COLOR, doc,
    };
    nodes.push(node);
    nodeById.set(id, node);

    // Connect doc to all its tags
    for (const tag of doc.tags) {
      const tid = nodeIds.get(tag);
      if (tid) addEdge(id, tid, sR * 0.22, true);
    }
  });

  // 5. Light cross-links between docs sharing tags. Keep this cheap: with 1000+
  // docs the original loop produced tens of thousands of weak edges, which
  // dominated both physics and the renderer. Scale the window down as the
  // graph grows so the visual density stays roughly constant.
  const crossWindow = docs.length > 400 ? 6 : docs.length > 150 ? 12 : 24;
  for (let i = 0; i < docs.length; i++) {
    const a = docs[i];
    if (!a.tags.length) continue;
    const aTags = new Set(a.tags);
    const limit = Math.min(docs.length, i + 1 + crossWindow);
    for (let j = i + 1; j < limit; j++) {
      const b = docs[j];
      let shares = false;
      for (let k = 0; k < b.tags.length; k++) {
        if (aTags.has(b.tags[k])) { shares = true; break; }
      }
      if (shares) addEdge(`doc:${a.id}`, `doc:${b.id}`, sR * 0.35, false);
    }
  }

  return { nodes, edges, subtagToSuper };
}

function buildDust(w: number, h: number): Dust[] {
  const count = w < 500 ? 60 : 140;
  return Array.from({ length: count }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    r: Math.random() * 1.1 + 0.2,
    alpha: Math.random() * 0.3 + 0.04,
    speed: Math.random() * 0.25 + 0.04,
    phase: Math.random() * Math.PI * 2,
  }));
}

// ── Physics (3-D) ─────────────────────────────────────────────────────────────

// Reusable node-id → node map. Rebuilt only when the node list identity changes.
let _stepMap: Map<string, SimNode> | null = null;
let _stepMapKey: SimNode[] | null = null;
function getNodeMap(nodes: SimNode[]): Map<string, SimNode> {
  if (_stepMapKey !== nodes || !_stepMap) {
    _stepMap = new Map(nodes.map(n => [n.id, n]));
    _stepMapKey = nodes;
  }
  return _stepMap;
}

// Spatial-hash repulsion: bucket nodes into a 3-D grid sized by the largest
// repulsion radius so each node only checks neighbors in its own + adjacent
// cells. Turns pairwise O(n²) into ~O(n) for sparse layouts.
function applyRepulsion(nodes: SimNode[]) {
  const N = nodes.length;
  if (N < 2) return;

  // Cell size: covers the maximum interaction distance (max radius pair + 18).
  // 4 (doc-doc) → mn ≈ 58; 12+12 (super-super) → mn ≈ 138. Use 80 as a balance.
  const CELL = 80;
  const grid = new Map<number, SimNode[]>();
  const key = (ix: number, iy: number, iz: number) =>
    ((ix + 1024) * 4096 + (iy + 1024)) * 4096 + (iz + 1024);

  for (let i = 0; i < N; i++) {
    const n = nodes[i];
    const ix = Math.floor(n.wx / CELL);
    const iy = Math.floor(n.wy / CELL);
    const iz = Math.floor(n.wz / CELL);
    const k = key(ix, iy, iz);
    let bucket = grid.get(k);
    if (!bucket) { bucket = []; grid.set(k, bucket); }
    bucket.push(n);
  }

  // For each node, look at its 27 neighbor cells (incl. own) but only push
  // against nodes with a higher index to avoid double-counting.
  // We tag nodes with a temporary index for the duration of this call.
  for (let i = 0; i < N; i++) (nodes[i] as any)._i = i;

  for (let i = 0; i < N; i++) {
    const a = nodes[i];
    const ix = Math.floor(a.wx / CELL);
    const iy = Math.floor(a.wy / CELL);
    const iz = Math.floor(a.wz / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(key(ix + dx, iy + dy, iz + dz));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const b = bucket[bi];
            if ((b as any)._i <= i) continue;
            const ddx = b.wx - a.wx, ddy = b.wy - a.wy, ddz = b.wz - a.wz;
            const d = Math.sqrt(ddx*ddx + ddy*ddy + ddz*ddz) || 0.001;
            const mn = (a.radius + b.radius) * 5 + 18;
            if (d < mn) {
              const f = ((mn - d) / mn) * 0.4 / d;
              a.ax -= ddx*f; a.ay -= ddy*f; a.az -= ddz*f;
              b.ax += ddx*f; b.ay += ddy*f; b.az += ddz*f;
            }
          }
        }
      }
    }
  }
}

function step3D(nodes: SimNode[], edges: SimEdge[], sR: number, damp = 1) {
  const map = getNodeMap(nodes);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    n.ax = 0; n.ay = 0; n.az = 0;
  }

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const a = map.get(e.source), b = map.get(e.target);
    if (!a || !b) continue;
    const dx = b.wx - a.wx, dy = b.wy - a.wy, dz = b.wz - a.wz;
    const d = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
    const f = (d - e.restLength) * 0.003 / d;
    a.ax += dx*f; a.ay += dy*f; a.az += dz*f;
    b.ax -= dx*f; b.ay -= dy*f; b.az -= dz*f;
  }

  applyRepulsion(nodes);

  const sRMax = sR * 1.35;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    n.ax -= n.wx * 0.0003; n.ay -= n.wy * 0.0003; n.az -= n.wz * 0.0003;
    n.ax += (Math.random() - 0.5) * 0.018;
    n.ay += (Math.random() - 0.5) * 0.018;
    n.az += (Math.random() - 0.5) * 0.018;
    n.vx = (n.vx + n.ax) * 0.97;
    n.vy = (n.vy + n.ay) * 0.97;
    n.vz = (n.vz + n.az) * 0.97;
    const spd2 = n.vx*n.vx + n.vy*n.vy + n.vz*n.vz;
    if (spd2 > 1) {
      const inv = 1 / Math.sqrt(spd2);
      n.vx *= inv; n.vy *= inv; n.vz *= inv;
    }
    n.wx += n.vx * damp; n.wy += n.vy * damp; n.wz += n.vz * damp;
    const r2 = n.wx*n.wx + n.wy*n.wy + n.wz*n.wz;
    if (r2 > sRMax * sRMax) {
      const r = Math.sqrt(r2);
      const f = (r - sRMax) * 0.04 / r;
      n.vx -= n.wx * f; n.vy -= n.wy * f; n.vz -= n.wz * f;
    }
  }
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
  panX: number,
  panY: number,
  t: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const w   = ctx.canvas.width / dpr;
  const h   = ctx.canvas.height / dpr;
  const cx  = w / 2 + panX, cy = h / 2 + panY;

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

    const isSuperTag = n.type === "supertag";
    const isTag = n.type === "tag";
    const isTagLike = isSuperTag || isTag;

    const glowMult  = active ? 8 : isSuperTag ? 9 : isTag ? 6 : 5;
    const glowAlpha = (active ? 0.6 : isSuperTag ? 0.4 : isTag ? 0.32 : 0.2) * opa;
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

    // Crosshair for supertags, smaller cross for subtags
    if (isSuperTag) {
      const s = rad * 3.5;
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.5 * opa})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sx-s, sy); ctx.lineTo(sx+s, sy);
      ctx.moveTo(sx, sy-s); ctx.lineTo(sx, sy+s);
      ctx.stroke();
      // Orbit ring hint
      ctx.beginPath();
      ctx.arc(sx, sy, rad * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.12 * opa})`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    } else if (isTag) {
      const s = rad * 2.5;
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.35 * opa})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(sx-s, sy); ctx.lineTo(sx+s, sy);
      ctx.moveTo(sx, sy-s); ctx.lineTo(sx, sy+s);
      ctx.stroke();
    }

    // Labels: always show for supertags, show for tags, show for active/linked docs
    if (isTagLike || active || linked) {
      const txt = n.label.length > 24 ? n.label.slice(0, 22) + "…" : n.label;
      const fs  = isSuperTag ? 13 : isTag ? 10 : 9;
      ctx.font      = isSuperTag ? `bold ${fs}px system-ui,sans-serif`
                     : isTag ? `600 ${fs}px system-ui,sans-serif`
                     : `${fs}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      const labelOpa = active ? 1 : isSuperTag ? 0.95 : linked ? 0.9 : 0.8;
      ctx.fillStyle = `rgba(${r},${g},${b},${labelOpa * opa})`;
      ctx.fillText(txt, sx, sy + rad + (isSuperTag ? 16 : 13));
    }
  }
}

// ── Tag Document List ──────────────────────────────────────────────────────────

function TagDocumentList({
  docs,
  selectedNode,
  taxonomyRef,
  nodesRef,
  selectRef,
  setSelectedNode,
}: {
  docs: KnowledgeDoc[];
  selectedNode: SimNode;
  taxonomyRef: React.MutableRefObject<{ subtagToSuper: Map<string, string> }>;
  nodesRef: React.MutableRefObject<SimNode[]>;
  selectRef: React.MutableRefObject<string | null>;
  setSelectedNode: (n: SimNode | null) => void;
}) {
  const [filter, setFilter] = useState("");

  const filteredDocs = docs
    .filter((d) => {
      if (selectedNode.type === "supertag") {
        return d.tags.some((t) => {
          const parent = taxonomyRef.current.subtagToSuper.get(t);
          return t === selectedNode.label || parent === selectedNode.label;
        });
      }
      return d.tags.includes(selectedNode.label);
    })
    .filter((d) => !filter || d.title.toLowerCase().includes(filter.toLowerCase()));

  // Group by source type for better readability
  const grouped = new Map<string, KnowledgeDoc[]>();
  for (const d of filteredDocs) {
    const key = d.source_type;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(d);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground/70 font-medium uppercase tracking-wider">
          {filteredDocs.length} document{filteredDocs.length !== 1 ? "s" : ""}
        </p>
      </div>
      {docs.filter((d) => {
        if (selectedNode.type === "supertag") {
          return d.tags.some((t) => {
            const parent = taxonomyRef.current.subtagToSuper.get(t);
            return t === selectedNode.label || parent === selectedNode.label;
          });
        }
        return d.tags.includes(selectedNode.label);
      }).length > 5 && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter documents…"
          className="w-full text-xs bg-accent/10 border border-border/30 rounded-lg px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      )}
      <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
        {[...grouped.entries()].map(([type, typeDocs]) => (
          <div key={type}>
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider px-1 mb-1 flex items-center gap-1">
              <span>{SOURCE_ICONS[type]}</span>
              <span>{type}</span>
              <span className="text-muted-foreground/30">({typeDocs.length})</span>
            </p>
            {typeDocs.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  const n = nodesRef.current.find((x) => x.id === `doc:${d.id}`);
                  if (n) {
                    selectRef.current = n.id;
                    setSelectedNode(n);
                  }
                }}
                className="w-full text-left text-xs text-muted-foreground hover:text-foreground py-1.5 px-2 rounded-md hover:bg-accent/15 transition-colors truncate block leading-snug"
              >
                {d.title}
              </button>
            ))}
          </div>
        ))}
        {filteredDocs.length === 0 && filter && (
          <p className="text-xs text-muted-foreground/40 text-center py-2">No matches</p>
        )}
      </div>
    </div>
  );
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
  const baseScaleRef = useRef(1); // the "overview" scale from rebuild
  const panRef      = useRef({ x: 0, y: 0 });
  const sphereRRef  = useRef(300);
  const interactRef = useRef<Interaction>({ active: false, nodeId: null, lastMx: 0, lastMy: 0, hasMoved: false });
  const holdingTagRef = useRef(false);
  const taxonomyRef  = useRef<{ subtagToSuper: Map<string, string> }>({ subtagToSuper: new Map() });
  const dampRef     = useRef(1);
  const rafRef      = useRef<number>(0);
  // Zoom-to-cluster animation target
  const zoomTargetRef = useRef<{ scale: number; panX: number; panY: number } | null>(null);
  const zoomedClusterRef = useRef<string | null>(null); // supertag label currently zoomed into

  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [docs, setDocs]       = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [zoomed, setZoomed]   = useState(false); // true when zoomed into a cluster

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
    const isMobile = w < 500;
    const docCount = docsRef.current.length;
    // Scale sphere radius with document count so the nebula grows organically
    // On mobile, use a smaller base to keep everything visible
    const baseSR = Math.min(w, h) * (isMobile ? 0.30 : 0.38);
    const growthFactor = docCount <= 5 ? 1 : 1 + Math.log2(docCount / 5) * 0.35;
    const sR = baseSR * growthFactor;
    sphereRRef.current = sR;
    // Auto-fit: choose scale so the nebula sphere (with ~1.35x outer bound)
    // fills the viewport with a small margin. This ensures it's zoomed in
    // to fit the page on load regardless of doc count or screen size.
    const targetFill = Math.min(w, h) * (isMobile ? 0.46 : 0.48);
    const baseScale = targetFill / (sR * 1.35);
    scaleRef.current = baseScale;
    baseScaleRef.current = baseScale;
    const { nodes, edges, subtagToSuper: st } = buildGraph3D(docsRef.current, sR);
    // Scale down node radii on mobile for less overlap
    if (isMobile) {
      for (const n of nodes) {
        n.radius = n.radius * 0.75;
      }
    }
    nodesRef.current = nodes;
    edgesRef.current = edges;
    taxonomyRef.current = { subtagToSuper: st };
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
      // When zoomed into a cluster, freeze all motion (rotation + physics)
      const isZoomed = zoomedClusterRef.current !== null;

      // Dampen when holding a tag node
      if (holdingTagRef.current || isZoomed) {
        dampRef.current = Math.max(0, dampRef.current - 0.05);
      } else {
        dampRef.current = Math.min(1, dampRef.current + 0.03);
      }
      const damp = dampRef.current;

      const av = angVelRef.current;
      const isMobileView = (canvasRef.current?.offsetWidth ?? 800) < 500;
      const idleSpeed = isMobileView ? 0.0003 : 0.0006;
      rotRef.current = mul3(rotY(av.ry * damp), rotRef.current);
      rotRef.current = mul3(rotX(av.rx * damp), rotRef.current);
      av.ry = av.ry * 0.96 + idleSpeed * (1 - Math.abs(av.ry) * 50);
      av.rx *= 0.94;

      step3D(nodesRef.current, edgesRef.current, sphereRRef.current, damp);

      // Animate camera toward zoom target
      const zt = zoomTargetRef.current;
      if (zt) {
        const lerp = 0.07;
        scaleRef.current += (zt.scale - scaleRef.current) * lerp;
        panRef.current.x += (zt.panX - panRef.current.x) * lerp;
        panRef.current.y += (zt.panY - panRef.current.y) * lerp;
        // Clear target once close enough so manual zoom works again
        if (
          Math.abs(zt.scale - scaleRef.current) < 0.001 &&
          Math.abs(zt.panX - panRef.current.x) < 0.5 &&
          Math.abs(zt.panY - panRef.current.y) < 0.5
        ) {
          zoomTargetRef.current = null;
        }
      }

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
        rotRef.current, sphereRRef.current, scaleRef.current,
        panRef.current.x, panRef.current.y,
        t / 1000,
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

    // Pinch-to-zoom for touch devices
    let lastPinchDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchDist = Math.hypot(dx, dy);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastPinchDist > 0) {
          const factor = dist / lastPinchDist;
          scaleRef.current = Math.max(0.2, Math.min(5, scaleRef.current * factor));
        }
        lastPinchDist = dist;
      }
    };
    const onTouchEnd = () => { lastPinchDist = 0; };
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [rebuild]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect   = canvasRef.current!.getBoundingClientRect();
    const mx     = e.clientX - rect.left, my = e.clientY - rect.top;
    const node   = nodeAtScreen(mx, my);
    hoverRef.current = node?.id ?? null;
    holdingTagRef.current = node?.type === "tag" || node?.type === "supertag";
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

  const zoomToCluster = useCallback((supertagNode: SimNode) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;

    // Find all nodes in this cluster (the supertag + its subtags + their docs)
    const label = supertagNode.label;
    const clusterNodes = nodesRef.current.filter(n => {
      if (n.id === supertagNode.id) return true;
      if (n.type === "tag" && taxonomyRef.current.subtagToSuper.get(n.label) === label) return true;
      if (n.type === "doc" && n.doc?.tags.some(t => t === label || taxonomyRef.current.subtagToSuper.get(t) === label)) return true;
      return false;
    });
    if (clusterNodes.length === 0) return;

    // Compute projected center of the cluster
    let sumX = 0, sumY = 0;
    for (const n of clusterNodes) {
      const [rx, ry] = applyMat3(rotRef.current, n.wx, n.wy, n.wz);
      sumX += rx; sumY += ry;
    }
    const avgX = sumX / clusterNodes.length;
    const avgY = sumY / clusterNodes.length;

    // Compute cluster radius to determine zoom level
    let maxDist = 0;
    for (const n of clusterNodes) {
      const [rx, ry] = applyMat3(rotRef.current, n.wx, n.wy, n.wz);
      maxDist = Math.max(maxDist, Math.hypot(rx - avgX, ry - avgY));
    }
    const viewSize = Math.min(w, h) * 0.35;
    const targetScale = Math.max(baseScaleRef.current * 1.5, Math.min(4, viewSize / Math.max(maxDist, 50)));

    zoomTargetRef.current = {
      scale: targetScale,
      panX: -avgX * targetScale,
      panY: -avgY * targetScale,
    };
    zoomedClusterRef.current = label;
    setZoomed(true);
  }, []);

  const zoomOut = useCallback(() => {
    zoomTargetRef.current = {
      scale: baseScaleRef.current,
      panX: 0,
      panY: 0,
    };
    zoomedClusterRef.current = null;
    setZoomed(false);
  }, []);

  const onPointerUp = useCallback(() => {
    holdingTagRef.current = false;
    const ix = interactRef.current;
    if (!ix.hasMoved && ix.nodeId) {
      const id    = ix.nodeId;
      const node = nodesRef.current.find(n => n.id === id);

      // If clicking a supertag, zoom into that cluster
      if (node?.type === "supertag") {
        if (zoomedClusterRef.current === node.label) {
          // Already zoomed into this cluster — toggle selection normally
          const newId = id === selectRef.current ? null : id;
          selectRef.current = newId;
          setSelectedNode(newId ? node : null);
        } else {
          // Zoom into the cluster
          selectRef.current = id;
          setSelectedNode(node);
          zoomToCluster(node);
        }
      } else {
        const newId = id === selectRef.current ? null : id;
        selectRef.current = newId;
        setSelectedNode(newId ? (node ?? null) : null);
      }
    } else if (!ix.hasMoved && !ix.nodeId) {
      // Clicked on empty space — deselect and zoom out if zoomed
      selectRef.current = null;
      setSelectedNode(null);
      if (zoomedClusterRef.current) {
        zoomOut();
      }
    }
    interactRef.current = { active: false, nodeId: null, lastMx: 0, lastMy: 0, hasMoved: false };
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
  }, [zoomToCluster, zoomOut]);

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
        {zoomed && (
          <button onClick={zoomOut} className="glass rounded-lg px-3 py-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors" title="Back to overview">
            <ArrowLeft size={14} /> Overview
          </button>
        )}
        <button onClick={loadDocs} className="glass rounded-lg p-2 text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
          <RefreshCw size={14} />
        </button>
        <Link to="/upload" className="glass rounded-lg p-2 text-muted-foreground hover:text-foreground transition-colors" title="Add document">
          <Plus size={14} />
        </Link>
      </div>

      {!loading && docs.length > 0 && (
        <div className="absolute bottom-4 left-4 pointer-events-none hidden sm:block">
          <p className="text-[11px] text-muted-foreground/50">
            {docs.length} stars · drag to spin · scroll to zoom · click a domain to dive in
          </p>
        </div>
      )}

      {!loading && docs.length > 0 && (
        <div className="absolute bottom-4 right-4 flex-col gap-1 pointer-events-none hidden sm:flex">
          {[...new Set(docs.map(d => d.source_type))].map(t => (
            <div key={t} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
              <span>{SOURCE_ICONS[t]}</span><span className="capitalize">{t}</span>
            </div>
          ))}
        </div>
      )}

      {/* Info panel */}
      {selectedNode && (
        <div className="absolute top-3 right-3 left-3 sm:left-auto sm:w-72 glass rounded-xl p-4 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{selectedNode.label}</p>
              {selectedNode.type === "doc" && selectedNode.doc && (
                <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                  {SOURCE_ICONS[selectedNode.doc.source_type]} {selectedNode.doc.source_type}
                  {" · "}{selectedNode.doc.chunk_count} chunks
                </p>
              )}
              {selectedNode.type === "supertag" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Domain · {docs.filter(d => d.tags.some(t => {
                    const parent = taxonomyRef.current.subtagToSuper.get(t);
                    return t === selectedNode.label || parent === selectedNode.label;
                  })).length} documents
                </p>
              )}
              {selectedNode.type === "tag" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Topic · {docs.filter(d => d.tags.includes(selectedNode.label)).length} documents
                </p>
              )}
            </div>
            <button onClick={() => { selectRef.current = null; setSelectedNode(null); if (zoomedClusterRef.current) zoomOut(); }} className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5">
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
                <Link to="/search" search={{ q: selectedNode.doc.title }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-nebula-blue/20 border border-nebula-blue/30 text-nebula-blue text-xs hover:bg-nebula-blue/30 transition-colors">
                  <Search size={11} /> Search
                </Link>
                <button onClick={() => handleDelete(selectedNode.doc!.id)} disabled={deleting} className="px-2.5 py-1.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs hover:bg-destructive/20 transition-colors disabled:opacity-50">
                  <Trash2 size={11} />
                </button>
              </div>
            </>
          )}

          {(selectedNode.type === "tag" || selectedNode.type === "supertag") && (
            <TagDocumentList
              docs={docs}
              selectedNode={selectedNode}
              taxonomyRef={taxonomyRef}
              nodesRef={nodesRef}
              selectRef={selectRef}
              setSelectedNode={setSelectedNode}
            />
          )}
        </div>
      )}
    </div>
  );
}
