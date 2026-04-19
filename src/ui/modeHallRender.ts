import type {
  ModeDefinition,
  ModeHallRoomSnapshot,
  ModeHallTabId,
  ModeQueueVariant,
  ModeSidebarEntry,
  ModeSidebarTabId,
} from "../modes/definitions";
import { renderLobbyIcon } from "./icons";

/* ══════════════════════════════════════════════
   段位系统 v2
   黑铁 → 青铜 → 白银 → 黄金 → 铂金 → 钻石 → 超凡 → 神话 → 无畏赋能
   ══════════════════════════════════════════════ */

export interface RankTier {
  key: string;
  label: string;
  divisions: number;       // 大段数 (黑铁~黄金: 3, 铂金~无畏赋能: 4)
  pointsPerDiv: number;    // 每个大段需要的分数
  color1: string;          // 主色
  color2: string;          // 辅色
  color3?: string;         // 第三色 (高段位渐变)
  isElite?: boolean;       // 无畏赋能: 仅限前 500
  description: string;     // 段位描述
}

export const RANK_TIERS: RankTier[] = [
  {
    key: "iron", label: "黑铁", divisions: 3, pointsPerDiv: 100,
    color1: "#6b7280", color2: "#374151", description: "初入战场"
  },
  {
    key: "bronze", label: "青铜", divisions: 3, pointsPerDiv: 100,
    color1: "#cd7f32", color2: "#8b5e2b", description: "崭露锋芒"
  },
  {
    key: "silver", label: "白银", divisions: 3, pointsPerDiv: 100,
    color1: "#c0c0c0", color2: "#808080", description: "驾轻就熟"
  },
  {
    key: "gold", label: "黄金", divisions: 3, pointsPerDiv: 120,
    color1: "#fbbf24", color2: "#d97706", description: "势不可挡"
  },
  {
    key: "platinum", label: "铂金", divisions: 4, pointsPerDiv: 150,
    color1: "#06b6d4", color2: "#0e7490", color3: "#67e8f9", description: "百战精锐"
  },
  {
    key: "diamond", label: "钻石", divisions: 4, pointsPerDiv: 200,
    color1: "#60a5fa", color2: "#2563eb", color3: "#93c5fd", description: "星耀之巅"
  },
  {
    key: "transcend", label: "超凡", divisions: 4, pointsPerDiv: 300,
    color1: "#a78bfa", color2: "#7c3aed", color3: "#c4b5fd", description: "超越凡俗"
  },
  {
    key: "mythic", label: "神话", divisions: 4, pointsPerDiv: 400,
    color1: "#f43f5e", color2: "#be123c", color3: "#fda4af", description: "举世无双"
  },
  {
    key: "fearless", label: "无畏赋能", divisions: 1, pointsPerDiv: 0,
    color1: "#f59e0b", color2: "#dc2626", color3: "#a78bfa", isElite: true, description: "全国前500"
  },
];

export interface RankInfo {
  tierIndex: number;
  division: number;   // 1=I, 2=II, 3=III, 4=IV
  points: number;     // 当前大段内积分
  stars: number;      // 显示用星星 (points 映射)
  totalPoints: number; // 累计总分
}

export function getRankTierLabel(r: RankInfo): string {
  const tier = RANK_TIERS[r.tierIndex];
  if (!tier) return "未定段";
  if (tier.isElite) return tier.label;
  const romanDiv = ["", " I", " II", " III", " IV"][r.division] ?? "";
  return `${tier.label}${romanDiv}`;
}

export function getRankStarsFromPoints(tier: RankTier, points: number): number {
  if (tier.pointsPerDiv <= 0) return 5;
  const maxStars = tier.divisions <= 3 ? 3 : 4;
  return Math.min(maxStars, Math.floor(points / (tier.pointsPerDiv / maxStars)));
}

export function getMaxStars(tier: RankTier): number {
  if (tier.isElite) return 5;
  return tier.divisions <= 3 ? 3 : 4;
}

function buildStarsSvg(filled: number, max: number, color: string, size: number): string {
  const gap = size * 2.4;
  const totalW = gap * max;
  let s = `<svg width="${totalW}" height="${size * 2.6}" viewBox="0 0 ${totalW} ${size * 2.6}" style="display:block;margin:0 auto">`;
  for (let i = 0; i < max; i++) {
    const cx = gap * i + gap / 2;
    const cy = size * 1.3;
    const isFilled = i < filled;
    const fill = isFilled ? color : "rgba(255,255,255,0.06)";
    const stroke = isFilled ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.04)";
    const r1 = size, r2 = size * 0.38;
    let pts = "";
    for (let j = 0; j < 10; j++) {
      const a = (Math.PI / 2) + (Math.PI / 5) * j;
      const rad = j % 2 === 0 ? r1 : r2;
      pts += `${cx + rad * Math.cos(a)},${cy - rad * Math.sin(a)} `;
    }
    s += `<polygon points="${pts.trim()}" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`;
    if (isFilled) {
      s += `<polygon points="${pts.trim()}" fill="${color}" opacity="0.15" transform="translate(0,0.6)"/>`;
    }
  }
  s += "</svg>";
  return s;
}

/* ── Elaborate SVG emblem builder ── */
let _uid = 0;
function uid() { return `rk${++_uid}`; }

export function buildRankEmblemSvg(rank: RankInfo, size: number): string {
  const tier = RANK_TIERS[rank.tierIndex];
  if (!tier) return "";
  const s = size;
  const gid = uid();
  const c1 = tier.color1, c2 = tier.color2, c3 = tier.color3 ?? c1;

  // Common defs
  const defs = `<defs>
    <linearGradient id="g${gid}" x1="0" y1="0" x2="${s}" y2="${s}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
    <linearGradient id="h${gid}" x1="0" y1="0" x2="${s}" y2="${s}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${c3}" stop-opacity="0.6"/><stop offset="100%" stop-color="${c1}" stop-opacity="0.2"/>
    </linearGradient>
    <radialGradient id="glow${gid}" cx="50%" cy="40%"><stop offset="0%" stop-color="${c1}" stop-opacity="0.3"/><stop offset="100%" stop-color="${c1}" stop-opacity="0"/></radialGradient>
    <filter id="f${gid}"><feGaussianBlur stdDeviation="${s * 0.03}"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    ${tier.key === "fearless" ? `<linearGradient id="fg${gid}" x1="0" y1="0" x2="${s}" y2="${s}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#f59e0b"/><stop offset="25%" stop-color="#ef4444"/><stop offset="50%" stop-color="#a78bfa"/><stop offset="75%" stop-color="#60a5fa"/><stop offset="100%" stop-color="#34d399"/>
    </linearGradient>` : ""}
  </defs>`;

  const cx = s / 2, cy = s / 2;
  let body = "";

  switch (tier.key) {
    case "iron": {
      // 简约八边形盾牌
      const r = s * 0.38;
      const octPts = Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI * 2 / 8) * i - Math.PI / 8;
        return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
      }).join(" ");
      body = `<polygon points="${octPts}" fill="url(#g${gid})" stroke="rgba(255,255,255,0.15)" stroke-width="${s * 0.02}"/>`;
      // 内部十字线
      const ir = r * 0.55;
      body += `<line x1="${cx}" y1="${cy - ir}" x2="${cx}" y2="${cy + ir}" stroke="rgba(255,255,255,0.1)" stroke-width="${s * 0.015}"/>`;
      body += `<line x1="${cx - ir}" y1="${cy}" x2="${cx + ir}" y2="${cy}" stroke="rgba(255,255,255,0.1)" stroke-width="${s * 0.015}"/>`;
      // 中心点
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.05}" fill="rgba(255,255,255,0.15)"/>`;
      break;
    }
    case "bronze": {
      // 圆角盾牌 + 铆钉
      const sw = s * 0.6, sh = s * 0.7;
      const sx = cx - sw / 2, sy = cy - sh * 0.45;
      body = `<path d="M${sx + sw * 0.15},${sy} L${sx + sw * 0.85},${sy}
        Q${sx + sw},${sy} ${sx + sw},${sy + sh * 0.15}
        L${sx + sw},${sy + sh * 0.6} L${cx},${sy + sh}
        L${sx},${sy + sh * 0.6} L${sx},${sy + sh * 0.15}
        Q${sx},${sy} ${sx + sw * 0.15},${sy}" fill="url(#g${gid})" stroke="rgba(255,255,255,0.18)" stroke-width="${s * 0.02}"/>`;
      // 铆钉
      const riv = s * 0.025;
      body += `<circle cx="${sx + sw * 0.2}" cy="${sy + sh * 0.15}" r="${riv}" fill="rgba(255,255,255,0.25)"/>`;
      body += `<circle cx="${sx + sw * 0.8}" cy="${sy + sh * 0.15}" r="${riv}" fill="rgba(255,255,255,0.25)"/>`;
      body += `<circle cx="${sx + sw * 0.2}" cy="${sy + sh * 0.45}" r="${riv}" fill="rgba(255,255,255,0.25)"/>`;
      body += `<circle cx="${sx + sw * 0.8}" cy="${sy + sh * 0.45}" r="${riv}" fill="rgba(255,255,255,0.25)"/>`;
      // 内部纹章V
      body += `<path d="M${cx - s * 0.1},${cy - s * 0.06} L${cx},${cy + s * 0.1} L${cx + s * 0.1},${cy - s * 0.06}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="${s * 0.018}"/>`;
      break;
    }
    case "silver": {
      // 尖顶盾牌 + 羽翼暗纹
      const sw = s * 0.58, sh = s * 0.72;
      const top = cy - sh * 0.44;
      body = `<path d="M${cx},${top} L${cx + sw / 2},${top + sh * 0.2} L${cx + sw / 2},${top + sh * 0.65} L${cx},${top + sh} L${cx - sw / 2},${top + sh * 0.65} L${cx - sw / 2},${top + sh * 0.2} Z" fill="url(#g${gid})" stroke="rgba(255,255,255,0.2)" stroke-width="${s * 0.018}"/>`;
      // 内环
      body += `<circle cx="${cx}" cy="${cy + s * 0.02}" r="${s * 0.12}" fill="none" stroke="url(#h${gid})" stroke-width="${s * 0.015}"/>`;
      // 翼纹
      body += `<path d="M${cx - s * 0.18},${cy - s * 0.05} Q${cx - s * 0.25},${cy - s * 0.18} ${cx - s * 0.15},${cy - s * 0.2}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="${s * 0.01}"/>`;
      body += `<path d="M${cx + s * 0.18},${cy - s * 0.05} Q${cx + s * 0.25},${cy - s * 0.18} ${cx + s * 0.15},${cy - s * 0.2}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="${s * 0.01}"/>`;
      break;
    }
    case "gold": {
      // 皇冠盾牌
      const sw = s * 0.62, sh = s * 0.65;
      const top = cy - sh * 0.35;
      body = `<path d="M${cx - sw / 2},${top + sh * 0.2} L${cx - sw * 0.35},${top} L${cx - sw * 0.12},${top + sh * 0.15} L${cx},${top - sh * 0.05} L${cx + sw * 0.12},${top + sh * 0.15} L${cx + sw * 0.35},${top} L${cx + sw / 2},${top + sh * 0.2} L${cx + sw / 2},${top + sh * 0.7} L${cx},${top + sh} L${cx - sw / 2},${top + sh * 0.7} Z" fill="url(#g${gid})" stroke="rgba(255,255,255,0.22)" stroke-width="${s * 0.018}"/>`;
      // 宝石
      body += `<circle cx="${cx}" cy="${cy + s * 0.02}" r="${s * 0.06}" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)" stroke-width="${s * 0.01}"/>`;
      // 横纹
      body += `<line x1="${cx - s * 0.2}" y1="${top + sh * 0.28}" x2="${cx + s * 0.2}" y2="${top + sh * 0.28}" stroke="rgba(255,255,255,0.15)" stroke-width="${s * 0.012}"/>`;
      break;
    }
    case "platinum": {
      // 菱形 + 侧翼
      const r = s * 0.3;
      body = `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="${s * 0.03}" transform="rotate(45 ${cx} ${cy})" fill="url(#g${gid})" stroke="rgba(255,255,255,0.2)" stroke-width="${s * 0.018}"/>`;
      // 外翼
      const wl = s * 0.15;
      body += `<path d="M${cx - r - s * 0.02},${cy} L${cx - r - wl},${cy - s * 0.12} L${cx - r - wl * 0.5},${cy} L${cx - r - wl},${cy + s * 0.12} Z" fill="url(#h${gid})" stroke="rgba(255,255,255,0.1)" stroke-width="${s * 0.008}"/>`;
      body += `<path d="M${cx + r + s * 0.02},${cy} L${cx + r + wl},${cy - s * 0.12} L${cx + r + wl * 0.5},${cy} L${cx + r + wl},${cy + s * 0.12} Z" fill="url(#h${gid})" stroke="rgba(255,255,255,0.1)" stroke-width="${s * 0.008}"/>`;
      // 中心光芒
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.06}" fill="rgba(255,255,255,0.25)"/>`;
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.03}" fill="rgba(255,255,255,0.5)"/>`;
      break;
    }
    case "diamond": {
      // 钻石切割形
      const tw = s * 0.52, th = s * 0.65;
      const top = cy - th * 0.42;
      body = `<path d="M${cx},${top} L${cx + tw * 0.5},${top + th * 0.3} L${cx + tw * 0.35},${top + th} L${cx - tw * 0.35},${top + th} L${cx - tw * 0.5},${top + th * 0.3} Z" fill="url(#g${gid})" stroke="rgba(255,255,255,0.25)" stroke-width="${s * 0.016}"/>`;
      // 切割线
      body += `<line x1="${cx - tw * 0.35}" y1="${top + th * 0.3}" x2="${cx + tw * 0.35}" y2="${top + th * 0.3}" stroke="rgba(255,255,255,0.15)" stroke-width="${s * 0.01}"/>`;
      body += `<line x1="${cx}" y1="${top}" x2="${cx - tw * 0.15}" y2="${top + th * 0.3}" stroke="rgba(255,255,255,0.1)" stroke-width="${s * 0.008}"/>`;
      body += `<line x1="${cx}" y1="${top}" x2="${cx + tw * 0.15}" y2="${top + th * 0.3}" stroke="rgba(255,255,255,0.1)" stroke-width="${s * 0.008}"/>`;
      body += `<line x1="${cx - tw * 0.15}" y1="${top + th * 0.3}" x2="${cx - tw * 0.1}" y2="${top + th}" stroke="rgba(255,255,255,0.06)" stroke-width="${s * 0.006}"/>`;
      body += `<line x1="${cx + tw * 0.15}" y1="${top + th * 0.3}" x2="${cx + tw * 0.1}" y2="${top + th}" stroke="rgba(255,255,255,0.06)" stroke-width="${s * 0.006}"/>`;
      // 光芒线
      body += `<line x1="${cx}" y1="${top - s * 0.06}" x2="${cx}" y2="${top + s * 0.02}" stroke="${c3}" stroke-width="${s * 0.01}" opacity="0.4"/>`;
      break;
    }
    case "transcend": {
      // 火焰围绕的六边形
      const r = s * 0.28;
      const hexPts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
      }).join(" ");
      body = `<polygon points="${hexPts}" fill="url(#g${gid})" stroke="rgba(255,255,255,0.2)" stroke-width="${s * 0.016}"/>`;
      // 火焰
      const flameH = s * 0.18;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const bx = cx + r * Math.cos(a), by = cy + r * Math.sin(a);
        const fx = cx + (r + flameH) * Math.cos(a), fy = cy + (r + flameH) * Math.sin(a);
        const cpx = cx + (r + flameH * 0.7) * Math.cos(a + 0.15), cpy = cy + (r + flameH * 0.7) * Math.sin(a + 0.15);
        body += `<path d="M${bx},${by} Q${cpx},${cpy} ${fx},${fy}" stroke="${c3}" fill="none" stroke-width="${s * 0.012}" opacity="0.35"/>`;
      }
      // 内环 + 光点
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.12}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="${s * 0.01}"/>`;
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.04}" fill="rgba(255,255,255,0.35)"/>`;
      break;
    }
    case "mythic": {
      // 龙翼纹章
      const sw = s * 0.42, sh = s * 0.58;
      const top = cy - sh * 0.42;
      body = `<path d="M${cx},${top} L${cx + sw / 2},${top + sh * 0.25} L${cx + sw / 2},${top + sh * 0.75} L${cx},${top + sh} L${cx - sw / 2},${top + sh * 0.75} L${cx - sw / 2},${top + sh * 0.25} Z" fill="url(#g${gid})" stroke="rgba(255,255,255,0.2)" stroke-width="${s * 0.016}"/>`;
      // 龙翼
      const wspan = s * 0.22;
      body += `<path d="M${cx - sw / 2},${top + sh * 0.25} Q${cx - sw / 2 - wspan},${top - sh * 0.1} ${cx - sw / 2 - wspan * 0.8},${top + sh * 0.45}" fill="${c1}" fill-opacity="0.2" stroke="${c3}" stroke-width="${s * 0.01}" opacity="0.5"/>`;
      body += `<path d="M${cx + sw / 2},${top + sh * 0.25} Q${cx + sw / 2 + wspan},${top - sh * 0.1} ${cx + sw / 2 + wspan * 0.8},${top + sh * 0.45}" fill="${c1}" fill-opacity="0.2" stroke="${c3}" stroke-width="${s * 0.01}" opacity="0.5"/>`;
      // 中心宝石
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.055}" fill="${c3}" fill-opacity="0.4" stroke="rgba(255,255,255,0.3)" stroke-width="${s * 0.008}"/>`;
      // 顶端尖刺
      body += `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${top - s * 0.08}" stroke="${c1}" stroke-width="${s * 0.014}" opacity="0.5"/>`;
      body += `<circle cx="${cx}" cy="${top - s * 0.08}" r="${s * 0.02}" fill="${c3}" opacity="0.6"/>`;
      break;
    }
    case "fearless": {
      // 极光环绕的星芒 — 全国前500
      const outerR = s * 0.4, innerR = s * 0.18;
      // 10 角星
      let starPts = "";
      for (let i = 0; i < 20; i++) {
        const a = (Math.PI * 2 / 20) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? outerR : innerR;
        starPts += `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)} `;
      }
      body = `<polygon points="${starPts.trim()}" fill="url(#fg${gid})" stroke="rgba(255,255,255,0.25)" stroke-width="${s * 0.014}"/>`;
      // 极光环
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.42}" fill="none" stroke="url(#fg${gid})" stroke-width="${s * 0.008}" opacity="0.3" stroke-dasharray="${s * 0.06} ${s * 0.04}"/>`;
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.46}" fill="none" stroke="url(#fg${gid})" stroke-width="${s * 0.005}" opacity="0.15" stroke-dasharray="${s * 0.03} ${s * 0.06}"/>`;
      // 内部光核
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.08}" fill="rgba(255,255,255,0.35)"/>`;
      body += `<circle cx="${cx}" cy="${cy}" r="${s * 0.04}" fill="rgba(255,255,255,0.7)"/>`;
      break;
    }
  }

  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" class="mh-rank-svg">
    ${defs}
    <circle cx="${cx}" cy="${cy}" r="${s * 0.44}" fill="url(#glow${gid})" opacity="0.5"/>
    <g filter="url(#f${gid})">${body}</g>
  </svg>`;
}

/** Build the rank showcase block (big emblem + label + stars + points bar) */
export function buildRankShowcase(rank: RankInfo): string {
  const tier = RANK_TIERS[rank.tierIndex];
  if (!tier) return "";
  const label = getRankTierLabel(rank);
  const maxStars = getMaxStars(tier);
  const ptsText = tier.isElite
    ? "全国前 500 · 至高荣耀"
    : `${rank.points} / ${tier.pointsPerDiv} 分`;
  const pctWidth = tier.isElite ? 100 : Math.min(100, Math.round((rank.points / tier.pointsPerDiv) * 100));

  return `
    <div class="mh-rank-showcase" data-modehall-rank-showcase>
      <div class="mh-rank-emblem-wrap">
        <div class="mh-rank-emblem-glow" style="background:radial-gradient(circle,${tier.color1}30,transparent 70%)"></div>
        ${buildRankEmblemSvg(rank, 100)}
      </div>
      <div class="mh-rank-meta">
        <div class="mh-rank-tier-label" style="color:${tier.color1}">${escapeHtml(label)}</div>
        <div class="mh-rank-desc">${escapeHtml(tier.description)}</div>
        <div class="mh-rank-stars">${buildStarsSvg(rank.stars, maxStars, tier.color1, 7)}</div>
        <div class="mh-rank-progress">
          <div class="mh-rank-progress-bar"><div class="mh-rank-progress-fill" style="width:${pctWidth}%;background:linear-gradient(90deg,${tier.color2},${tier.color1})"></div></div>
          <div class="mh-rank-progress-text">${ptsText}</div>
        </div>
      </div>
      <button type="button" class="mh-rank-detail-btn" data-modehall-rank-detail>
        <span class="material-symbols-outlined" style="font-size:16px">trophy</span>
        段位详情
      </button>
    </div>`;
}

export function buildModeHallTemplate(): string {
  return `
    <!-- 背景 -->
    <div class="mh-bg">
      <div class="mh-bg-glow mh-bg-glow--1"></div>
      <div class="mh-bg-glow mh-bg-glow--2"></div>
      <div class="mh-bg-grid"></div>
    </div>

    <!-- 顶栏 -->
    <header class="mh-topbar">
      <button type="button" class="mh-topbar-back" data-modehall-back>
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <div class="mh-topbar-center">
        <div class="mh-topbar-kicker" data-modehall-kicker>RANKED ARENA</div>
        <h2 class="mh-topbar-title" data-modehall-title>排位赛</h2>
      </div>
      <div class="mh-topbar-right" style="width:40px"></div>
    </header>

    <!-- 中央竞技场 -->
    <div class="mh-arena">
      <!-- 段位展示 -->
      <div class="mh-rank-zone" data-modehall-rank-zone>
        ${buildRankShowcase({ tierIndex: 0, division: 1, points: 0, stars: 0, totalPoints: 0 })}
      </div>
      <!-- 5人位 -->
      <div class="mh-seats" data-modehall-seats>
        ${buildEmptyCockpitSeats()}
      </div>
      <div class="mh-arena-hint" data-modehall-seats-hint>点击 + 邀请好友组队</div>
    </div>

    <!-- 底部操作栏 -->
    <div class="mh-bottom">
      <div class="mh-bottom-info" data-modehall-cta-hint>当前队伍 1/5</div>
      <div class="mh-bottom-actions">
        <button type="button" class="mh-btn-invite" data-modehall-drawer-toggle="sidebar">邀请好友</button>
        <button type="button" class="mh-btn-start" data-modehall-start>开始游戏</button>
      </div>
    </div>

    <!-- 段位详情抽屉 -->
    <div class="mh-rankdrawer-backdrop" data-modehall-rank-backdrop></div>
    <aside class="mh-rank-drawer" data-drawer-name="rankdetail">
      <div class="mh-rank-drawer-header">
        <div class="mh-rank-drawer-title">段位系统</div>
        <button type="button" class="mh-friends-close" data-modehall-rank-backdrop>✕</button>
      </div>
      <div class="mh-rank-drawer-body" data-modehall-rank-tiers></div>
    </aside>

    <!-- 隐藏占位（保持旧 render 方法不报错） -->
    <div hidden>
      <canvas class="mode-hall-hero-canvas" data-modehall-hero-canvas width="1" height="1"></canvas>
      <div data-modehall-title-caption></div>
      <div data-modehall-stage-overline></div>
      <div data-modehall-stage-title></div>
      <div data-modehall-stage-subtitle></div>
      <div data-modehall-stage-meta></div>
      <div data-modehall-stage-watermark></div>
      <div data-modehall-spotlights></div>
      <div data-modehall-stage-notches></div>
      <div data-modehall-stage-rail></div>
      <div data-modehall-stage-brief-grid></div>
      <div data-modehall-header-ribbon></div>
      <div data-modehall-cta-label></div>
      <div data-modehall-cta-detail></div>
      <div data-modehall-cta-kicker></div>
      <div data-modehall-hud-left></div>
      <div data-modehall-queue-tabs></div>
      <div data-modehall-tray-tabs></div>
      <div data-modehall-tray-content></div>
      <div data-modehall-sidebar-summary></div>
      <div data-modehall-sidebar-tabs></div>
      <div data-modehall-sidebar-list></div>
      <div data-modehall-party-kicker></div>
      <div data-modehall-party-title></div>
      <div data-modehall-party-hint></div>
      <div data-modehall-party-toggle></div>
      <div data-modehall-party-body>
        <div data-room-status></div>
        <div data-room-code></div>
        <div data-room-capacity></div>
        <div data-room-code-input></div>
        <div data-room-copy></div>
        <div data-room-action="create"></div>
        <div data-room-action="join"></div>
        <div data-room-action="ready"></div>
        <div data-room-action="leave"></div>
        <div data-room-members></div>
        <div data-room-tip></div>
      </div>
    </div>

    <!-- 好友抽屉 -->
    <div class="mh-friends-backdrop" data-modehall-backdrop></div>
    <aside class="mh-friends-drawer" data-drawer-name="sidebar">
      <div class="mh-friends-header">
        <div>
          <div class="mh-friends-title">好友列表</div>
          <div class="mh-friends-subtitle" data-modehall-friends-count></div>
        </div>
        <button type="button" class="mh-friends-close" data-modehall-backdrop>✕</button>
      </div>
      <div class="mh-friends-list" data-modehall-friends-list></div>
    </aside>
  `;
}

export function buildHudMarkup(mode: ModeDefinition): string {
  const hud = mode.hall.identityHud;
  return `
    <div class="mode-hall-hud-top">
      <span class="mode-hall-panel-kicker">${escapeHtml(hud.kicker)}</span>
      <div class="mode-hall-hud-badge">${escapeHtml(hud.badge)}</div>
    </div>
    <div class="mode-hall-hud-headline">
      <span class="mode-hall-hud-icon">${renderLobbyIcon(mode.iconId, "mode-hall-hud-svg")}</span>
      <div>
        <strong>${escapeHtml(hud.title)}</strong>
        <p>${escapeHtml(hud.subtitle)}</p>
      </div>
    </div>
    <div class="mode-hall-hud-chips">${hud.chips.map((chip) => `<span class="mode-hall-mini-chip">${escapeHtml(chip)}</span>`).join("")}</div>
    <div class="mode-hall-hud-stats">
      ${hud.stats
      .map(
        (stat) => `
            <article class="mode-hall-hud-stat">
              <span>${escapeHtml(stat.label)}</span>
              <strong>${escapeHtml(stat.value)}</strong>
              <small>${escapeHtml(stat.note)}</small>
            </article>
          `,
      )
      .join("")}
    </div>
  `;
}

export function buildStageMeta(mode: ModeDefinition): string {
  const chips = [mode.hall.identityHud.badge, ...mode.hall.identityHud.chips.slice(0, 3)];
  return chips
    .map(
      (chip) =>
        `<span class="mode-hall-mini-chip mode-hall-mini-chip--accent">${escapeHtml(chip)}</span>`,
    )
    .join("");
}

export function buildStageBriefCards(
  mode: ModeDefinition,
  activeVariant: ModeQueueVariant | null,
): string {
  const statCards = mode.hall.identityHud.stats.slice(0, 3).map((stat) => ({
    label: stat.label,
    value: stat.value,
    note: stat.note,
  }));
  const guideCard = mode.hall.traySections.guide.cards[0];
  const cards = [
    ...statCards,
    {
      label: activeVariant ? `${activeVariant.label} 节奏` : "玩法介绍",
      value: activeVariant?.subtitle ?? guideCard.headline,
      note: activeVariant?.hint ?? guideCard.copy,
    },
  ];

  return cards
    .map(
      (card) => `
        <article class="mh-stat-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <small>${escapeHtml(card.note)}</small>
        </article>
      `,
    )
    .join("");
}

export function buildHeaderRibbon(
  eta: string,
  minPlayers: number,
  queueLabel: string,
): string {
  return [
    ["预计匹配", eta],
    ["开局门槛", `${minPlayers}人`],
    ["当前队列", queueLabel],
  ]
    .map(
      ([label, value]) => `
        <span class="mh-ribbon-chip">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </span>
      `,
    )
    .join("");
}

export function buildQueueTabs(
  variants: ModeQueueVariant[],
  activeQueueVariantId: string | null,
): string {
  return variants
    .map((variant) => {
      const active = variant.id === activeQueueVariantId;
      return `
        <button type="button" class="mh-queue-tab${active ? " is-active" : ""}" data-queue-variant="${escapeHtml(variant.id)}" aria-pressed="${active ? "true" : "false"}">
          <strong>${escapeHtml(variant.label)}</strong>
          <span>${escapeHtml(variant.subtitle)}</span>
          <small>${escapeHtml(variant.hint)}</small>
        </button>
      `;
    })
    .join("");
}

export function buildSidebarSummary(mode: ModeDefinition): string {
  const summary = mode.hall.sidebarSummary;
  return `
    <span class="mode-hall-panel-kicker">${escapeHtml(summary.kicker)}</span>
    <strong>${escapeHtml(summary.title)}</strong>
    <p>${escapeHtml(summary.description)}</p>
    <div class="mode-hall-sidebar-chips">
      ${summary.chips.map((chip) => `<span class="mode-hall-mini-chip">${escapeHtml(chip)}</span>`).join("")}
    </div>
  `;
}

export function buildSidebarTabs(activeSidebarTab: ModeSidebarTabId): string {
  const items: Array<[ModeSidebarTabId, string]> = [
    ["friends", "好友"],
    ["leaderboard", "榜单"],
    ["spectate", "观战"],
  ];
  return items
    .map(([id, label]) => {
      const active = id === activeSidebarTab;
      return `<button type="button" class="mode-hall-segment${active ? " is-active" : ""}" data-sidebar-tab="${id}" aria-pressed="${active ? "true" : "false"}">${label}</button>`;
    })
    .join("");
}

export function buildSidebarList(rows: ModeSidebarEntry[]): string {
  return rows
    .map(
      (row) => `
        <button type="button" class="mode-hall-list-row">
          <span class="mode-hall-list-orb">${escapeHtml(getInitialGlyph(row.title))}</span>
          <div class="mode-hall-list-copy">
            <strong>${escapeHtml(row.title)}</strong>
            <span>${escapeHtml(row.meta)}</span>
          </div>
          <em>${escapeHtml(row.badge)}</em>
        </button>
      `,
    )
    .join("");
}

export function buildTrayTabs(
  mode: ModeDefinition,
  activeTrayTab: ModeHallTabId,
): string {
  const tabs: ModeHallTabId[] = ["rules", "rewards", "records", "guide"];
  return tabs
    .map((tabId) => {
      const active = tabId === activeTrayTab;
      return `<button type="button" class="mh-tray-tab${active ? " is-active" : ""}" data-tray-tab="${tabId}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(mode.hall.traySections[tabId].label)}</button>`;
    })
    .join("");
}

export function buildTrayContent(
  mode: ModeDefinition,
  activeTrayTab: ModeHallTabId,
): string {
  const traySection = mode.hall.traySections[activeTrayTab];
  return `
    <div class="mh-tray-head">
      <strong>${escapeHtml(traySection.title)}</strong>
      <p>${escapeHtml(traySection.subtitle)}</p>
    </div>
    <div class="mh-tray-cards">
      ${traySection.cards
      .map(
        (card) => `
            <article class="mh-tray-card">
              <span>${escapeHtml(card.kicker)}</span>
              <strong>${escapeHtml(card.headline)}</strong>
              <p>${escapeHtml(card.copy)}</p>
            </article>
          `,
      )
      .join("")}
    </div>
  `;
}

export function buildPartyMembers(
  mode: ModeDefinition,
  roomState: ModeHallRoomSnapshot,
): string {
  if (!mode.social.supportsRoom) {
    return `
      <article class="mode-hall-party-member is-empty">
        <span class="mode-hall-list-orb">!</span>
        <div class="mode-hall-list-copy">
          <strong>该模式未开放房间</strong>
          <span>当前只支持直接匹配进入对局</span>
        </div>
        <em>关闭</em>
      </article>
    `;
  }

  const seats = Math.max(mode.social.roomSize, roomState.members.length);
  const rows: string[] = [];
  for (let index = 0; index < seats; index += 1) {
    const member = roomState.members[index];
    if (!member) {
      rows.push(`
        <article class="mode-hall-party-member is-empty">
          <span class="mode-hall-list-orb">${index + 1}</span>
          <div class="mode-hall-list-copy">
            <strong>${roomState.created ? "等待加入" : "空席位"}</strong>
            <span>${roomState.created ? "队伍仍可继续集结" : "创建或加入房间后点亮席位"}</span>
          </div>
          <em>待命</em>
        </article>
      `);
      continue;
    }
    const roleParts = [member.id === roomState.leaderId ? "队长" : member.isBot ? "占位" : "队员"];
    if (member.id === "player") {
      roleParts.push("你");
    }
    rows.push(`
      <article class="mode-hall-party-member${member.ready ? " is-ready" : ""}${member.id === "player" ? " is-self" : ""}">
        <span class="mode-hall-list-orb">${escapeHtml(getInitialGlyph(member.name))}</span>
        <div class="mode-hall-list-copy">
          <strong>${escapeHtml(member.name)}</strong>
          <span>${escapeHtml(roleParts.join(" · "))}</span>
        </div>
        <em>${member.ready ? "已准备" : member.isBot ? "待加入" : "未准备"}</em>
      </article>
    `);
  }
  return rows.join("");
}

export function getInitialGlyph(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "O";
}

export interface CockpitSeat {
  index: number;
  occupied: boolean;
  isSelf: boolean;
  name: string;
  avatarUrl: string | null;
  isOnline: boolean;
  gameId: string;
}

export function buildEmptyCockpitSeats(): string {
  const seats: string[] = [];
  for (let i = 0; i < 5; i++) {
    const isSelf = i === 2; // center position
    seats.push(`
      <button type="button" class="mh-seat${isSelf ? " mh-seat--self" : ""}" data-seat-index="${i}" data-seat-state="${isSelf ? "self" : "empty"}">
        <div class="mh-seat-ring">
          <div class="mh-seat-avatar">
            ${isSelf ? `<span class="mh-seat-glyph">我</span>` : `<span class="material-symbols-outlined mh-seat-plus">add</span>`}
          </div>
          ${isSelf ? `<div class="mh-seat-pulse"></div>` : ""}
        </div>
        <span class="mh-seat-name">${isSelf ? "勇者球球" : "邀请"}</span>
        ${isSelf
        ? `<div class="mh-seat-tags"><span class="mh-seat-badge mh-seat-badge--me">我</span><span class="mh-seat-badge mh-seat-badge--host">房主</span></div>`
        : `<span class="mh-seat-tag">空位</span>`}
      </button>
    `);
  }
  return seats.join("");
}

export function buildCockpitSeats(seats: CockpitSeat[]): string {
  return seats.map((seat) => {
    const stateAttr = seat.isSelf ? "self" : seat.occupied ? "filled" : "empty";
    const glyph = seat.isSelf
      ? escapeHtml(getInitialGlyph(seat.name))
      : seat.occupied
        ? escapeHtml(getInitialGlyph(seat.name))
        : "";
    return `
      <button type="button" class="mh-seat${seat.isSelf ? " mh-seat--self" : ""}${seat.occupied && !seat.isSelf ? " mh-seat--filled" : ""}" data-seat-index="${seat.index}" data-seat-state="${stateAttr}" data-seat-game-id="${escapeHtml(seat.gameId)}">
        <div class="mh-seat-ring">
          <div class="mh-seat-avatar">
            ${seat.occupied
        ? `<span class="mh-seat-glyph">${glyph}</span>`
        : `<span class="material-symbols-outlined mh-seat-plus">add</span>`}
          </div>
          ${seat.isSelf ? `<div class="mh-seat-pulse"></div>` : ""}
          ${seat.occupied && seat.isOnline && !seat.isSelf ? `<div class="mh-seat-online"></div>` : ""}
        </div>
        <span class="mh-seat-name">${seat.occupied ? escapeHtml(seat.name) : "邀请"}</span>
        ${seat.isSelf
        ? `<div class="mh-seat-tags"><span class="mh-seat-badge mh-seat-badge--me">我</span><span class="mh-seat-badge mh-seat-badge--host">房主</span></div>`
        : seat.occupied
          ? `<span class="mh-seat-tag">${seat.isOnline ? "已加入" : "离线"}</span>`
          : `<span class="mh-seat-tag">空位</span>`}
      </button>
    `;
  }).join("");
}

/** Build rank tiers list for the rank detail drawer */
export function buildRankTiersList(currentRank: RankInfo): string {
  return RANK_TIERS.map((tier, idx) => {
    const isCurrent = idx === currentRank.tierIndex;
    const isPast = idx < currentRank.tierIndex;
    const ms = getMaxStars(tier);
    const starsHtml = buildStarsSvg(
      isCurrent ? currentRank.stars : isPast ? ms : 0,
      ms, tier.color1, 5
    );
    const totalPts = tier.pointsPerDiv * tier.divisions;
    const divLabel = tier.isElite
      ? "全国前 500 专属"
      : `${tier.divisions} 个大段 · 每段 ${tier.pointsPerDiv} 分 · 共 ${totalPts} 分`;
    const dummyRank: RankInfo = { tierIndex: idx, division: 1, points: 0, stars: isCurrent ? currentRank.stars : isPast ? ms : 0, totalPoints: 0 };
    return `
      <div class="mh-ranktier-row${isCurrent ? " mh-ranktier-row--current" : ""}${isPast ? " mh-ranktier-row--past" : ""}">
        <div class="mh-ranktier-emblem">${buildRankEmblemSvg(dummyRank, 48)}</div>
        <div class="mh-ranktier-info">
          <div class="mh-ranktier-name" style="color:${tier.color1}">${escapeHtml(tier.label)}</div>
          <div class="mh-ranktier-stars">${starsHtml}</div>
          <div class="mh-ranktier-desc">${divLabel}${isCurrent ? " · <b>当前段位</b>" : ""}</div>
          <div class="mh-ranktier-subdesc">${escapeHtml(tier.description)}</div>
        </div>
        ${isCurrent ? `<span class="mh-ranktier-badge">当前</span>` : isPast ? `<span class="mh-ranktier-check">✓</span>` : ""}
      </div>`;
  }).join("");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
