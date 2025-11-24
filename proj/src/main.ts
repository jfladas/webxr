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
  private gameOverScreen: HTMLElement | null = null;
  private finalScoreElement: HTMLElement | null = null;
  private restartButton: HTMLElement | null = null;

  // Tower state tracking
  private towerSphere: any = null;
  private towerCircle: any = null;
  private towerMovingText: any = null;
  private towerHomePosition: Position2D | null = null;
  private lastTowerPosition: Position2D | null = null;
  private towerIsMoving = false;
  private lastMovementTime = 0;
  private readonly MOVEMENT_THRESHOLD = 0.3;
  private readonly STABILITY_TIME = 4000;
  private lastShotTime: number = 0;
  // Upgradeable tower properties
  private towerFireRateMs: number = 3000;
  private towerRange: number = 1000;

  // Base and scoring (upgradeable)
  private defaultBaseHealth: number = 100;
  private pointMultiplier: number = 1;

  private readonly SPAWN_DISTANCE = 5;
  private readonly SPAWN_TIME = 3000;
  private readonly MIN_SPAWN_TIME = 100; // fastest spawn interval
  private readonly SPAWN_RATE_DECREASE_TIME = 180; // seconds to reach min spawn time
  private readonly GAME_Z_PLANE = 0;

  // Progressive difficulty / spawn dispersion
  private spawnStartTime: number | null = null;
  private spawnCount = 0;
  private spawnCenterAngle = 0;
  private readonly INITIAL_SPAWN_SPREAD = Math.PI / 6;
  private readonly SPAWN_SPREAD_GROWTH_TIME = 120;
  private readonly MAX_SPAWN_SPREAD = Math.PI * 2;
  private readonly INITIAL_ENEMY_SPEED = 0.3;
  private readonly MAX_ENEMY_SPEED = 1.5;
  private readonly ENEMY_SPEED_GROWTH_TIME = 180;

  // current spawn interval tracking so we can adjust spawn rate over time
  private currentSpawnIntervalMs: number | null = null;

  constructor() {
    this.init();
  }

  private init() {
    document.addEventListener("DOMContentLoaded", () => {
      this.scene = document.querySelector("a-scene");

      // Initialize UI elements
      this.healthElement = document.getElementById("health-value");
      this.pointsElement = document.getElementById("points-value");
      this.gameOverScreen = document.getElementById("game-over-screen");
      this.finalScoreElement = document.getElementById("final-score");
      this.restartButton = document.getElementById("restart-btn");

      // Add restart button listener
      if (this.restartButton) {
        this.restartButton.addEventListener("click", () => {
          this.restartGame();
        });
      }

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

    console.log("Tower Defense Game initialized");

    this.baseTarget.addEventListener("targetFound", () => {
      this.startEnemySpawning();
    });

    this.baseTarget.addEventListener("targetLost", () => {
      // pause spawning due to base lost, but do not reset progression
      this.stopEnemySpawning(false);
    });

    this.towerTarget.addEventListener("targetFound", () => {
      this.setupTowerVisuals();

      if (this.towerIsMoving) {
        this.setTowerActive(false);
      }
      this.towerHomePosition = null;
    });

    this.towerTarget.addEventListener("targetLost", () => {
      this.handleTowerLost();
    });

    this.startGameLoop();
  }

  private startEnemySpawning() {
    if (this.spawnInterval) return;

    // initialize spawn progression only if it hasn't been started yet
    if (!this.spawnStartTime) {
      this.spawnStartTime = Date.now();
      this.spawnCount = 0;
      this.spawnCenterAngle = Math.random() * Math.PI * 2; // pick an initial incoming direction
    }

    // compute initial spawn interval based on progression
    const elapsed = this.spawnStartTime
      ? (Date.now() - this.spawnStartTime) / 1000
      : 0;
    const initialMs = Math.max(
      this.MIN_SPAWN_TIME,
      Math.round(this.computeSpawnIntervalMs(elapsed))
    );
    this.currentSpawnIntervalMs = initialMs;
    this.spawnInterval = window.setInterval(() => {
      this.spawnEnemy();
    }, initialMs);
  }

  private stopEnemySpawning(resetProgress: boolean = true) {
    if (this.spawnInterval) {
      clearInterval(this.spawnInterval);
      this.spawnInterval = null;
      // clear current interval tracking
      this.currentSpawnIntervalMs = null;

      if (resetProgress) {
        // reset progression so next game/session starts fresh
        this.spawnStartTime = null;
        this.spawnCount = 0;
      }
      console.log("Enemy spawning stopped");
    }
  }

  private spawnEnemy() {
    if (this.gameOver) {
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
    enemyEntity.setAttribute("color", "lime");
    enemyEntity.setAttribute("roughness", "1");

    // compute progressive spread and speed based on elapsed time since spawning started
    const elapsed = this.spawnStartTime
      ? (Date.now() - this.spawnStartTime) / 1000
      : 0;
    const spread = this.computeSpawnSpread(elapsed);
    const angle = this.computeSpawnAngle(spread);
    const spawnX = Math.cos(angle) * this.SPAWN_DISTANCE;
    const spawnY = Math.sin(angle) * this.SPAWN_DISTANCE;

    enemyEntity.setAttribute(
      "position",
      `${spawnX} ${spawnY} ${this.GAME_Z_PLANE}`
    );

    this.baseTarget.appendChild(enemyEntity);

    const enemySpeed = this.computeEnemySpeed(elapsed);

    const enemy: Enemy = {
      id: enemyId,
      entity: enemyEntity,
      targetPosition: { x: 0, y: 0 },
      speed: enemySpeed,
      health: 1,
    };

    this.enemies.set(enemyId, enemy);
    this.spawnCount++;

    // After spawning, update spawn interval progressively (so spawn rate increases over time)
    this.updateSpawnInterval(elapsed);

    console.log(
      `Spawned enemy ${enemyId} at position (${spawnX.toFixed(
        2
      )}, ${spawnY.toFixed(2)}, 0) speed=${enemySpeed.toFixed(
        2
      )} spread=${spread.toFixed(2)}`
    );
  }

  private computeSpawnSpread(elapsedSeconds: number) {
    // linear growth from initial spread to full circle over SPAWN_SPREAD_GROWTH_TIME
    const t = Math.min(1, elapsedSeconds / this.SPAWN_SPREAD_GROWTH_TIME);
    return (
      this.INITIAL_SPAWN_SPREAD +
      t * (this.MAX_SPAWN_SPREAD - this.INITIAL_SPAWN_SPREAD)
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

  private computeEnemySpeed(elapsedSeconds: number) {
    // linear growth from INITIAL_ENEMY_SPEED to MAX_ENEMY_SPEED over ENEMY_SPEED_GROWTH_TIME
    const t = Math.min(1, elapsedSeconds / this.ENEMY_SPEED_GROWTH_TIME);
    return (
      this.INITIAL_ENEMY_SPEED +
      t * (this.MAX_ENEMY_SPEED - this.INITIAL_ENEMY_SPEED)
    );
  }

  private computeSpawnIntervalMs(elapsedSeconds: number) {
    // linear interpolation from initial SPAWN_TIME to MIN_SPAWN_TIME over SPAWN_RATE_DECREASE_TIME
    const t = Math.min(1, elapsedSeconds / this.SPAWN_RATE_DECREASE_TIME);
    const initial = this.SPAWN_TIME;
    const min = this.MIN_SPAWN_TIME;
    return initial - t * (initial - min);
  }

  private updateSpawnInterval(elapsedSeconds: number) {
    if (!this.spawnInterval) return;
    const newInterval = Math.max(
      this.MIN_SPAWN_TIME,
      Math.round(this.computeSpawnIntervalMs(elapsedSeconds))
    );
    if (
      this.currentSpawnIntervalMs === null ||
      newInterval !== this.currentSpawnIntervalMs
    ) {
      // restart the interval with the new timing
      clearInterval(this.spawnInterval);
      this.spawnInterval = window.setInterval(() => {
        this.spawnEnemy();
      }, newInterval);
      this.currentSpawnIntervalMs = newInterval;
      // small debug log
      console.log(`Adjusted spawn interval to ${newInterval}ms`);
    }
  }

  private updateTowerCooldownIndicator() {
    if (!this.towerSphere) return;
    const now = Date.now();
    const elapsed = now - this.lastShotTime;
    if (elapsed < this.towerFireRateMs) {
      const t = Math.max(0, Math.min(1, elapsed / this.towerFireRateMs));
      const gray = "#aaaaaa";
      const red = "#ff0000";
      const color = this.lerpColorHex(gray, red, t);
      this.towerSphere.setAttribute("color", color);
    } else {
      this.towerSphere.setAttribute("color", "#ff0000");
    }
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
      this.updateTowerCooldownIndicator();

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

    if (this.isTowerVisible() && this.isBaseVisible()) {
      this.checkTowerMovement();
    }

    if (!this.towerIsMoving) {
      this.checkTowerAttacks();
    }

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

  private isTowerVisible(): boolean {
    return (
      this.towerTarget &&
      this.towerTarget.object3D &&
      this.towerTarget.object3D.visible
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

  private checkTowerAttacks() {
    if (!this.isTowerVisible()) {
      return;
    }
    const now = Date.now();

    // Enforce firing cooldown: only fire if cooldown has elapsed
    if (now - this.lastShotTime < this.towerFireRateMs) {
      return;
    }

    const towerWorldPosition = this.getMarkerWorldPosition(this.towerTarget);
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

        if (distance <= this.towerRange && distance < closestDistance) {
          closestDistance = distance;
          closestEnemyId = enemyId;
        }
      }
    });

    if (closestEnemyId) {
      const enemy = this.enemies.get(closestEnemyId);
      if (enemy) {
        this.createAttackLine(enemy);
        this.addPoints(1);
        this.destroyEnemy(closestEnemyId);
        this.lastShotTime = now;
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

  private createAttackLine(enemy: Enemy) {
    const enemyPos = enemy.entity.getAttribute("position");

    const towerPos = this.getTowerPosition();

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
    lineEntity.setAttribute("material", "color: #ff0000; opacity: 0.5");

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

  private setupTowerVisuals() {
    if (!this.towerTarget) return;

    // Store references to existing tower elements
    this.towerSphere = this.towerTarget.querySelector("a-sphere");
    this.towerCircle = this.towerTarget.querySelector("a-circle");

    // Reset tower to active state
    this.setTowerActive(true);
  }

  private handleTowerLost() {
    // Remove any existing moving text before losing references
    if (this.towerMovingText && this.towerTarget) {
      try {
        this.towerTarget.removeChild(this.towerMovingText);
      } catch (e) {
        console.log("Could not remove moving text (target already lost)");
      }
    }

    // Set to moving state so it will need to re-establish stability when reconnected
    this.towerIsMoving = true;
    this.resetTowerState();
  }

  private resetTowerState() {
    this.towerSphere = null;
    this.towerCircle = null;
    this.towerMovingText = null;
    this.towerHomePosition = null;
    this.lastTowerPosition = null;
    this.lastMovementTime = Date.now(); // Set current time for stability checking
  }

  private checkTowerMovement() {
    const currentPosition = this.getTowerPosition();
    if (!currentPosition) {
      return;
    }

    const currentTime = Date.now();

    if (!this.towerHomePosition) {
      // Establish initial home position
      this.towerHomePosition = { ...currentPosition };
      this.lastMovementTime = currentTime;
      return;
    }

    // Check for movement from home position (triggers moving state)
    const distanceFromHome = this.calculateDistance2D(
      this.towerHomePosition,
      currentPosition
    );

    // Check for recent movement (frame to frame)
    let recentMovement = 0;
    if (this.lastTowerPosition) {
      recentMovement = this.calculateDistance2D(
        this.lastTowerPosition,
        currentPosition
      );
    }

    if (distanceFromHome > this.MOVEMENT_THRESHOLD && !this.towerIsMoving) {
      this.towerIsMoving = true;
      this.setTowerActive(false);
      this.lastMovementTime = 0;
    }

    if (this.towerIsMoving) {
      if (recentMovement <= 0.1) {
        if (this.lastMovementTime === 0) {
          this.lastMovementTime = currentTime;
        }

        const timeSinceStabilizationStarted =
          currentTime - this.lastMovementTime;
        const timeRemaining =
          this.STABILITY_TIME - timeSinceStabilizationStarted;

        if (timeSinceStabilizationStarted >= this.STABILITY_TIME) {
          this.towerHomePosition = { ...currentPosition };
          this.towerIsMoving = false;
          this.setTowerActive(true);
          this.lastMovementTime = 0;
        } else {
          this.updateMovingText(Math.ceil(timeRemaining / 1000));
        }
      } else {
        if (this.lastMovementTime > 0) {
          this.lastMovementTime = 0;
        }
      }
    }

    this.lastTowerPosition = { ...currentPosition };
  }

  private updateMovingText(secondsRemaining: number) {
    if (this.towerMovingText) {
      if (secondsRemaining == this.STABILITY_TIME / 1000) {
        this.towerMovingText.setAttribute("value", `BUILDING...`);
      } else {
        this.towerMovingText.setAttribute(
          "value",
          `BUILDING... (${secondsRemaining})`
        );
      }
    }
  }

  private setTowerActive(active: boolean) {
    if (!this.towerTarget) return;

    if (active) {
      // Activate tower
      if (this.towerSphere) {
        this.towerSphere.setAttribute("visible", "true");
      }
      if (this.towerCircle) {
        this.towerCircle.setAttribute("color", "red");
      }
      if (this.towerMovingText) {
        this.towerTarget.removeChild(this.towerMovingText);
        this.towerMovingText = null;
      }
    } else {
      // Deactivate tower
      if (this.towerSphere) {
        this.towerSphere.setAttribute("visible", "false");
      }
      if (this.towerCircle) {
        this.towerCircle.setAttribute("color", "black");
      }

      if (!this.towerMovingText) {
        this.towerMovingText = document.createElement("a-text");
        this.towerMovingText.setAttribute("position", "0 0 0.15");
        this.towerMovingText.setAttribute("align", "center");
        this.towerMovingText.setAttribute("color", "white");
        this.towerMovingText.setAttribute("scale", "0.5 0.5 0.5");
        this.towerTarget.appendChild(this.towerMovingText);
      }
    }
  }

  private getTowerPosition(): Position2D | null {
    if (
      !this.baseTarget ||
      !this.towerTarget ||
      !this.baseTarget.object3D ||
      !this.towerTarget.object3D
    ) {
      return null;
    }
    // Get the tower's world position
    const towerWorldPos = this.towerTarget.object3D.getWorldPosition(
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

    if (this.health <= 0) {
      this.endGame();
    }
  }

  private addPoints(points: number) {
    if (this.gameOver) return;

    const added = Math.round(points * this.pointMultiplier);
    this.points += added;
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

  private endGame() {
    this.gameOver = true;

    // Stop enemy spawning
    this.stopEnemySpawning();

    // Show game over screen
    if (this.gameOverScreen && this.finalScoreElement) {
      this.finalScoreElement.textContent = this.points.toString();
      this.gameOverScreen.style.display = "block";
    }

    if (this.towerMovingText) {
      this.towerTarget.removeChild(this.towerMovingText);
      this.towerMovingText = null;
    }
  }

  private restartGame() {
    // Reset game state
    this.health = this.defaultBaseHealth;
    this.points = 0;
    this.gameOver = false;

    // Clear all enemies
    this.enemies.forEach((_, enemyId) => {
      this.destroyEnemy(enemyId);
    });

    // Reset enemy counter
    this.enemyIdCounter = 0;

    // Update UI
    this.updateHealthDisplay();
    this.updatePointsDisplay();

    // Hide game over screen
    if (this.gameOverScreen) {
      this.gameOverScreen.style.display = "none";
    }

    // Reset tower state
    this.towerIsMoving = false;
    this.resetTowerState();

    console.log("Game restarted!");
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
