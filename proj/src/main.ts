interface Enemy {
  id: string;
  entity: any;
  targetPosition: { x: number; y: number };
  speed: number;
  health: number;
}

interface Position2D {
  x: number;
  y: number;
}

interface TowerInstance {
  target: any;
  sphere: any | null;
  circle: any | null;
  movingText: any | null;
  buildRing: any | null;
  homePosition: Position2D | null;
  lastPosition: Position2D | null;
  isMoving: boolean;
  lastMovementTime: number;
  lastShotTime: number;
  fireRateMs: number;
  range: number;
}

type UpgradeId =
  | "tower-count"
  | "range"
  | "base-health"
  | "fire-rate"
  | "rebuild-speed"
  | "wave-skip";

interface UpgradeLevel<T = number> {
  value: T;
  cost: number; // cost to reach this level from previous level
}

interface UpgradeDefinition<T = number> {
  id: UpgradeId;
  name: string;
  desc: string;
  levels: UpgradeLevel<T>[]; // levels[0] is starting level
  format: (v: T) => string;
}

interface UpgradeState {
  [key: string]: number; // level per upgrade id
}

class TowerDefenseGame {
  private scene: any;
  private baseTarget: any;
  private towerTarget: any;
  private enemies: Map<string, Enemy> = new Map();
  private enemyIdCounter = 0;
  private spawnInterval: number | null = null;
  private gameLoop: number | null = null;

  // Game state
  private health = 100;
  private points = 0;
  private gameOver = false;
  private gameWon = false;

  // UI elements
  private healthElement: HTMLElement | null = null;
  private pointsElement: HTMLElement | null = null;
  private waveElement: HTMLElement | null = null;
  private waveStartIndicator: HTMLElement | null = null;
  private waveStartIndicatorTimeout: number | null = null;
  private upgradeScreen: HTMLElement | null = null;
  private blurElement: HTMLElement | null = null;
  private upgradePointsElement: HTMLElement | null = null;
  private restartButton: HTMLElement | null = null;
  private upgradeListElement: HTMLElement | null = null;
  private winPopup: HTMLElement | null = null;
  private winBlur: HTMLElement | null = null;
  private winRestartButton: HTMLElement | null = null;
  private winResetButton: HTMLElement | null = null;
  private winAttemptsElement: HTMLElement | null = null;
  private shopVisits = 0;
  private readonly SHOP_VISITS_STORAGE_KEY = "td_shop_visits";

  // MindAR overlay elements (custom UI)
  private mindarLoadingOverlay: HTMLElement | null = null;
  private mindarScanningOverlay: HTMLElement | null = null;
  private mindarErrorOverlay: HTMLElement | null = null;
  private mindarTrackedCount = 0;

  // Tower state tracking (per-tower handled via towers[])
  private readonly MOVEMENT_THRESHOLD = 0.3;
  private readonly STABILITY_BASE_TIME = 3000;
  private towerStabilityTimeMs = this.STABILITY_BASE_TIME;
  private towerLostTimes: Map<any, number> = new Map(); // Track when each tower was last lost
  private readonly TOWER_LOST_GRACE_PERIOD = 100; // ms to wait after targetLost before allowing attacks again
  private towerTrackedTargets: WeakSet<any> = new WeakSet();
  private towerListenerTargets: WeakSet<any> = new WeakSet();
  // Upgradeable tower properties
  private readonly TOWER_BASE_RANGE = 700;
  private readonly TOWER_BASE_RADIUS = 0.7; // visual circle radius baseline
  private towerFireRateMs: number = 2000;
  private towerRange: number = this.TOWER_BASE_RANGE;
  // Multi-tower support
  private towers: TowerInstance[] = [];

  // Base and scoring (upgradeable)
  private defaultBaseHealth: number = 100;
  private pointMultiplier: number = 1;

  private readonly SPAWN_DISTANCE = 5;
  private readonly MIN_SPAWN_TIME = 10; // fastest spawn interval
  private readonly GAME_Z_PLANE = 0;

  // Spawn properties
  private spawnCount = 0;
  private spawnCenterAngle = 0;

  // Wave system
  private currentWave = 0;
  private totalWaves = 10;
  private waveActive = false;
  private wavePaused = false; // track if wave is paused due to target loss
  private enemiesSpawnedInWave = 0;
  private waveBreakDuration = 5000; // 5 second break between waves
  private pausedWaveConfig: any = null; // store config during pause
  private pausedWaveCompleted = false; // track if we've completed spawning during pause
  private waveConfig = [
    { count: 5, baseSpeed: 0.5, spreadAngle: 10, duration: 6000 },
    { count: 10, baseSpeed: 0.5, spreadAngle: 30, duration: 8000 },
    { count: 15, baseSpeed: 0.75, spreadAngle: 60, duration: 10000 },
    { count: 20, baseSpeed: 1, spreadAngle: 90, duration: 10000 },
    { count: 30, baseSpeed: 1.2, spreadAngle: 120, duration: 10000 },
    { count: 50, baseSpeed: 1.5, spreadAngle: 180, duration: 12000 },
    { count: 70, baseSpeed: 2, spreadAngle: 240, duration: 12000 },
    { count: 100, baseSpeed: 2.5, spreadAngle: 300, duration: 15000 },
    { count: 200, baseSpeed: 3, spreadAngle: 330, duration: 20000 },
    { count: 500, baseSpeed: 4, spreadAngle: 360, duration: 30000 },
  ];

  // Upgrades configuration and state
  private readonly UPGRADE_STORAGE_KEY = "td_upgrades";
  private readonly POINTS_STORAGE_KEY = "td_points";
  private upgradeDefs: UpgradeDefinition<number>[] = [
    {
      id: "tower-count",
      name: "Tower Count",
      desc: "Add an additional tower",
      levels: [
        { value: 1, cost: 0 },
        { value: 2, cost: 50 },
        { value: 3, cost: 100 },
      ],
      format: (v) => `${v}`,
    },
    {
      id: "range",
      name: "Tower Range",
      desc: "Increase tower attack range",
      levels: [
        { value: 1.0, cost: 0 },
        { value: 1.2, cost: 5 },
        { value: 1.5, cost: 10 },
        { value: 1.8, cost: 20 },
        { value: 2.0, cost: 30 },
        { value: 2.5, cost: 50 },
        { value: 3.0, cost: 70 },
      ],
      format: (v) => `x${v.toFixed(1)}`,
    },
    {
      id: "fire-rate",
      name: "Tower Fire Rate",
      desc: "Reduce shooting cooldown",
      levels: [
        { value: 2000, cost: 0 },
        { value: 1800, cost: 5 },
        { value: 1600, cost: 10 },
        { value: 1400, cost: 15 },
        { value: 1200, cost: 20 },
        { value: 1000, cost: 35 },
        { value: 800, cost: 40 },
        { value: 500, cost: 50 },
        { value: 300, cost: 60 },
        { value: 200, cost: 70 },
        { value: 100, cost: 80 },
      ],
      format: (v) => `${Math.round(v)}ms`,
    },
    {
      id: "rebuild-speed",
      name: "Rebuild Speed",
      desc: "Towers stabilize faster after moving",
      levels: [
        { value: 3000, cost: 0 },
        { value: 2500, cost: 10 },
        { value: 2000, cost: 20 },
        { value: 1500, cost: 30 },
        { value: 1000, cost: 40 },
        { value: 750, cost: 50 },
        { value: 500, cost: 60 },
        { value: 250, cost: 70 },
        { value: 100, cost: 80 },
      ],
      format: (v) => `${Math.round(v)}ms`,
    },
    {
      id: "base-health",
      name: "Base Health",
      desc: "Increase base max health",
      levels: [
        { value: 100, cost: 0 },
        { value: 150, cost: 10 },
        { value: 200, cost: 20 },
        { value: 300, cost: 30 },
        { value: 500, cost: 50 },
      ],
      format: (v) => `${v}`,
    },
    {
      id: "wave-skip",
      name: "Wave Skip",
      desc: "Start new runs on a later wave",
      levels: [
        { value: 1, cost: 0 },
        { value: 2, cost: 25 },
        { value: 3, cost: 50 },
        { value: 4, cost: 75 },
        { value: 5, cost: 100 },
      ],
      format: (v) => `Wave ${v}`,
    },
  ];
  private upgradeState: UpgradeState = {};

  constructor() {
    this.init();
  }

  private init() {
    // Check if running on desktop and show popup
    this.showDesktopPopupIfNeeded();

    document.addEventListener("DOMContentLoaded", () => {
      this.scene = document.querySelector("a-scene");

      this.mindarLoadingOverlay = document.getElementById("custom-loading");
      this.mindarScanningOverlay = document.getElementById("custom-scanning");
      this.mindarErrorOverlay = document.getElementById("custom-error");
      this.setupMindarOverlayUi();

      // Initialize UI elements
      this.healthElement = document.getElementById("health-value");
      this.pointsElement = document.getElementById("energy-value");
      this.waveElement = document.getElementById("wave-value");
      this.waveStartIndicator = document.getElementById("wave-start-indicator");
      this.upgradeScreen = document.getElementById("upgrade-screen");
      this.blurElement = document.getElementById("blur");
      this.upgradePointsElement = document.getElementById("upgrade-energy");
      this.upgradeListElement = document.getElementById("upgrade-list");
      this.restartButton = document.getElementById("restart-btn");
      this.winPopup = document.getElementById("win-popup");
      this.winBlur = document.getElementById("win-blur");
      this.winResetButton = document.getElementById("win-reset-btn");
      this.winAttemptsElement = document.getElementById("win-attempts");
      // Add restart button listener
      if (this.restartButton) {
        this.restartButton.addEventListener("click", () => {
          this.restartGame();
        });
      }

      if (this.winRestartButton) {
        this.winRestartButton.addEventListener("click", () => {
          this.hideWinPopup();
          this.restartGame();
        });
      }

      if (this.winResetButton) {
        this.winResetButton.addEventListener("click", () => {
          this.resetAllProgress();
        });
      }

      // Add help button listener
      const helpBtn = document.getElementById("help-btn");
      const helpPopup = document.getElementById("help-popup");
      const closeHelpBtn = document.getElementById("close-help");
      const helpBlur = document.getElementById("help-blur");
      const helpResetBtn = document.getElementById("help-reset-btn");

      if (helpBtn && helpPopup) {
        helpBtn.addEventListener("click", () => {
          helpPopup.style.display = "flex";
          if (helpBlur) helpBlur.style.display = "block";
        });
      }

      if (closeHelpBtn && helpPopup) {
        closeHelpBtn.addEventListener("click", () => {
          helpPopup.style.display = "none";
          if (helpBlur) helpBlur.style.display = "none";
        });
      }

      if (helpBlur && helpPopup) {
        helpBlur.addEventListener("click", () => {
          helpPopup.style.display = "none";
          helpBlur.style.display = "none";
        });
      }

      if (helpResetBtn) {
        helpResetBtn.addEventListener("click", () => {
          this.resetAllProgress();
        });
      }

      // Load persisted upgrade state
      this.loadUpgradeState();
      this.loadPoints();
      this.loadShopVisits();
      this.applyUpgradeEffects();

      // Initialize towers + register their targetFound/targetLost listeners ASAP.
      // This prevents missing targetFound if the marker is already in view when MindAR starts.
      this.initializeTowersFromUpgrades();
      this.registerTowerEventListeners();

      if (this.scene.hasLoaded) {
        this.setupGame();
      } else {
        this.scene.addEventListener("loaded", () => {
          this.setupGame();
        });
      }
    });
  }

  private setMindarOverlayVisible(el: HTMLElement | null, visible: boolean) {
    if (!el) return;
    el.style.display = visible ? "flex" : "none";
  }

  private showMindarOverlay(kind: "loading" | "scanning" | "error" | "none") {
    this.setMindarOverlayVisible(this.mindarLoadingOverlay, kind === "loading");
    this.setMindarOverlayVisible(
      this.mindarScanningOverlay,
      kind === "scanning",
    );
    this.setMindarOverlayVisible(this.mindarErrorOverlay, kind === "error");
  }

  private setupMindarOverlayUi() {
    // Default state: show loading until MindAR says it's ready.
    this.showMindarOverlay("loading");

    if (!this.scene) return;

    // MindAR lifecycle events
    this.scene.addEventListener(
      "arReady",
      () => {
        this.mindarTrackedCount = 0;
        this.showMindarOverlay("scanning");
      },
      { once: true },
    );

    this.scene.addEventListener("arError", () => {
      this.showMindarOverlay("error");
    });

    // Target events (bubble on most implementations, but we attach directly to be safe)
    const targets = Array.from(
      document.querySelectorAll("[mindar-image-target]"),
    ) as any[];

    targets.forEach((el) => {
      el.addEventListener("targetFound", () => {
        this.mindarTrackedCount += 1;
        this.showMindarOverlay("none");
      });
      el.addEventListener("targetLost", () => {
        this.mindarTrackedCount = Math.max(0, this.mindarTrackedCount - 1);
        if (this.mindarTrackedCount === 0) {
          this.showMindarOverlay("scanning");
        }
      });
    });
  }

  private showDesktopPopupIfNeeded() {
    // Detect if device is mobile or desktop
    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );

    const popup = document.getElementById("desktop-popup");
    const closeBtn = document.getElementById("close-popup");
    const popupBlur = popup?.querySelector("#blur") as HTMLElement | null;

    if (!isMobile && popup) {
      // Show popup on desktop
      popup.style.display = "flex";
      if (popupBlur) popupBlur.style.display = "block";

      // Close button handler
      if (closeBtn) {
        closeBtn.addEventListener("click", () => {
          popup.style.display = "none";
          if (popupBlur) popupBlur.style.display = "none";
        });
      }

      // Close when clicking on blur
      if (popupBlur) {
        popupBlur.addEventListener("click", () => {
          popup.style.display = "none";
          popupBlur.style.display = "none";
        });
      }
    }
  }

  private setupGame() {
    this.baseTarget = document.querySelector(
      '[mindar-image-target="targetIndex: 0"]',
    );
    this.towerTarget = document.querySelector(
      '[mindar-image-target="targetIndex: 1"]',
    );

    if (!this.baseTarget || !this.towerTarget) {
      console.error("Could not find base or tower targets");
      return;
    }

    this.baseTarget.addEventListener("targetFound", () => {
      this.startEnemySpawning();
    });

    this.baseTarget.addEventListener("targetLost", () => {
      // pause spawning due to base lost, but do not reset progression
      this.stopEnemySpawning(false);
    });

    this.startGameLoop();
  }

  private registerTowerEventListeners() {
    this.towers.forEach((tower) => {
      if (this.towerListenerTargets.has(tower.target)) {
        return;
      }
      this.towerListenerTargets.add(tower.target);

      tower.target.addEventListener("targetFound", () => {
        this.towerTrackedTargets.add(tower.target);
        this.towerLostTimes.delete(tower.target);

        // Force into building/moving state on appearance
        tower.isMoving = true;
        tower.lastMovementTime = 0;
        tower.homePosition = null;
        tower.lastPosition = null;

        this.setupTowerVisualsForTower(tower);
      });

      tower.target.addEventListener("targetLost", () => {
        this.towerTrackedTargets.delete(tower.target);
        this.towerLostTimes.set(tower.target, Date.now());
        this.handleTowerLostForTower(tower);
      });
    });
  }

  private forceTrackedTowersIntoBuildingState() {
    this.towers.forEach((tower) => {
      if (!tower.target?.object3D?.visible) return;
      if (!this.towerTrackedTargets.has(tower.target)) return;

      // Reset to building state even if targetFound doesn't re-fire
      this.towerLostTimes.delete(tower.target);
      tower.isMoving = true;
      tower.lastMovementTime = 0;
      tower.homePosition = null;
      tower.lastPosition = null;
      tower.lastShotTime = 0;

      this.setupTowerVisualsForTower(tower);
    });
  }

  private startEnemySpawning() {
    if (this.gameWon) {
      return;
    }

    if (this.wavePaused && this.currentWave > 0) {
      // Resume a paused wave
      this.wavePaused = false;
      this.waveActive = true;
      this.resumeWave();
    } else if (this.currentWave === 0) {
      // Start a new game
      this.currentWave = this.getStartingWaveForNewGame();
      this.startWave();
    }
  }

  private getStartingWaveForNewGame(): number {
    const desired = Math.round(this.getUpgradeCurrentValueById("wave-skip"));
    const clamped = Math.max(1, Math.min(this.totalWaves, desired));
    return clamped;
  }

  private initializeTowersFromUpgrades() {
    const towerCountLevel = this.upgradeState["tower-count"] ?? 0;
    const maxTowers = 1 + towerCountLevel; // Level 0 = 1 tower, Level 1 = 2 towers, Level 2 = 3 towers, etc.

    const existingByTarget = new Map<any, TowerInstance>();
    this.towers.forEach((t) => existingByTarget.set(t.target, t));

    // Collect all tower targets by class (regardless of mindar-image-target state)
    const allTowerElements = Array.from(
      document.querySelectorAll("a-entity.tower"),
    );

    // Show/hide tower elements based on unlock level
    allTowerElements.forEach((el, idx) => {
      const elAny = el as any;
      if (idx < maxTowers) {
        // Unlock this tower - make visible and ensure mindar tracking
        elAny.setAttribute("visible", "true");
        if (elAny.object3D) elAny.object3D.visible = true;
        // Show all children
        el.querySelectorAll("*").forEach((child) => {
          (child as any).setAttribute("visible", "true");
          if ((child as any).object3D) (child as any).object3D.visible = true;
        });
        // Restore mindar-image-target if it was removed
        if (!el.hasAttribute("mindar-image-target")) {
          elAny.setAttribute("mindar-image-target", `targetIndex: ${idx + 1}`);
        }
      } else {
        // Lock this tower - hide it completely and remove from tracking
        elAny.setAttribute("visible", "false");
        if (elAny.object3D) elAny.object3D.visible = false;
        // Hide all children
        el.querySelectorAll("*").forEach((child) => {
          (child as any).setAttribute("visible", "false");
          if ((child as any).object3D) (child as any).object3D.visible = false;
        });
        elAny.removeAttribute("mindar-image-target");
      }
    });

    // Only keep the towers we have unlocked for gameplay
    const activeTowers = allTowerElements.slice(0, maxTowers);

    this.towers = activeTowers.map((targetEl) => {
      const existing = existingByTarget.get(targetEl);
      if (existing) {
        // Reset per-run state but keep object identity so previously-registered listeners still work.
        existing.sphere = null;
        existing.circle = null;
        existing.movingText = null;
        existing.buildRing = null;
        existing.homePosition = null;
        existing.lastPosition = null;
        existing.isMoving = false;
        existing.lastMovementTime = 0;
        existing.lastShotTime = 0;
        existing.fireRateMs = this.towerFireRateMs;
        existing.range = this.towerRange;
        return existing;
      }

      return {
        target: targetEl,
        sphere: null,
        circle: null,
        movingText: null,
        buildRing: null,
        homePosition: null,
        lastPosition: null,
        isMoving: false,
        lastMovementTime: 0,
        lastShotTime: 0,
        fireRateMs: this.towerFireRateMs,
        range: this.towerRange,
      };
    });
  }

  private reinitializeTowersAfterUpgrades() {
    // Deactivate all towers first
    this.towers.forEach((tower) => {
      this.setTowerActiveForTower(tower, false);
      if (tower.movingText) {
        try {
          tower.target.removeChild(tower.movingText);
        } catch {}
        tower.movingText = null;
      }

      if (tower.buildRing) {
        try {
          tower.target.removeChild(tower.buildRing);
        } catch {}
        tower.buildRing = null;
      }
    });

    // Recompute upgraded stats before reinitializing
    this.applyUpgradeEffects();

    // Re-initialize towers based on new upgrade level
    this.initializeTowersFromUpgrades();

    // Register (idempotent) tower events for the refreshed tower list
    this.registerTowerEventListeners();
  }

  private resumeWave() {
    if (!this.pausedWaveConfig || this.currentWave === 0) return;

    const waveConfig = this.pausedWaveConfig;
    const spawnInterval = Math.max(
      this.MIN_SPAWN_TIME,
      Math.round(waveConfig.duration / waveConfig.count),
    );

    const waveCompleted = this.pausedWaveCompleted;

    this.spawnInterval = window.setInterval(() => {
      if (!this.waveActive || waveCompleted) {
        return;
      }

      if (this.enemiesSpawnedInWave < waveConfig.count) {
        this.spawnEnemy();
      } else {
        // Wave complete, clear interval and prepare for next wave
        clearInterval(this.spawnInterval!);
        this.spawnInterval = null;
        this.waveActive = false;
        this.pausedWaveConfig = null;
        if (this.currentWave < this.totalWaves) {
          setTimeout(() => {
            this.currentWave++;
            this.startWave();
          }, this.waveBreakDuration);
        }
      }
    }, spawnInterval);
  }

  private startWave() {
    if (this.currentWave > this.totalWaves || this.gameOver) {
      return;
    }

    const waveConfig = this.waveConfig[this.currentWave - 1];
    this.waveActive = true;
    this.enemiesSpawnedInWave = 0;
    this.wavePaused = false;
    this.pausedWaveCompleted = false;
    this.pausedWaveConfig = waveConfig;
    this.spawnCenterAngle = Math.random() * Math.PI * 2;

    if (this.spawnInterval) {
      clearInterval(this.spawnInterval);
    }

    const spawnIntervalMs = Math.max(
      this.MIN_SPAWN_TIME,
      Math.round(waveConfig.duration / waveConfig.count),
    );

    setTimeout(() => {
      this.updateWaveDisplay();
      this.showWaveStartIndicator();
    }, 2000 / waveConfig.baseSpeed);

    let waveCompleted = false;

    this.spawnInterval = window.setInterval(() => {
      if (this.wavePaused) {
        clearInterval(this.spawnInterval!);
        this.spawnInterval = null;
        this.pausedWaveCompleted = waveCompleted;
        return;
      }

      if (!this.waveActive || waveCompleted) {
        return;
      }

      if (this.enemiesSpawnedInWave < waveConfig.count) {
        this.spawnEnemy();
      } else if (!waveCompleted) {
        waveCompleted = true;
        clearInterval(this.spawnInterval!);
        this.spawnInterval = null;
        this.waveActive = false;
        this.pausedWaveConfig = null;

        if (this.currentWave < this.totalWaves) {
          setTimeout(() => {
            this.currentWave++;
            this.startWave();
          }, this.waveBreakDuration);
        }
      }
    }, spawnIntervalMs);
  }

  private stopEnemySpawning(resetProgress: boolean = true) {
    if (this.spawnInterval) {
      clearInterval(this.spawnInterval);
      this.spawnInterval = null;
    }

    if (resetProgress) {
      this.spawnCount = 0;
      this.currentWave = 0;
      this.waveActive = false;
      this.wavePaused = false;
      this.enemiesSpawnedInWave = 0;
      this.pausedWaveConfig = null;
    } else {
      this.waveActive = false;
      this.wavePaused = true;
    }
  }

  private spawnEnemy() {
    if (this.gameOver || !this.waveActive || this.wavePaused) {
      return;
    }

    if (!this.isBaseVisible()) {
      return;
    }
    const enemyId = `enemy-${this.enemyIdCounter++}`;

    const enemyEntity = document.createElement("a-sphere");
    enemyEntity.setAttribute("id", enemyId);
    enemyEntity.setAttribute("radius", "0.05");
    enemyEntity.setAttribute("color", "#CCFF33");
    enemyEntity.setAttribute("roughness", "1");

    const waveConfig = this.waveConfig[this.currentWave - 1];
    const spreadRadians = (waveConfig.spreadAngle * Math.PI) / 180;
    const angle = this.computeSpawnAngle(spreadRadians);
    const spawnX = Math.cos(angle) * this.SPAWN_DISTANCE;
    const spawnY = Math.sin(angle) * this.SPAWN_DISTANCE;

    enemyEntity.setAttribute(
      "position",
      `${spawnX} ${spawnY} ${this.GAME_Z_PLANE}`,
    );

    this.baseTarget.appendChild(enemyEntity);

    const enemySpeed = waveConfig.baseSpeed;

    const enemy: Enemy = {
      id: enemyId,
      entity: enemyEntity,
      targetPosition: { x: 0, y: 0 },
      speed: enemySpeed,
      health: 1,
    };

    this.enemies.set(enemyId, enemy);
    this.spawnCount++;
    this.enemiesSpawnedInWave++;
  }

  private computeSpawnAngle(spread: number) {
    if (spread >= Math.PI * 2 - 0.001) {
      return Math.random() * Math.PI * 2;
    }
    const offset = (Math.random() - 0.5) * spread;
    return this.spawnCenterAngle + offset;
  }

  private updateTowerCooldownIndicators() {
    const now = Date.now();
    this.towers.forEach((tower) => {
      if (!tower.sphere) return;
      const elapsed = now - tower.lastShotTime;
      if (elapsed < tower.fireRateMs) {
        const t = Math.max(0, Math.min(1, elapsed / tower.fireRateMs));
        const gray = "#330066";
        const purple = "#6600FF";
        const color = this.lerpColorHex(gray, purple, t);
        tower.sphere.setAttribute("color", color);
      } else {
        tower.sphere.setAttribute("color", "#6600FF");
      }
    });
  }

  private lerpColorHex(a: string, b: string, t: number) {
    const ha = a.replace(/^#/, "");
    const hb = b.replace(/^#/, "");
    const ar = parseInt(ha.substring(0, 2), 16);
    const ag = parseInt(ha.substring(2, 4), 16);
    const ab = parseInt(ha.substring(4, 6), 16);
    const br = parseInt(hb.substring(0, 2), 16);
    const bg = parseInt(hb.substring(2, 4), 16);
    const bb = parseInt(hb.substring(4, 6), 16);
    const rr = Math.round(ar + (br - ar) * t);
    const rg = Math.round(ag + (bg - ag) * t);
    const rb = Math.round(ab + (bb - ab) * t);
    const toHex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${toHex(rr)}${toHex(rg)}${toHex(rb)}`;
  }

  private isBaseVisible(): boolean {
    return (
      this.baseTarget &&
      this.baseTarget.object3D &&
      this.baseTarget.object3D.visible
    );
  }

  private startGameLoop() {
    const gameUpdate = () => {
      // Update visual cooldown indicator each frame
      this.updateTowerCooldownIndicators();

      this.updateEnemies();
      this.gameLoop = requestAnimationFrame(gameUpdate);
    };

    gameUpdate();
  }

  private updateEnemies() {
    if (this.gameOver) {
      return;
    }

    if (!this.isBaseVisible()) {
      return;
    }

    const deltaTime = 1 / 60;

    // Update each tower's movement and attacks
    this.towers.forEach((tower) => {
      if (this.isTowerVisible(tower) && this.isBaseVisible()) {
        this.checkTowerMovementForTower(tower);
      }
      this.checkTowerAttacksForTower(tower);
    });

    this.enemies.forEach((enemy, enemyId) => {
      const currentPos = enemy.entity.getAttribute("position");

      const direction = {
        x: enemy.targetPosition.x - currentPos.x,
        y: enemy.targetPosition.y - currentPos.y,
      };

      const distance = Math.sqrt(direction.x ** 2 + direction.y ** 2);

      if (distance < 0.2) {
        this.takeDamage(10); // Enemy deals 10 damage
        this.destroyEnemy(enemyId);
        return;
      }

      const normalizedDirection = {
        x: direction.x / distance,
        y: direction.y / distance,
      };

      const newPosition = {
        x: currentPos.x + normalizedDirection.x * enemy.speed * deltaTime,
        y: currentPos.y + normalizedDirection.y * enemy.speed * deltaTime,
        z: this.GAME_Z_PLANE,
      };

      enemy.entity.setAttribute(
        "position",
        `${newPosition.x} ${newPosition.y} ${newPosition.z}`,
      );
    });

    this.checkWinCondition();
  }

  private destroyEnemy(enemyId: string) {
    const enemy = this.enemies.get(enemyId);
    if (enemy) {
      if (enemy.entity.parentNode) {
        enemy.entity.parentNode.removeChild(enemy.entity);
      }
      this.enemies.delete(enemyId);
    }

    this.checkWinCondition();
  }

  private isTowerVisible(tower: TowerInstance): boolean {
    // Only treat a tower as visible if we've actually seen MindAR's targetFound for it.
    if (!tower.target || !this.towerTrackedTargets.has(tower.target)) {
      return false;
    }

    if (!tower.target.object3D || !tower.target.object3D.visible) {
      return false;
    }

    // Check if tower was recently lost (within grace period)
    const lostTime = this.towerLostTimes.get(tower.target);
    if (lostTime && Date.now() - lostTime < this.TOWER_LOST_GRACE_PERIOD) {
      return false;
    }

    return true;
  }

  private isTowerReadyToAttack(tower: TowerInstance): boolean {
    // Tower must be visible
    if (!this.isTowerVisible(tower)) {
      return false;
    }

    // Tower must have been found and stabilized at least once
    // (homePosition is null until first targetFound + movement check completes)
    if (!tower.homePosition) {
      return false;
    }

    // Tower must not be currently moving
    if (tower.isMoving) {
      return false;
    }

    return true;
  }

  private getMarkerWorldPosition(marker: any): Position2D | null {
    if (!marker || !marker.object3D) {
      return null;
    }

    const worldPosition = marker.object3D.getWorldPosition(
      new (window as any).THREE.Vector3(),
    );

    return {
      x: worldPosition.x,
      y: worldPosition.y,
    };
  }

  private checkTowerAttacksForTower(tower: TowerInstance) {
    if (!this.isTowerReadyToAttack(tower)) {
      return;
    }
    const now = Date.now();

    // Enforce firing cooldown: only fire if cooldown has elapsed
    if (now - tower.lastShotTime < tower.fireRateMs) {
      return;
    }

    const towerWorldPosition = this.getMarkerWorldPosition(tower.target);
    if (!towerWorldPosition) {
      return;
    }

    // Find the closest enemy within range and shoot it (one shot per cooldown)
    let closestEnemyId: string | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    this.enemies.forEach((enemy, enemyId) => {
      const enemyWorldPosition = this.getEnemyWorldPosition(enemy);
      if (enemyWorldPosition) {
        const distance = this.calculateDistance2D(
          towerWorldPosition,
          enemyWorldPosition,
        );

        if (distance <= tower.range && distance < closestDistance) {
          closestDistance = distance;
          closestEnemyId = enemyId;
        }
      }
    });

    if (closestEnemyId) {
      const enemy = this.enemies.get(closestEnemyId);
      if (enemy) {
        this.createAttackLineFromTower(enemy, tower);
        this.addPoints(1);
        this.destroyEnemy(closestEnemyId);
        tower.lastShotTime = now;
      }
    }
  }

  private getEnemyWorldPosition(enemy: Enemy): Position2D | null {
    if (!enemy.entity || !enemy.entity.object3D) {
      return null;
    }

    const worldPosition = enemy.entity.object3D.getWorldPosition(
      new (window as any).THREE.Vector3(),
    );

    // Return only X,Y since everything is on the same Z-plane
    return {
      x: worldPosition.x,
      y: worldPosition.y,
    };
  }

  private calculateDistance2D(pos1: Position2D, pos2: Position2D): number {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private createAttackLineFromTower(enemy: Enemy, tower: TowerInstance) {
    const enemyPos = enemy.entity.getAttribute("position");

    const towerPos = this.getTowerPositionForTower(tower);

    if (!towerPos || !this.isTowerReadyToAttack(tower)) {
      return;
    }

    const lineEntity = document.createElement("a-entity");

    const distance = Math.sqrt(
      (enemyPos.x - towerPos.x) ** 2 + (enemyPos.y - towerPos.y) ** 2,
    );
    const angle = Math.atan2(enemyPos.y - towerPos.y, enemyPos.x - towerPos.x);

    const midpoint = {
      x: (towerPos.x + enemyPos.x) / 2,
      y: (towerPos.y + enemyPos.y) / 2,
      z: this.GAME_Z_PLANE + 0.01,
    };

    lineEntity.setAttribute(
      "geometry",
      `primitive: cylinder; radius: 0.005; height: ${distance}`,
    );
    lineEntity.setAttribute("material", "color: #F8349B; opacity: 0.5");

    lineEntity.setAttribute(
      "position",
      `${midpoint.x} ${midpoint.y} ${midpoint.z}`,
    );
    lineEntity.setAttribute("rotation", `0 0 ${(angle * 180) / Math.PI - 90}`);

    this.baseTarget.appendChild(lineEntity);

    setTimeout(() => {
      if (lineEntity.parentNode) {
        lineEntity.parentNode.removeChild(lineEntity);
      }
    }, 100);
  }

  private setupTowerVisualsForTower(tower: TowerInstance) {
    if (!tower.target) return;

    // Store references to existing tower elements immediately
    tower.sphere =
      tower.target.querySelector("a-sphere") ||
      tower.target.querySelector("a-box") ||
      tower.target.querySelector("a-cone") ||
      tower.target.querySelector("a-tetrahedron");
    tower.circle = tower.target.querySelector("a-circle");

    // Ensure range circle reflects current upgrades immediately.
    if (tower.circle) {
      const rangeFactor = this.towerRange / this.TOWER_BASE_RANGE;
      const radius = this.TOWER_BASE_RADIUS * rangeFactor;
      tower.circle.setAttribute("radius", radius.toString());
      tower.circle.setAttribute("opacity", "0.2");
      tower.circle.setAttribute("visible", "true");
      if (tower.isMoving) {
        tower.circle.setAttribute("color", "#000000");
      }
    }

    // Deactivate tower visuals to show BUILDING... and hide body
    this.setTowerActiveForTower(tower, false);
  }

  private handleTowerLostForTower(tower: TowerInstance) {
    if (tower.movingText && tower.target) {
      try {
        tower.target.removeChild(tower.movingText);
      } catch {
        // ignore
      }
    }

    if (tower.buildRing && tower.target) {
      try {
        tower.target.removeChild(tower.buildRing);
      } catch {
        // ignore
      }
    }

    tower.isMoving = true;
    this.resetTowerStateForTower(tower);
  }

  private resetTowerStateForTower(tower: TowerInstance) {
    tower.sphere = null;
    tower.circle = null;
    tower.movingText = null;
    tower.buildRing = null;
    tower.homePosition = null;
    tower.lastPosition = null;
    tower.lastMovementTime = Date.now(); // Set current time for stability checking
  }

  private checkTowerMovementForTower(tower: TowerInstance) {
    const currentPosition = this.getTowerPositionForTower(tower);
    if (!currentPosition) {
      return;
    }

    const currentTime = Date.now();

    if (!tower.homePosition) {
      // Establish initial home position.
      // We keep tower.isMoving=true from targetFound, so the next frame will run the moving/stability logic.
      if (!tower.sphere || !tower.circle) {
        return;
      }
      tower.homePosition = { ...currentPosition };
      tower.lastMovementTime = currentTime;
      return;
    }

    // Check for movement from home position (triggers moving state)
    const distanceFromHome = this.calculateDistance2D(
      tower.homePosition,
      currentPosition,
    );

    // Check for recent movement (frame to frame)
    let recentMovement = 0;
    if (tower.lastPosition) {
      recentMovement = this.calculateDistance2D(
        tower.lastPosition,
        currentPosition,
      );
    }

    if (distanceFromHome > this.MOVEMENT_THRESHOLD && !tower.isMoving) {
      tower.isMoving = true;
      this.setTowerActiveForTower(tower, false);
      // Override circle to black while moving
      if (tower.circle) {
        tower.circle.setAttribute("color", "#000000");
      }
      tower.lastMovementTime = 0;
    }

    if (tower.isMoving) {
      // Keep circle black and update radius while moving
      if (!tower.circle) {
        tower.circle = tower.target.querySelector("a-circle");
      }
      if (tower.circle) {
        tower.circle.setAttribute("color", "#000000");
        // Update radius based on current range
        const rangeFactor = this.towerRange / this.TOWER_BASE_RANGE;
        const radius = this.TOWER_BASE_RADIUS * rangeFactor;
        tower.circle.setAttribute("radius", radius.toString());
      }

      if (recentMovement <= 0.1) {
        if (tower.lastMovementTime === 0) {
          tower.lastMovementTime = currentTime;
        }

        const timeSinceStabilizationStarted =
          currentTime - tower.lastMovementTime;
        const timeRemaining =
          this.towerStabilityTimeMs - timeSinceStabilizationStarted;

        if (timeSinceStabilizationStarted >= this.towerStabilityTimeMs) {
          tower.homePosition = { ...currentPosition };
          tower.isMoving = false;
          if (tower.circle) {
            tower.circle.setAttribute("color", "#6600FF");
          }
          this.setTowerActiveForTower(tower, true);
          tower.lastMovementTime = 0;
        } else {
          const pct = Math.ceil(
            100 - (timeRemaining / this.towerStabilityTimeMs) * 100,
          );
          this.updateMovingText(pct);
        }
      } else {
        if (tower.lastMovementTime > 0) {
          tower.lastMovementTime = 0;
        }
      }
    }

    tower.lastPosition = { ...currentPosition };
  }

  private updateMovingText(percentComplete: number) {
    this.towers.forEach((tower) => {
      if (!tower.buildRing) return;

      const clamped = Number.isFinite(percentComplete)
        ? Math.max(0, Math.min(100, percentComplete))
        : 0;
      const thetaLength = (clamped / 100) * 360;
      tower.buildRing.setAttribute("theta-length", thetaLength);
    });
  }

  private setTowerActiveForTower(tower: TowerInstance, active: boolean) {
    if (!tower.target) return;

    // Re-fetch the tower body element to ensure we have a fresh reference
    if (!tower.sphere) {
      tower.sphere =
        tower.target.querySelector("a-sphere") ||
        tower.target.querySelector("a-box") ||
        tower.target.querySelector("a-cone") ||
        tower.target.querySelector("a-tetrahedron");
    }

    if (active) {
      // Activate tower
      if (tower.sphere) {
        tower.sphere.setAttribute("visible", "true");
        tower.sphere.setAttribute("opacity", "1");
      }
      // Only update circle color if not moving (keep black while moving)
      if (tower.circle && !tower.isMoving) {
        tower.circle.setAttribute("color", "#6600FF");
      }
      if (tower.movingText) {
        tower.target.removeChild(tower.movingText);
        tower.movingText = null;
      }

      if (tower.buildRing) {
        try {
          tower.target.removeChild(tower.buildRing);
        } catch {}
        tower.buildRing = null;
      }
    } else {
      // Deactivate tower
      if (tower.sphere) {
        tower.sphere.setAttribute("visible", "false");
        tower.sphere.setAttribute("opacity", "0");
      }
      // Only update circle color if not moving (keep black while moving)
      if (tower.circle && !tower.isMoving) {
        tower.circle.setAttribute("color", "#330066");
      }

      // Show a closing progress ring instead of BUILDING... text
      if (!tower.buildRing) {
        tower.buildRing = document.createElement("a-ring");
        tower.buildRing.setAttribute("position", "0 0 0.16");
        tower.buildRing.setAttribute("radius-inner", "0.14");
        tower.buildRing.setAttribute("radius-outer", "0.20");
        tower.buildRing.setAttribute("theta-start", "90");
        tower.buildRing.setAttribute("theta-length", "0");
        tower.buildRing.setAttribute(
          "material",
          "color: #6600FF; opacity: 0.8; transparent: true; side: double",
        );
        tower.target.appendChild(tower.buildRing);
      }
    }
  }

  private getTowerPositionForTower(tower: TowerInstance): Position2D | null {
    if (
      !this.baseTarget ||
      !tower.target ||
      !this.baseTarget.object3D ||
      !tower.target.object3D
    ) {
      return null;
    }
    // Get the tower's world position
    const towerWorldPos = tower.target.object3D.getWorldPosition(
      new (window as any).THREE.Vector3(),
    );

    // Convert tower world position to base target's local coordinates
    const towerPos = this.baseTarget.object3D.worldToLocal(
      towerWorldPos.clone(),
    );

    const relativePos = {
      x: towerPos.x,
      y: towerPos.y,
    };

    return relativePos;
  }

  private takeDamage(damage: number) {
    if (this.gameOver) return;

    this.health -= damage;
    this.health = Math.max(0, this.health);
    this.updateHealthDisplay();

    // Flash the base when taking damage
    if (this.baseTarget) {
      const baseShape = this.baseTarget.querySelector("a-icosahedron");
      if (baseShape) {
        baseShape.setAttribute("color", "#F8349B");
        setTimeout(() => {
          baseShape.setAttribute("color", "white");
        }, 100);
      }
      if (this.health <= 0) {
        baseShape?.setAttribute("color", "white");
        this.endGame();
      }
    }
  }

  private addPoints(points: number) {
    if (this.gameOver) return;

    const added = Math.round(points * this.pointMultiplier);
    this.points += added;
    this.savePoints();
    this.updatePointsDisplay();
  }

  private updateHealthDisplay() {
    if (this.healthElement) {
      this.healthElement.textContent = this.health.toString();

      if (this.health <= 30) {
        this.healthElement.classList.add("low");
      } else {
        this.healthElement.classList.remove("low");
      }
    }
  }

  private updatePointsDisplay() {
    if (this.pointsElement) {
      this.pointsElement.textContent = this.points.toString();
    }
    // Also update upgrade screen points in real-time
    if (this.upgradePointsElement) {
      this.upgradePointsElement.textContent = this.points.toString();
    }
  }

  private updateWaveDisplay() {
    if (this.waveElement) {
      this.waveElement.textContent = this.currentWave.toString();
    }
  }

  private showWaveStartIndicator() {
    if (!this.waveStartIndicator) return;
    if (this.currentWave <= 0) return;

    if (this.waveStartIndicatorTimeout !== null) {
      window.clearTimeout(this.waveStartIndicatorTimeout);
      this.waveStartIndicatorTimeout = null;
    }

    this.waveStartIndicator.textContent = `Wave ${this.currentWave}`;
    this.waveStartIndicator.style.display = "block";

    // Trigger transition
    requestAnimationFrame(() => {
      this.waveStartIndicator?.classList.add("show");
    });

    this.waveStartIndicatorTimeout = window.setTimeout(() => {
      if (!this.waveStartIndicator) return;
      this.waveStartIndicator.classList.remove("show");

      // Allow fade-out to complete before hiding
      window.setTimeout(() => {
        if (!this.waveStartIndicator) return;
        if (!this.waveStartIndicator.classList.contains("show")) {
          this.waveStartIndicator.style.display = "none";
        }
      }, 180);
    }, 1200);
  }

  private checkWinCondition() {
    if (this.gameWon) return;

    const onFinalWave =
      this.currentWave === this.totalWaves && this.currentWave > 0;
    if (!onFinalWave) return;

    const finalWaveConfig = this.waveConfig[this.totalWaves - 1];
    const finishedSpawningFinalWave =
      this.enemiesSpawnedInWave >= finalWaveConfig.count &&
      this.spawnInterval === null &&
      !this.waveActive &&
      !this.wavePaused;

    if (finishedSpawningFinalWave && this.enemies.size === 0) {
      this.handleWin();
    }
  }

  private handleWin() {
    this.gameWon = true;
    this.gameOver = true;
    this.waveActive = false;
    this.wavePaused = false;

    // Stop any lingering spawning without wiping progression values
    this.stopEnemySpawning(false);

    if (this.upgradeScreen) {
      this.upgradeScreen.style.display = "none";
    }
    if (this.blurElement) {
      this.blurElement.style.display = "none";
    }

    const attempts = this.shopVisits + 1;
    if (this.winAttemptsElement) {
      this.winAttemptsElement.textContent = `Attempts to win: ${attempts}`;
    }

    if (this.winPopup) {
      this.winPopup.style.display = "flex";
    }
    if (this.winBlur) {
      this.winBlur.style.display = "block";
    }
  }

  private endGame() {
    this.gameOver = true;

    // Record a shop visit (defeat) for attempt tracking
    this.recordShopVisit();

    // Stop enemy spawning
    this.stopEnemySpawning();

    // Show upgrade screen
    if (this.upgradeScreen && this.upgradePointsElement && this.blurElement) {
      this.upgradePointsElement.textContent = this.points.toString();
      this.upgradeScreen.style.display = "block";
      this.blurElement.style.display = "block";
      this.renderUpgradeUI();
    }

    // Remove any tower moving texts
    this.towers.forEach((tower) => {
      if (tower.movingText) {
        try {
          tower.target.removeChild(tower.movingText);
        } catch {}
        tower.movingText = null;
      }
    });
  }

  public restartGame() {
    // Stop any ongoing spawning and reset progression
    this.stopEnemySpawning(true);

    // Reset health (keep points/energy across restarts so upgrades persist)
    this.health = this.defaultBaseHealth;
    this.gameOver = false;
    this.gameWon = false;

    // Clear all enemies
    this.enemies.forEach((_, enemyId) => {
      this.destroyEnemy(enemyId);
    });

    // Reset enemy counter and wave system
    this.enemyIdCounter = 0;
    this.currentWave = 0;
    this.waveActive = false;
    this.wavePaused = false;
    this.enemiesSpawnedInWave = 0;
    this.spawnCount = 0;
    this.pausedWaveConfig = null;
    this.pausedWaveCompleted = false;

    // Update UI
    this.updateHealthDisplay();
    this.updatePointsDisplay();
    this.updateWaveDisplay();

    // Hide upgrade screen
    if (this.upgradeScreen) {
      this.upgradeScreen.style.display = "none";
    }
    if (this.blurElement) {
      this.blurElement.style.display = "none";
    }

    this.hideWinPopup();

    // Reset towers state and reinitialize based on upgrades
    this.reinitializeTowersAfterUpgrades();

    // If a tower marker stayed tracked while the upgrade screen was open, MindAR won't re-fire targetFound.
    // Force tracked towers back into BUILDING state so restart feels consistent.
    this.forceTrackedTowersIntoBuildingState();

    // If the base is currently tracked, start spawning immediately so user doesn't need to recapture
    if (this.baseTarget?.object3D?.visible) {
      this.startEnemySpawning();
    }
  }

  private resetAllProgress() {
    try {
      window.localStorage.removeItem(this.UPGRADE_STORAGE_KEY);
      window.localStorage.removeItem(this.POINTS_STORAGE_KEY);
      window.localStorage.removeItem(this.SHOP_VISITS_STORAGE_KEY);
    } catch {}

    // Reload to ensure a clean state with cleared storage
    window.location.reload();
  }

  private hideWinPopup() {
    if (this.winPopup) {
      this.winPopup.style.display = "none";
    }
    if (this.winBlur) {
      this.winBlur.style.display = "none";
    }
  }

  // --- Upgrades: state + UI ---
  private loadUpgradeState() {
    try {
      const raw = window.localStorage.getItem(this.UPGRADE_STORAGE_KEY);
      if (raw) {
        this.upgradeState = JSON.parse(raw);

        // Migrate: ensure newly-added upgrades exist in state
        let changed = false;
        this.upgradeDefs.forEach((def) => {
          if (this.upgradeState[def.id] === undefined) {
            this.upgradeState[def.id] = 0;
            changed = true;
          }
        });
        if (changed) {
          this.saveUpgradeState();
        }
      } else {
        this.upgradeState = this.upgradeDefs.reduce<UpgradeState>(
          (acc, def) => {
            acc[def.id] = 0;
            return acc;
          },
          {} as UpgradeState,
        );
        this.saveUpgradeState();
      }
    } catch {
      this.upgradeState = {};
      this.upgradeDefs.forEach((d) => (this.upgradeState[d.id] = 0));
    }
  }

  private saveUpgradeState() {
    try {
      window.localStorage.setItem(
        this.UPGRADE_STORAGE_KEY,
        JSON.stringify(this.upgradeState),
      );
    } catch {}
  }

  private loadPoints() {
    try {
      const raw = window.localStorage.getItem(this.POINTS_STORAGE_KEY);
      if (raw) {
        this.points = parseInt(raw, 10);
        this.updatePointsDisplay();
      }
    } catch {
      this.points = 0;
    }
  }

  private loadShopVisits() {
    try {
      const raw = window.localStorage.getItem(this.SHOP_VISITS_STORAGE_KEY);
      if (raw) {
        this.shopVisits = parseInt(raw, 10) || 0;
      }
    } catch {
      this.shopVisits = 0;
    }
  }

  private saveShopVisits() {
    try {
      window.localStorage.setItem(
        this.SHOP_VISITS_STORAGE_KEY,
        this.shopVisits.toString(),
      );
    } catch {}
  }

  private savePoints() {
    try {
      window.localStorage.setItem(
        this.POINTS_STORAGE_KEY,
        this.points.toString(),
      );
    } catch {}
  }

  private recordShopVisit() {
    this.shopVisits += 1;
    this.saveShopVisits();
  }

  private getUpgradeCurrentValueById(id: UpgradeId): number {
    const def = this.upgradeDefs.find((d) => d.id === id);
    if (!def) return 0;
    return this.getUpgradeCurrentValue(def);
  }

  private applyUpgradeEffects() {
    // Pull current values from upgrade state
    const rangeFactor = this.getUpgradeCurrentValueById("range");
    this.towerRange = this.TOWER_BASE_RANGE * rangeFactor;
    this.towerFireRateMs = this.getUpgradeCurrentValueById("fire-rate");
    this.defaultBaseHealth = this.getUpgradeCurrentValueById("base-health");

    const rebuildMs = this.getUpgradeCurrentValueById("rebuild-speed");
    this.towerStabilityTimeMs = Math.max(
      200,
      Math.round(rebuildMs || this.STABILITY_BASE_TIME),
    );

    // Sync existing towers to latest stats
    this.towers.forEach((tower) => {
      tower.range = this.towerRange;
      tower.fireRateMs = this.towerFireRateMs;
      // Update visual range circle scaling
      const radius = this.TOWER_BASE_RADIUS * rangeFactor;
      if (tower.circle) {
        tower.circle.setAttribute("radius", radius);
      }
    });

    // Keep health at max when max health increases
    this.health = this.defaultBaseHealth;
    this.updateHealthDisplay();
  }

  private getUpgradeCurrentValue(def: UpgradeDefinition<number>): number {
    const lvl = this.upgradeState[def.id] ?? 0;
    return def.levels[Math.min(lvl, def.levels.length - 1)].value;
  }

  private getUpgradeNextValue(def: UpgradeDefinition<number>): number {
    const nextLvl = (this.upgradeState[def.id] ?? 0) + 1;
    const clamped = Math.min(nextLvl, def.levels.length - 1);
    return def.levels[clamped].value;
  }

  private getUpgradeNextCost(def: UpgradeDefinition<number>): number {
    const nextLvl = (this.upgradeState[def.id] ?? 0) + 1;
    if (nextLvl >= def.levels.length) return 0; // max level
    return def.levels[nextLvl].cost;
  }

  private renderUpgradeUI() {
    if (!this.upgradeListElement) return;
    const list = this.upgradeListElement as HTMLElement;
    list.innerHTML = "";

    this.upgradeDefs.forEach((def) => {
      const currentVal = this.getUpgradeCurrentValue(def);
      const nextVal = this.getUpgradeNextValue(def);
      const nextCost = this.getUpgradeNextCost(def);

      const currentLevel = this.upgradeState[def.id] ?? 0;
      const maxLevelReached = currentLevel >= def.levels.length - 1;
      const totalLevels = def.levels.length;
      const nextDisplay = maxLevelReached ? "Max" : def.format(nextVal);
      const costDisplay = maxLevelReached
        ? "Max"
        : `<span class=\"material-symbols-rounded icon-bolt-small\">bolt</span><span class=\"cost-value\">${nextCost}</span>`;

      // Build progress bar with segments
      let progressBarHTML = '<div class=\"upgrade-progress\">';
      for (let i = 1; i < totalLevels; i++) {
        const filled = i <= currentLevel ? "filled" : "";
        progressBarHTML += `<div class=\"progress-segment ${filled}\"></div>`;
      }
      progressBarHTML += "</div>";

      const item = document.createElement("div");
      item.className = maxLevelReached ? "upgrade-item maxed" : "upgrade-item";
      item.innerHTML = `
        <div class=\"upgrade-header\">
          <span class=\"upgrade-name\">${def.name}</span>
          <span class=\"upgrade-cost\">${costDisplay}</span>
        </div>
        <p class=\"upgrade-desc\">${def.desc}</p>
        <p class=\"upgrade-level\"><span class=\"level-current\">${def.format(currentVal)}</span> <span class=\"material-symbols-rounded icon-to\">arrow_right</span> <span class=\"level-next\">${nextDisplay}</span></p>
        ${progressBarHTML}
        <button class=\"upgrade-btn\" data-upgrade=\"${def.id}\">Upgrade</button>
      `;

      const btn = item.querySelector(".upgrade-btn") as HTMLElement | null;
      if (btn) {
        // Determine button state/text
        let btnText = "Upgrade";
        let disabled = false;
        if (maxLevelReached) {
          btnText = "Max";
          disabled = true;
        } else if (this.points < nextCost) {
          btnText = "Not enough points";
          disabled = true;
        }
        btn.textContent = btnText;
        if (disabled) btn.setAttribute("disabled", "true");
        else btn.removeAttribute("disabled");

        // Purchase handler - deduct points, increment level, persist, re-render
        btn.addEventListener("click", () => {
          if (!disabled) {
            this.purchaseUpgrade(def.id, nextCost);
          }
        });
      }

      list.appendChild(item);
    });
  }

  private purchaseUpgrade(upgradeId: UpgradeId, cost: number) {
    // Check if player has enough points
    if (this.points < cost) {
      console.warn(`Not enough energy for ${upgradeId}`);
      return;
    }

    // Deduct points and persist
    this.points -= cost;
    this.savePoints();
    this.updatePointsDisplay();

    // Increment upgrade level
    this.upgradeState[upgradeId] = (this.upgradeState[upgradeId] ?? 0) + 1;
    this.saveUpgradeState();

    // Apply new upgrade effects to stats/towers
    this.applyUpgradeEffects();

    // Re-render UI to show updated state
    this.renderUpgradeUI();

    // If tower-count was purchased, immediately reinitialize towers so new ones appear
    if (upgradeId === "tower-count") {
      this.reinitializeTowersAfterUpgrades();
    }
  }

  public cleanup() {
    if (this.spawnInterval) {
      clearInterval(this.spawnInterval);
    }
    if (this.gameLoop) {
      cancelAnimationFrame(this.gameLoop);
    }
    this.enemies.forEach((_, enemyId) => {
      this.destroyEnemy(enemyId);
    });
  }
}

const game = new TowerDefenseGame();

window.addEventListener("beforeunload", () => {
  game.cleanup();
});
