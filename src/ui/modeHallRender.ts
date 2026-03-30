import type {
  ModeDefinition,
  ModeHallRoomSnapshot,
  ModeHallTabId,
  ModeQueueVariant,
  ModeSidebarEntry,
  ModeSidebarTabId,
} from "../modes/definitions";
import { renderLobbyIcon } from "./icons";

export function buildModeHallTemplate(): string {
  return `
    <div class="mode-hall-backdrop mode-hall-backdrop--v2"></div>
    <section class="mode-hall-shell mode-hall-shell--scene" aria-label="模式分厅">
      <header class="mode-hall-header mode-hall-header--scene">
        <div class="mode-hall-header-main">
          <button type="button" class="mode-hall-header-btn mode-hall-header-btn--ghost" data-modehall-back>返回大厅</button>
          <div class="mode-hall-title-wrap">
            <div class="mode-hall-kicker" data-modehall-kicker>MODE HALL</div>
            <h2 data-modehall-title>模式分厅</h2>
            <p class="mode-hall-title-caption" data-modehall-title-caption>游戏主舞台准备中</p>
          </div>
        </div>
        <div class="mode-hall-header-ribbon" data-modehall-header-ribbon></div>
        <div class="mode-hall-header-actions">
          <button type="button" class="mode-hall-header-btn" data-modehall-settings>分厅设置</button>
        </div>
      </header>

      <div class="mode-hall-scene-grid">
        <section class="mode-hall-stage-area">
          <div class="mode-hall-stage-topline">
            <div class="mode-hall-stage-copy">
              <span class="mode-hall-stage-overline" data-modehall-stage-overline></span>
              <h3 data-modehall-stage-title></h3>
              <p data-modehall-stage-subtitle></p>
            </div>
            <div class="mode-hall-queue-tabs" data-modehall-queue-tabs></div>
          </div>

          <div class="mode-hall-stage-shell mode-hall-surface-card">
            <div class="mode-hall-stage-watermark" data-modehall-stage-watermark></div>
            <div class="mode-hall-stage-view">
              <div class="mode-hall-stage-hero">
                <div class="mode-hall-stage-aura"></div>
                <div class="mode-hall-stage-gridline"></div>
                <div class="mode-hall-stage-orbit mode-hall-stage-orbit--outer"></div>
                <div class="mode-hall-stage-orbit mode-hall-stage-orbit--inner"></div>
                <canvas class="mode-hall-hero-canvas" data-modehall-hero-canvas></canvas>
                <div class="mode-hall-stage-spotlights" data-modehall-spotlights></div>
              </div>
              <aside class="mode-hall-stage-rail" data-modehall-stage-rail></aside>
            </div>
            <div class="mode-hall-stage-statusbar">
              <div class="mode-hall-stage-notches" data-modehall-stage-notches></div>
              <div class="mode-hall-stage-cta" data-modehall-main-cta>
                <div class="mode-hall-cta-copy">
                  <span class="mode-hall-cta-kicker" data-modehall-cta-kicker></span>
                  <strong data-modehall-cta-label></strong>
                  <span data-modehall-cta-hint></span>
                </div>
                <button type="button" class="mode-hall-cta-button" data-modehall-start>开始</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 抽屉遮罩 -->
      <div class="mode-hall-drawer-backdrop" data-modehall-backdrop></div>

      <!-- 弹簧 Dock 导航 -->
      <nav class="mode-hall-floating-dock glass-panel-jelly">
        <button type="button" class="mode-hall-dock-btn" data-modehall-drawer-toggle="hud">
          <span class="material-symbols-outlined mode-hall-dock-symbol">info</span>
          <span>模式信息</span>
        </button>
        <button type="button" class="mode-hall-dock-btn" data-modehall-drawer-toggle="sidebar">
          <span class="material-symbols-outlined mode-hall-dock-symbol">group</span>
          <span>社交大厅</span>
        </button>
      </nav>

      <!-- 左侧抽屉：HUD 面板 -->
      <aside class="mode-hall-drawer mode-hall-surface-card is-left" data-drawer-name="hud">
          <div class="mode-hall-hud-left" data-modehall-hud-left style="padding:0; box-shadow:none; border:none; background:transparent;"></div>
      </aside>

      <!-- 右侧抽屉：社交面板 + 房间管理 -->
      <aside class="mode-hall-drawer mode-hall-surface-card is-right" data-drawer-name="sidebar" style="overflow-y:auto;">
          <section class="mode-hall-party-panel" data-modehall-party-panel style="padding:0; box-shadow:none; border:none; background:transparent; margin-bottom:20px;">
            <div class="mode-hall-party-head">
              <div class="mode-hall-party-copy">
                <span class="mode-hall-panel-kicker" data-modehall-party-kicker></span>
                <strong data-modehall-party-title></strong>
                <p data-modehall-party-hint></p>
              </div>
              <button type="button" class="mode-hall-header-btn" data-modehall-party-toggle>展开</button>
            </div>
            <div class="mode-hall-party-body" data-modehall-party-body>
              <div class="mode-hall-party-strip">
                <article class="mode-hall-party-chip"><span>房间状态</span><strong data-room-status>待集结</strong></article>
                <article class="mode-hall-party-chip"><span>房间码</span><strong data-room-code>----</strong></article>
                <article class="mode-hall-party-chip"><span>队伍席位</span><strong data-room-capacity>0 / 0</strong></article>
              </div>
              <div class="mode-hall-party-entry">
                <label class="mode-hall-party-entry-label" for="mode-hall-room-code-input">加入房间码</label>
                <div class="mode-hall-party-entry-row">
                  <input id="mode-hall-room-code-input" class="mode-hall-room-input" data-room-code-input type="text" maxlength="8" autocomplete="off" spellcheck="false" placeholder="输入房间码" />
                  <button type="button" class="mode-hall-room-copy" data-room-copy>复制邀请码</button>
                </div>
              </div>
              <div class="mode-hall-party-actions">
                <button type="button" data-room-action="create"><span>创建房间</span><small>拉好友集结</small></button>
                <button type="button" data-room-action="join"><span>加入房间</span><small>输入房间码归队</small></button>
                <button type="button" data-room-action="ready"><span>切换准备</span><small>同步当前席位</small></button>
                <button type="button" data-room-action="leave"><span>离开房间</span><small>退出当前编队</small></button>
              </div>
              <div class="mode-hall-party-members" data-room-members></div>
              <div class="mode-hall-party-tip" data-room-tip>私人模式链路待连接。</div>
            </div>
          </section>

          <aside class="mode-hall-sidebar-right" style="padding:0; box-shadow:none; border:none; background:transparent;">
            <div class="mode-hall-sidebar-summary" data-modehall-sidebar-summary></div>
            <div class="mode-hall-sidebar-tabs" data-modehall-sidebar-tabs></div>
            <div class="mode-hall-sidebar-list" data-modehall-sidebar-list></div>
          </aside>
      </aside>

    </section>
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
        <article class="mode-hall-ribbon-chip">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
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
        <button type="button" class="mode-hall-segment${active ? " is-active" : ""}" data-queue-variant="${escapeHtml(variant.id)}" aria-pressed="${active ? "true" : "false"}">
          <strong>${escapeHtml(variant.label)}</strong>
          <span>${escapeHtml(variant.subtitle)}</span>
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
      return `<button type="button" class="mode-hall-segment${active ? " is-active" : ""}" data-tray-tab="${tabId}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(mode.hall.traySections[tabId].label)}</button>`;
    })
    .join("");
}

export function buildTrayContent(
  mode: ModeDefinition,
  activeTrayTab: ModeHallTabId,
): string {
  const traySection = mode.hall.traySections[activeTrayTab];
  return `
    <div class="mode-hall-tray-head">
      <div>
        <span class="mode-hall-panel-kicker">${escapeHtml(traySection.label)}</span>
        <strong>${escapeHtml(traySection.title)}</strong>
        <p>${escapeHtml(traySection.subtitle)}</p>
      </div>
    </div>
    <div class="mode-hall-tray-cards">
      ${traySection.cards
        .map(
          (card) => `
            <article class="mode-hall-tray-card">
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

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
