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

  private readonly ENEMY_SPEED = 0.5;
  private readonly SPAWN_DISTANCE = 5;
  private readonly SPAWN_TIME = 2000;
  private readonly TOWER_RANGE = 1000;
  private readonly GAME_Z_PLANE = 0;

  constructor() {
    this.init();
  }

  private init() {
    document.addEventListener("DOMContentLoaded", () => {
      this.scene = document.querySelector("a-scene");

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
      console.log("Base target found - starting enemy spawning");
      this.startEnemySpawning();
    });

    this.baseTarget.addEventListener("targetLost", () => {
      console.log("Base target lost - stopping enemy spawning");
      this.stopEnemySpawning();
    });

    this.towerTarget.addEventListener("targetFound", () => {
      console.log("Tower target found");
    });

    this.towerTarget.addEventListener("targetLost", () => {
      console.log("Tower target lost");
    });

    this.startGameLoop();
  }

  private startEnemySpawning() {
    if (this.spawnInterval) return;

    this.spawnInterval = window.setInterval(() => {
      this.spawnEnemy();
    }, this.SPAWN_TIME);
  }

  private stopEnemySpawning() {
    if (this.spawnInterval) {
      clearInterval(this.spawnInterval);
      this.spawnInterval = null;
      console.log("Enemy spawning stopped");
    }
  }

  private spawnEnemy() {
    if (!this.isBaseVisible()) {
      console.log("Base not visible, skipping enemy spawn");
      return;
    }

    const enemyId = `enemy-${this.enemyIdCounter++}`;

    const enemyEntity = document.createElement("a-sphere");
    enemyEntity.setAttribute("id", enemyId);
    enemyEntity.setAttribute("radius", "0.05");
    enemyEntity.setAttribute("color", "lime");
    enemyEntity.setAttribute("opacity", "0.5");
    enemyEntity.setAttribute("metalness", "0.1");
    enemyEntity.setAttribute("roughness", "0.5");

    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnX = Math.cos(spawnAngle) * this.SPAWN_DISTANCE;
    const spawnY = Math.sin(spawnAngle) * this.SPAWN_DISTANCE;

    enemyEntity.setAttribute(
      "position",
      `${spawnX} ${spawnY} ${this.GAME_Z_PLANE}`
    );

    this.baseTarget.appendChild(enemyEntity);

    const enemy: Enemy = {
      id: enemyId,
      entity: enemyEntity,
      targetPosition: { x: 0, y: 0 },
      speed: this.ENEMY_SPEED,
      health: 1,
    };

    this.enemies.set(enemyId, enemy);

    console.log(
      `Spawned enemy ${enemyId} at position (${spawnX}, ${spawnY}, 0)`
    );
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
      this.updateEnemies();
      this.gameLoop = requestAnimationFrame(gameUpdate);
    };

    gameUpdate();
  }

  private updateEnemies() {
    const deltaTime = 1 / 60;

    this.checkTowerAttacks();

    this.enemies.forEach((enemy, enemyId) => {
      const currentPos = enemy.entity.getAttribute("position");

      const direction = {
        x: enemy.targetPosition.x - currentPos.x,
        y: enemy.targetPosition.y - currentPos.y,
      };

      const distance = Math.sqrt(direction.x ** 2 + direction.y ** 2);

      if (distance < 0.2) {
        this.destroyEnemy(enemyId);
        console.log(`Enemy ${enemyId} reached the base!`);
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
      console.log(`Destroying enemy ${enemyId}`);
      if (enemy.entity.parentNode) {
        enemy.entity.parentNode.removeChild(enemy.entity);
      }
      this.enemies.delete(enemyId);
      console.log(
        `Enemy ${enemyId} destroyed. Remaining enemies: ${this.enemies.size}`
      );
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

    const towerWorldPosition = this.getMarkerWorldPosition(this.towerTarget);
    if (!towerWorldPosition) {
      return;
    }

    const enemiesToDestroy: string[] = [];

    this.enemies.forEach((enemy, enemyId) => {
      const enemyWorldPosition = this.getEnemyWorldPosition(enemy);
      if (enemyWorldPosition) {
        const distance = this.calculateDistance2D(
          towerWorldPosition,
          enemyWorldPosition
        );

        if (distance <= this.TOWER_RANGE) {
          console.log(
            `Tower attacking enemy ${enemyId} at distance ${distance.toFixed(
              3
            )}`
          );
          this.createAttackLine(enemy);
          enemiesToDestroy.push(enemyId);
        }
      }
    });

    enemiesToDestroy.forEach((enemyId) => {
      this.destroyEnemy(enemyId);
    });
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
      console.log("Could not get tower position");
      return;
    }

    console.log(
      `Creating attack line from tower (${towerPos.x.toFixed(
        3
      )}, ${towerPos.y.toFixed(3)}) to enemy (${enemyPos.x.toFixed(
        3
      )}, ${enemyPos.y.toFixed(3)})`
    );

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

    console.log(
      `Attack line created in world space - distance: ${distance.toFixed(
        3
      )}, angle: ${angle.toFixed(3)}, midpoint: (${midpoint.x.toFixed(
        3
      )}, ${midpoint.y.toFixed(3)})`
    );

    setTimeout(() => {
      if (lineEntity.parentNode) {
        lineEntity.parentNode.removeChild(lineEntity);
        console.log("Attack line removed");
      }
    }, 100);
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

    console.log(
      `Tower local position in base coordinate system: (${relativePos.x.toFixed(
        3
      )}, ${relativePos.y.toFixed(3)})`
    );

    return relativePos;
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
