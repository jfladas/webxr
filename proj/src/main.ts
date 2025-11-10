interface Enemy {
  id: string;
  entity: any;
  targetPosition: { x: number; y: number; z: number };
  speed: number;
  health: number;
}

class TowerDefenseGame {
  private scene: any;
  private baseTarget: any;
  private towerTarget: any;
  private enemies: Map<string, Enemy> = new Map();
  private enemyIdCounter = 0;
  private spawnInterval: number | null = null;
  private gameLoop: number | null = null;
  private connectionLine: any = null;
  private towerRangeCircle: any = null;

  private readonly ENEMY_SPEED = 0.5;
  private readonly SPAWN_DISTANCE = 5;
  private readonly TOWER_RANGE = 1000;

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

    this.createConnectionLine();

    this.baseTarget.addEventListener("targetFound", () => {
      console.log("Base target found - starting enemy spawning");
      this.startEnemySpawning();
      this.updateConnectionLine();
    });

    this.baseTarget.addEventListener("targetLost", () => {
      console.log("Base target lost - stopping enemy spawning");
      this.stopEnemySpawning();
      this.hideConnectionLine();
    });

    this.towerTarget.addEventListener("targetFound", () => {
      console.log("Tower target found");
      this.updateConnectionLine();
    });

    this.towerTarget.addEventListener("targetLost", () => {
      console.log("Tower target lost");
      this.hideConnectionLine();
    });

    this.startGameLoop();
  }

  private startEnemySpawning() {
    if (this.spawnInterval) return;

    this.spawnInterval = window.setInterval(() => {
      this.spawnEnemy();
    }, 100);
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

    enemyEntity.setAttribute("position", `${spawnX} ${spawnY} 0`);

    this.baseTarget.appendChild(enemyEntity);

    const enemy: Enemy = {
      id: enemyId,
      entity: enemyEntity,
      targetPosition: { x: 0, y: 0, z: 0 },
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

    // Update connection line between markers
    this.updateConnectionLine();

    // Update tower range circle position
    this.updateTowerRangeCircle();

    // Check for tower attacks first
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
        z: 0,
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

  private createConnectionLine() {
    this.connectionLine = document.createElement("a-entity");
    this.connectionLine.setAttribute("id", "marker-connection-line");
    this.connectionLine.setAttribute("visible", "false");
    this.scene.appendChild(this.connectionLine);
  }

  private updateConnectionLine() {
    if (!this.connectionLine || !this.areMarkersVisible()) {
      return;
    }

    const baseWorldPosition = this.getMarkerWorldPosition(this.baseTarget);
    const towerWorldPosition = this.getMarkerWorldPosition(this.towerTarget);

    if (baseWorldPosition && towerWorldPosition) {
      const relativePosition = {
        x: towerWorldPosition.x - baseWorldPosition.x,
        y: towerWorldPosition.y - baseWorldPosition.y,
        z: towerWorldPosition.z - baseWorldPosition.z,
      };

      const distance = Math.sqrt(
        relativePosition.x ** 2 +
          relativePosition.y ** 2 +
          relativePosition.z ** 2
      );

      console.log(`Marker positions:
        Base: (${baseWorldPosition.x.toFixed(3)}, ${baseWorldPosition.y.toFixed(
        3
      )}, ${baseWorldPosition.z.toFixed(3)})
        Tower: (${towerWorldPosition.x.toFixed(
          3
        )}, ${towerWorldPosition.y.toFixed(3)}, ${towerWorldPosition.z.toFixed(
        3
      )})
        Relative: (${relativePosition.x.toFixed(
          3
        )}, ${relativePosition.y.toFixed(3)}, ${relativePosition.z.toFixed(3)})
        Distance: ${distance.toFixed(3)} units`);

      this.connectionLine.setAttribute(
        "line",
        `
          start: ${baseWorldPosition.x} ${baseWorldPosition.y} ${
          baseWorldPosition.z + 0.1
        };
          end: ${towerWorldPosition.x} ${towerWorldPosition.y} ${
          towerWorldPosition.z + 0.1
        };
          color: yellow;
          opacity: 0.5
        `
      );
      this.connectionLine.setAttribute("visible", "true");
    }
  }

  private hideConnectionLine() {
    if (this.connectionLine) {
      this.connectionLine.setAttribute("visible", "false");
    }
  }

  private areMarkersVisible(): boolean {
    return this.isBaseVisible() && this.isTowerVisible();
  }

  private isTowerVisible(): boolean {
    return (
      this.towerTarget &&
      this.towerTarget.object3D &&
      this.towerTarget.object3D.visible
    );
  }

  private getMarkerWorldPosition(
    marker: any
  ): { x: number; y: number; z: number } | null {
    if (!marker || !marker.object3D) {
      return null;
    }

    // Get the world position of the marker using A-Frame's method
    const worldPosition = marker.object3D.getWorldPosition(
      new (window as any).THREE.Vector3()
    );

    return {
      x: worldPosition.x,
      y: worldPosition.y,
      z: worldPosition.z,
    };
  }

  private updateTowerRangeCircle() {
    if (!this.towerRangeCircle || !this.isTowerVisible()) {
      if (this.towerRangeCircle) {
        this.towerRangeCircle.setAttribute("visible", "false");
      }
      return;
    }

    const towerWorldPosition = this.getMarkerWorldPosition(this.towerTarget);
    if (towerWorldPosition) {
      this.towerRangeCircle.setAttribute(
        "position",
        `${towerWorldPosition.x} ${towerWorldPosition.y} ${towerWorldPosition.z}`
      );
      this.towerRangeCircle.setAttribute("visible", "true");
    }
  }

  private checkTowerAttacks() {
    if (!this.isTowerVisible()) {
      return;
    }

    const towerWorldPosition = this.getMarkerWorldPosition(this.towerTarget);
    if (!towerWorldPosition) {
      return;
    }

    // Check each enemy for tower range
    const enemiesToDestroy: string[] = [];

    this.enemies.forEach((enemy, enemyId) => {
      const enemyWorldPosition = this.getEnemyWorldPosition(enemy);
      if (enemyWorldPosition) {
        const distance = this.calculateDistance3D(
          towerWorldPosition,
          enemyWorldPosition
        );

        if (distance <= this.TOWER_RANGE) {
          console.log(
            `Tower attacking enemy ${enemyId} at distance ${distance.toFixed(
              3
            )}`
          );
          enemiesToDestroy.push(enemyId);
          this.createAttackEffect(towerWorldPosition, enemyWorldPosition);
        }
      }
    });

    // Destroy enemies that were in range
    enemiesToDestroy.forEach((enemyId) => {
      this.destroyEnemy(enemyId);
    });
  }

  private getEnemyWorldPosition(
    enemy: Enemy
  ): { x: number; y: number; z: number } | null {
    if (!enemy.entity || !enemy.entity.object3D) {
      return null;
    }

    const worldPosition = enemy.entity.object3D.getWorldPosition(
      new (window as any).THREE.Vector3()
    );

    return {
      x: worldPosition.x,
      y: worldPosition.y,
      z: worldPosition.z,
    };
  }

  private calculateDistance3D(
    pos1: { x: number; y: number; z: number },
    pos2: { x: number; y: number; z: number }
  ): number {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    const dz = pos2.z - pos1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private createAttackEffect(
    towerPos: { x: number; y: number; z: number },
    enemyPos: { x: number; y: number; z: number }
  ) {
    // Create a temporary laser beam effect
    const laser = document.createElement("a-entity");
    laser.setAttribute(
      "line",
      `
      start: ${towerPos.x} ${towerPos.y} ${towerPos.z + 0.1};
      end: ${enemyPos.x} ${enemyPos.y} ${enemyPos.z + 0.1};
      color: red;
      opacity: 0.5
    `
    );
    this.scene.appendChild(laser);

    // Remove the laser after a short time
    setTimeout(() => {
      if (laser.parentNode) {
        laser.parentNode.removeChild(laser);
      }
    }, 200);
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
    if (this.connectionLine && this.connectionLine.parentNode) {
      this.connectionLine.parentNode.removeChild(this.connectionLine);
    }
    if (this.towerRangeCircle && this.towerRangeCircle.parentNode) {
      this.towerRangeCircle.parentNode.removeChild(this.towerRangeCircle);
    }
  }
}

const game = new TowerDefenseGame();

window.addEventListener("beforeunload", () => {
  game.cleanup();
});
