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
  homePosition: Position2D | null;
  lastPosition: Position2D | null;
  isMoving: boolean;
  lastMovementTime: number;
  lastShotTime: number;
  fireRateMs: number;
  range: number;
}

type UpgradeId = "tower-count" | "range" | "base-health" | "fire-rate";

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

  // UI elements
  private healthElement: HTMLElement | null = null;
  private pointsElement: HTMLElement | null = null;
  private waveElement: HTMLElement | null = null;
  private upgradeScreen: HTMLElement | null = null;
  private blurElement: HTMLElement | null = null;
  private upgradePointsElement: HTMLElement | null = null;
  private restartButton: HTMLElement | null = null;
  private upgradeListElement: HTMLElement | null = null;

  // Tower state tracking (per-tower handled via towers[])
  private readonly MOVEMENT_THRESHOLD = 0.3;
  private readonly STABILITY_TIME = 2000;
  // Upgradeable tower properties
  private towerFireRateMs: number = 3000;
  private towerRange: number = 1000;
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
    { count: 5, baseSpeed: 0.3, spreadAngle: 10, duration: 5000 },
    { count: 7, baseSpeed: 0.4, spreadAngle: 30, duration: 8000 },
    { count: 10, baseSpeed: 0.5, spreadAngle: 60, duration: 8000 },
    { count: 15, baseSpeed: 0.65, spreadAngle: 90, duration: 8000 },
    { count: 20, baseSpeed: 0.8, spreadAngle: 120, duration: 8000 },
    { count: 25, baseSpeed: 1, spreadAngle: 180, duration: 9000 },
    { count: 40, baseSpeed: 1.2, spreadAngle: 240, duration: 10000 },
    { count: 50, baseSpeed: 1.5, spreadAngle: 300, duration: 10000 },
    { count: 70, baseSpeed: 2, spreadAngle: 330, duration: 12000 },
    { count: 100, baseSpeed: 3, spreadAngle: 360, duration: 15000 },
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
        { value: 2, cost: 1 }, //20
        { value: 3, cost: 1 }, //50
      ],
      format: (v) => `${v}`,
    },
    {
      id: "range",
      name: "Tower Range",
      desc: "Increase tower attack range",
      levels: [
        { value: 1.0, cost: 0 },
        { value: 1.2, cost: 8 },
        { value: 1.5, cost: 12 },
        { value: 2, cost: 20 },
      ],
      format: (v) => `${v.toFixed(1)}`,
    },
    {
      id: "fire-rate",
      name: "Tower Fire Rate",
      desc: "Reduce shooting cooldown",
      levels: [
        { value: 1000, cost: 0 },
        { value: 900, cost: 5 },
        { value: 800, cost: 10 },
        { value: 700, cost: 15 },
        { value: 500, cost: 25 },
        { value: 300, cost: 40 },
      ],
      format: (v) => `${Math.round(v)}ms`,
    },
    {
      id: "base-health",
      name: "Base Health",
      desc: "Increase base max health",
      levels: [
        { value: 100, cost: 0 },
        { value: 120, cost: 10 },
        { value: 150, cost: 12 },
        { value: 200, cost: 15 },
        { value: 300, cost: 20 },
      ],
      format: (v) => `${v}`,
    },
  ];
  private upgradeState: UpgradeState = {};

  constructor() {
    this.init();
  }

  private init() {
    document.addEventListener("DOMContentLoaded", () => {
      this.scene = document.querySelector("a-scene");

      // Initialize UI elements
      this.healthElement = document.getElementById("health-value");
      this.pointsElement = document.getElementById("points-value");
      this.waveElement = document.getElementById("wave-value");
      this.upgradeScreen = document.getElementById("upgrade-screen");
      this.blurElement = document.getElementById("blur");
      this.upgradePointsElement = document.getElementById("upgrade-points");
      this.upgradeListElement = document.getElementById("upgrade-list");
      const continueButton = document.getElementById("continue-btn");
      this.restartButton = document.getElementById("restart-btn");
      const resetUpgradesButton = document.getElementById("reset-upgrades-btn");

      // Add continue button listener
      if (continueButton) {
        continueButton.addEventListener("click", () => {
          this.continueGame();
        });
      }

      // Add restart button listener
      if (this.restartButton) {
        this.restartButton.addEventListener("click", () => {
          this.restartGame();
        });
      }

      // Add reset upgrades button listener (DEBUG)
      if (resetUpgradesButton) {
        resetUpgradesButton.addEventListener("click", () => {
          localStorage.removeItem("td_upgrades");
          localStorage.removeItem("td_points");
          this.upgradeState = {};
          this.points = 0;
          this.initializeTowersFromUpgrades();
          this.renderUpgradeUI();
          this.updatePointsDisplay();
          console.log("Upgrades and points reset!");
        });
      }

      // Load persisted upgrade state
      this.loadUpgradeState();
      this.loadPoints();

      if (this.scene.hasLoaded) {
        this.setupGame();
      } else {
        this.scene.addEventListener("loaded", () => {
          this.setupGame();
        });
      }
    });
  }

  private setupGame() {
    this.baseTarget = document.querySelector(
      '[mindar-image-target="targetIndex: 0"]'
    );
    this.towerTarget = document.querySelector(
      '[mindar-image-target="targetIndex: 1"]'
    );

    if (!this.baseTarget || !this.towerTarget) {
      console.error("Could not find base or tower targets");
      return;
    }

    // Initialize towers based on upgrade level
    this.initializeTowersFromUpgrades();

    console.log("Tower Defense Game initialized");

    this.baseTarget.addEventListener("targetFound", () => {
      this.startEnemySpawning();
    });

    this.baseTarget.addEventListener("targetLost", () => {
      // pause spawning due to base lost, but do not reset progression
      this.stopEnemySpawning(false);
    });

    // Register events for each tower instance
    this.registerTowerEventListeners();

    this.startGameLoop();
  }

  private registerTowerEventListeners() {
    this.towers.forEach((tower) => {
      tower.target.addEventListener("targetFound", () => {
        this.setupTowerVisualsForTower(tower);
        if (tower.isMoving) {
          this.setTowerActiveForTower(tower, false);
        }
        tower.homePosition = null;
      });
      tower.target.addEventListener("targetLost", () => {
        this.handleTowerLostForTower(tower);
      });
    });
  }

  private startEnemySpawning() {
    if (this.wavePaused && this.currentWave > 0) {
      // Resume a paused wave
      this.wavePaused = false;
      this.waveActive = true;
      this.resumeWave();
    } else if (this.currentWave === 0) {
      // Start a new game
      this.currentWave = 1;
      this.startWave();
    }
  }

  private initializeTowersFromUpgrades() {
    const towerCountLevel = this.upgradeState["tower-count"] ?? 0;
    const maxTowers = 1 + towerCountLevel; // Level 0 = 1 tower, Level 1 = 2 towers, Level 2 = 3 towers, etc.

    // Collect all tower targets by class (regardless of mindar-image-target state)
    const allTowerElements = Array.from(
      document.querySelectorAll("a-entity.tower")
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

    this.towers = activeTowers.map((targetEl) => ({
      target: targetEl,
      sphere: null,
      circle: null,
      movingText: null,
      homePosition: null,
      lastPosition: null,
      isMoving: false,
      lastMovementTime: 0,
      lastShotTime: 0,
      fireRateMs: this.towerFireRateMs,
      range: this.towerRange,
    }));

    console.log(
      `Initialized ${this.towers.length} tower(s) from upgrade level ${towerCountLevel}`
    );
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
    });

    // Re-initialize towers based on new upgrade level
    this.initializeTowersFromUpgrades();

    // Re-register events for new towers
    this.towers.forEach((tower) => {
      tower.target.addEventListener("targetFound", () => {
        this.setupTowerVisualsForTower(tower);
        if (tower.isMoving) {
          this.setTowerActiveForTower(tower, false);
        }
        tower.homePosition = null;
      });
      tower.target.addEventListener("targetLost", () => {
        this.handleTowerLostForTower(tower);
      });
    });
  }

  private resumeWave() {
    if (!this.pausedWaveConfig || this.currentWave === 0) return;

    const waveConfig = this.pausedWaveConfig;
    const spawnInterval = Math.max(
      this.MIN_SPAWN_TIME,
      Math.round(waveConfig.duration / waveConfig.count)
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
        console.log(
          `Wave ${this.currentWave} complete (${waveConfig.count} enemies spawned). Break for ${this.waveBreakDuration}ms...`
        );

        if (this.currentWave < this.totalWaves) {
          setTimeout(() => {
            this.currentWave++;
            this.startWave();
          }, this.waveBreakDuration);
        } else {
          console.log("All waves completed!");
        }
      }
    }, spawnInterval);

    console.log(
      `Wave ${this.currentWave} resumed (${this.enemiesSpawnedInWave}/${waveConfig.count} spawned)`
    );
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
    this.pausedWaveConfig = waveConfig; // Save for potential pause/resume
    this.spawnCenterAngle = Math.random() * Math.PI * 2; // pick a new direction for this wave

    console.log(
      `Wave ${this.currentWave} started: ${waveConfig.count} enemies`
    );

    if (this.spawnInterval) {
      clearInterval(this.spawnInterval);
    }

    // Calculate spawn interval for this wave - spread spawns evenly across wave duration
    const spawnIntervalMs = Math.max(
      this.MIN_SPAWN_TIME,
      Math.round(waveConfig.duration / waveConfig.count)
    );

    // Delay wave display update to let first enemies appear in frame
    setTimeout(() => {
      this.updateWaveDisplay();
    }, 2000 / waveConfig.baseSpeed);

    let waveCompleted = false;

    this.spawnInterval = window.setInterval(() => {
      // If wave was paused, stop the interval and let resumeWave take over
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
        // Wave complete, mark it and start break before next wave
        waveCompleted = true;
        clearInterval(this.spawnInterval!);
        this.spawnInterval = null;
        this.waveActive = false;
        this.pausedWaveConfig = null;
        console.log(
          `Wave ${this.currentWave} complete (${waveConfig.count} enemies spawned). Break for ${this.waveBreakDuration}ms...`
        );

        if (this.currentWave < this.totalWaves) {
          setTimeout(() => {
            this.currentWave++;
            this.startWave();
          }, this.waveBreakDuration);
        } else {
          console.log("All waves completed!");
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
      // reset progression so next game/session starts fresh
      this.spawnCount = 0;
      this.currentWave = 0;
      this.waveActive = false;
      this.wavePaused = false;
      this.enemiesSpawnedInWave = 0;
      this.pausedWaveConfig = null;
      console.log("Enemy spawning stopped and reset");
    } else {
      // pause the current wave without resetting progress
      this.waveActive = false;
      this.wavePaused = true;
      console.log(
        `Wave ${this.currentWave} paused (${this.enemiesSpawnedInWave} enemies spawned so far)`
      );
    }
  }

  private spawnEnemy() {
    if (this.gameOver || !this.waveActive || this.wavePaused) {
      return;
    }

    if (!this.isBaseVisible()) {
      console.log("Base not visible, skipping enemy spawn");
      return;
    }
    const enemyId = `enemy-${this.enemyIdCounter++}`;

    const enemyEntity = document.createElement("a-sphere");
    enemyEntity.setAttribute("id", enemyId);
    enemyEntity.setAttribute("radius", "0.05");
    enemyEntity.setAttribute("color", "#CCFF33");
    enemyEntity.setAttribute("roughness", "1");

    const waveConfig = this.waveConfig[this.currentWave - 1];
    const spreadRadians = (waveConfig.spreadAngle * Math.PI) / 180; // Convert degrees to radians
    const angle = this.computeSpawnAngle(spreadRadians);
    const spawnX = Math.cos(angle) * this.SPAWN_DISTANCE;
    const spawnY = Math.sin(angle) * this.SPAWN_DISTANCE;

    enemyEntity.setAttribute(
      "position",
      `${spawnX} ${spawnY} ${this.GAME_Z_PLANE}`
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

    console.log(
      `Spawned enemy ${enemyId} at position (${spawnX.toFixed(
        2
      )}, ${spawnY.toFixed(2)}, 0) speed=${enemySpeed.toFixed(2)} spreadAngle=${
        waveConfig.spreadAngle
      }°`
    );
  }

  private computeSpawnAngle(spread: number) {
    // early on, spawn within a narrow cone around spawnCenterAngle
    // when spread >= 2pi this becomes uniform
    if (spread >= Math.PI * 2 - 0.001) {
      return Math.random() * Math.PI * 2;
    }
    // choose angle around center with uniform distribution in [center - spread/2, center + spread/2]
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
      if (!tower.isMoving) {
        this.checkTowerAttacksForTower(tower);
      }
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
        console.log(
          `Enemy ${enemyId} reached the base! Health: ${this.health}`
        );
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
        `${newPosition.x} ${newPosition.y} ${newPosition.z}`
      );
    });
  }

  private destroyEnemy(enemyId: string) {
    const enemy = this.enemies.get(enemyId);
    if (enemy) {
      if (enemy.entity.parentNode) {
        enemy.entity.parentNode.removeChild(enemy.entity);
      }
      this.enemies.delete(enemyId);
    }
  }

  private isTowerVisible(tower: TowerInstance): boolean {
    return (
      tower.target && tower.target.object3D && tower.target.object3D.visible
    );
  }

  private getMarkerWorldPosition(marker: any): Position2D | null {
    if (!marker || !marker.object3D) {
      return null;
    }

    const worldPosition = marker.object3D.getWorldPosition(
      new (window as any).THREE.Vector3()
    );

    return {
      x: worldPosition.x,
      y: worldPosition.y,
    };
  }

  private checkTowerAttacksForTower(tower: TowerInstance) {
    if (!this.isTowerVisible(tower)) {
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
          enemyWorldPosition
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
      new (window as any).THREE.Vector3()
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

    if (!towerPos) {
      return;
    }

    const lineEntity = document.createElement("a-entity");

    const distance = Math.sqrt(
      (enemyPos.x - towerPos.x) ** 2 + (enemyPos.y - towerPos.y) ** 2
    );
    const angle = Math.atan2(enemyPos.y - towerPos.y, enemyPos.x - towerPos.x);

    const midpoint = {
      x: (towerPos.x + enemyPos.x) / 2,
      y: (towerPos.y + enemyPos.y) / 2,
      z: this.GAME_Z_PLANE + 0.01,
    };

    lineEntity.setAttribute(
      "geometry",
      `primitive: cylinder; radius: 0.005; height: ${distance}`
    );
    lineEntity.setAttribute("material", "color: #F8349B; opacity: 0.5");

    lineEntity.setAttribute(
      "position",
      `${midpoint.x} ${midpoint.y} ${midpoint.z}`
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

    // Store references to existing tower elements (support sphere, box, cone, or tetrahedron body)
    tower.sphere =
      tower.target.querySelector("a-sphere") ||
      tower.target.querySelector("a-box") ||
      tower.target.querySelector("a-cone") ||
      tower.target.querySelector("a-tetrahedron");
    tower.circle = tower.target.querySelector("a-circle");

    // Reset tower to active state
    this.setTowerActiveForTower(tower, true);
  }

  private handleTowerLostForTower(tower: TowerInstance) {
    // Remove any existing moving text before losing references
    if (tower.movingText && tower.target) {
      try {
        tower.target.removeChild(tower.movingText);
      } catch (e) {
        console.log("Could not remove moving text (target already lost)");
      }
    }

    // Set to moving state so it will need to re-establish stability when reconnected
    tower.isMoving = true;
    this.resetTowerStateForTower(tower);
  }

  private resetTowerStateForTower(tower: TowerInstance) {
    tower.sphere = null;
    tower.circle = null;
    tower.movingText = null;
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
      // Establish initial home position
      tower.homePosition = { ...currentPosition };
      tower.lastMovementTime = currentTime;
      return;
    }

    // Check for movement from home position (triggers moving state)
    const distanceFromHome = this.calculateDistance2D(
      tower.homePosition,
      currentPosition
    );

    // Check for recent movement (frame to frame)
    let recentMovement = 0;
    if (tower.lastPosition) {
      recentMovement = this.calculateDistance2D(
        tower.lastPosition,
        currentPosition
      );
    }

    if (distanceFromHome > this.MOVEMENT_THRESHOLD && !tower.isMoving) {
      tower.isMoving = true;
      this.setTowerActiveForTower(tower, false);
      tower.lastMovementTime = 0;
    }

    if (tower.isMoving) {
      if (recentMovement <= 0.1) {
        if (tower.lastMovementTime === 0) {
          tower.lastMovementTime = currentTime;
        }

        const timeSinceStabilizationStarted =
          currentTime - tower.lastMovementTime;
        const timeRemaining =
          this.STABILITY_TIME - timeSinceStabilizationStarted;

        if (timeSinceStabilizationStarted >= this.STABILITY_TIME) {
          tower.homePosition = { ...currentPosition };
          tower.isMoving = false;
          this.setTowerActiveForTower(tower, true);
          tower.lastMovementTime = 0;
        } else {
          this.updateMovingText(
            Math.ceil(100 - (timeRemaining / this.STABILITY_TIME) * 100) + "%"
          );
        }
      } else {
        if (tower.lastMovementTime > 0) {
          tower.lastMovementTime = 0;
        }
      }
    }

    tower.lastPosition = { ...currentPosition };
  }

  private updateMovingText(percentageRemaining: string) {
    this.towers.forEach((tower) => {
      if (tower.movingText) {
        tower.movingText.setAttribute(
          "value",
          `BUILDING... (${percentageRemaining})`
        );
      }
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
      if (tower.circle) {
        tower.circle.setAttribute("color", "#6600FF");
      }
      if (tower.movingText) {
        tower.target.removeChild(tower.movingText);
        tower.movingText = null;
      }
    } else {
      // Deactivate tower
      if (tower.sphere) {
        tower.sphere.setAttribute("visible", "false");
        tower.sphere.setAttribute("opacity", "0");
      }
      if (tower.circle) {
        tower.circle.setAttribute("color", "#330066");
      }

      if (!tower.movingText) {
        tower.movingText = document.createElement("a-text");
        tower.movingText.setAttribute("position", "0 0 0.15");
        tower.movingText.setAttribute("align", "center");
        tower.movingText.setAttribute("color", "white");
        tower.movingText.setAttribute("scale", "0.5 0.5 0.5");
        tower.target.appendChild(tower.movingText);
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
      new (window as any).THREE.Vector3()
    );

    // Convert tower world position to base target's local coordinates
    const towerPos = this.baseTarget.object3D.worldToLocal(
      towerWorldPos.clone()
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
  }

  private updateWaveDisplay() {
    if (this.waveElement) {
      this.waveElement.textContent = this.currentWave.toString();
    }
  }

  private endGame() {
    this.gameOver = true;

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

  private continueGame() {
    // Reset health to max, but keep points and upgrades
    this.health = this.defaultBaseHealth;
    this.gameOver = false;

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

    // Hide upgrade screen
    if (this.upgradeScreen) {
      this.upgradeScreen.style.display = "none";
    }
    if (this.blurElement) {
      this.blurElement.style.display = "none";
    }

    // Reset towers state and reinitialize based on upgrades
    this.reinitializeTowersAfterUpgrades();

    // If base still tracked, resume spawning immediately
    if (this.baseTarget?.object3D?.visible) {
      this.startEnemySpawning();
    }

    console.log("Game continued with upgrades preserved!");
  }

  public restartGame() {
    // Stop any ongoing spawning and reset progression
    this.stopEnemySpawning(true);

    // Reset health and points
    this.health = this.defaultBaseHealth;
    this.points = 0;
    this.savePoints();
    this.gameOver = false;

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

    // Hide upgrade screen
    if (this.upgradeScreen) {
      this.upgradeScreen.style.display = "none";
    }
    if (this.blurElement) {
      this.blurElement.style.display = "none";
    }

    // Reset towers state and reinitialize based on upgrades
    this.reinitializeTowersAfterUpgrades();

    // If the base is currently tracked, start spawning immediately so user doesn't need to recapture
    if (this.baseTarget?.object3D?.visible) {
      this.startEnemySpawning();
    }

    console.log("Game restarted!");
  }

  // --- Upgrades: state + UI ---
  private loadUpgradeState() {
    try {
      const raw = window.localStorage.getItem(this.UPGRADE_STORAGE_KEY);
      if (raw) {
        this.upgradeState = JSON.parse(raw);
      } else {
        this.upgradeState = this.upgradeDefs.reduce<UpgradeState>(
          (acc, def) => {
            acc[def.id] = 0;
            return acc;
          },
          {} as UpgradeState
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
        JSON.stringify(this.upgradeState)
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

  private savePoints() {
    try {
      window.localStorage.setItem(
        this.POINTS_STORAGE_KEY,
        this.points.toString()
      );
    } catch {}
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

      const item = document.createElement("div");
      item.className = "upgrade-item";
      item.innerHTML = `
        <div class=\"upgrade-header\">
          <span class=\"upgrade-name\">${def.name}</span>
          <span class=\"upgrade-cost\"><span class=\"material-symbols-rounded icon-bolt-small\">bolt</span><span class=\"cost-value\">${nextCost}</span></span>
        </div>
        <p class=\"upgrade-desc\">${def.desc}</p>
        <p class=\"upgrade-level\"><span class=\"level-current\">${def.format(currentVal)}</span> → <span class=\"level-next\">${def.format(nextVal)}</span></p>
        <button class=\"upgrade-btn\" data-upgrade=\"${def.id}\">Upgrade</button>
      `;

      const btn = item.querySelector(".upgrade-btn") as HTMLElement | null;
      if (btn) {
        // Determine button state/text
        let btnText = "Upgrade";
        let disabled = false;
        if (maxLevelReached) {
          btnText = "Max level reached";
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
      console.warn(`Not enough points for ${upgradeId}`);
      return;
    }

    // Deduct points and persist
    this.points -= cost;
    this.savePoints();
    this.updatePointsDisplay();

    // Increment upgrade level
    this.upgradeState[upgradeId] = (this.upgradeState[upgradeId] ?? 0) + 1;
    this.saveUpgradeState();

    // Re-render UI to show updated state
    this.renderUpgradeUI();

    // If tower-count was purchased, immediately reinitialize towers so new ones appear
    if (upgradeId === "tower-count") {
      this.reinitializeTowersAfterUpgrades();
    }

    console.log(
      `Purchased ${upgradeId} to level ${this.upgradeState[upgradeId]}`
    );
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
