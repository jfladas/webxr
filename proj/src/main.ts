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

  private readonly ENEMY_SPEED = 0.5;
  private readonly SPAWN_DISTANCE = 5;

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

    this.startGameLoop();
  }

  private startEnemySpawning() {
    if (this.spawnInterval) return;

    this.spawnInterval = window.setInterval(() => {
      this.spawnEnemy();
    }, 1000);
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
