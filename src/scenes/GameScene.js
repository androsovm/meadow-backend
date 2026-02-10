import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');

    // Timing константы (в миллисекундах)
    this.TIMING = {
      CHARGE_TIME: 1000,      // Полное время замаха
      TOO_EARLY_END: 200,     // 0-200ms: слишком рано
      EARLY_END: 400,         // 200-400ms: рано
      PERFECT_END: 600,       // 400-600ms: PERFECT!
      LATE_END: 800,          // 600-800ms: поздно
      // 800-1000ms: слишком поздно
    };

    // Время суток
    this.TIME_OF_DAY = {
      CYCLE_DURATION: 60 * 1000,  // 60 секунд для теста (потом 24 минуты)
      currentTime: 0,             // 0-1 (0 = полночь, 0.5 = полдень)
    };
  }

  preload() {
    // Загружаем карту
    this.load.json('tilemap', '/maps/tilemap.json');
    this.load.image('tileset_raw', '/assets/tilesets/GRASS+.png');
  }

  create() {
    // Константы тайлсета
    this.TILE_SIZE = 16;
    this.TILESET_COLS = 25;

    // Обрабатываем tileset (делаем чёрный прозрачным)
    this.processTransparency();

    // Создаём placeholder текстуры (для скошенной травы)
    this.createPlaceholderTextures();

    // Загружаем карту или создаём дефолтную
    this.loadMap();

    // Создаём игрока (прямоугольник 16x32)
    this.createPlayer();

    // Управление
    this.cursors = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });

    // Состояние косьбы
    this.isMowing = false;
    this.mowStartTime = 0;
    this.mowReleaseTime = 0;

    // UI для шкалы косьбы
    this.createMowingUI();

    // Overlay для времени суток
    this.createTimeOverlay();

    // Обработка мыши
    this.input.on('pointerdown', () => this.startMowing());
    this.input.on('pointerup', () => this.releaseMowing());

    // UI подсказка
    this.add.text(10, 10, 'WASD - ходить | ЛКМ - косить (отпусти в зелёной зоне!)', {
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 4, y: 2 }
    }).setScrollFactor(0).setDepth(10000);

    // Время суток UI
    this.timeText = this.add.text(10, 30, '', {
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 4, y: 2 }
    }).setScrollFactor(0).setDepth(10000);

    // Камера следует за игроком
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setZoom(1);
  }

  processTransparency() {
    // Получаем raw tileset
    const rawTexture = this.textures.get('tileset_raw');
    const source = rawTexture.getSourceImage();

    // Создаём canvas для обработки
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');

    // Рисуем оригинал
    ctx.drawImage(source, 0, 0);

    // Получаем данные пикселей
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Порог для "чёрного"
    const threshold = 10;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Если пиксель почти чёрный — делаем прозрачным
      if (r < threshold && g < threshold && b < threshold) {
        data[i + 3] = 0;
      }
    }

    // Возвращаем обработанные данные
    ctx.putImageData(imageData, 0, 0);

    // Создаём новую текстуру
    this.textures.addCanvas('tileset', canvas);
  }

  createPlaceholderTextures() {
    // Текстура скошенной травы
    const cutGrassGraphics = this.add.graphics();
    cutGrassGraphics.fillStyle(0x8B7355);
    cutGrassGraphics.fillRect(0, 0, 16, 16);
    cutGrassGraphics.fillStyle(0x9ACD32);
    cutGrassGraphics.fillRect(2, 10, 12, 4);
    cutGrassGraphics.generateTexture('cutGrass', 16, 16);
    cutGrassGraphics.destroy();
  }

  loadMap() {
    const mapData = this.cache.json.get('tilemap');

    this.grassTiles = this.add.group();  // Объекты которые можно косить
    this.groundTiles = this.add.group(); // Фон (земля)

    if (mapData && mapData.layers) {
      this.mapWidth = mapData.width;
      this.mapHeight = mapData.height;

      // Загружаем ground слой (фон, не интерактивный)
      const groundLayer = mapData.layers.ground;
      for (let y = 0; y < mapData.height; y++) {
        for (let x = 0; x < mapData.width; x++) {
          const tileId = groundLayer[y][x];
          if (tileId !== null && tileId !== undefined) {
            const tile = this.createTileSprite(x, y, tileId);
            tile.setDepth(0);
            this.groundTiles.add(tile);
          }
        }
      }

      // Загружаем objects слой (трава — можно косить!)
      if (mapData.layers.objects) {
        const objectsLayer = mapData.layers.objects;
        for (let y = 0; y < mapData.height; y++) {
          for (let x = 0; x < mapData.width; x++) {
            const tileId = objectsLayer[y][x];
            if (tileId !== null && tileId !== undefined) {
              const tile = this.createTileSprite(x, y, tileId);
              // Depth по пиксельной Y + высота тайла (низ объекта)
              tile.setDepth(10 + (y + 1) * this.TILE_SIZE);
              tile.setData('hasGrass', true);  // Можно косить
              tile.setData('originalTileId', tileId);
              tile.setData('gridX', x);
              tile.setData('gridY', y);
              this.grassTiles.add(tile);
            }
          }
        }
      }
    } else {
      // Дефолтное поле
      this.createDefaultField();
    }
  }

  createTileSprite(gridX, gridY, tileId) {
    // Создаём фрейм если его ещё нет
    const frameKey = `tile_${tileId}`;
    const tileset = this.textures.get('tileset');

    if (!tileset.has(frameKey)) {
      const frameX = (tileId % this.TILESET_COLS) * this.TILE_SIZE;
      const frameY = Math.floor(tileId / this.TILESET_COLS) * this.TILE_SIZE;
      tileset.add(frameKey, 0, frameX, frameY, this.TILE_SIZE, this.TILE_SIZE);
    }

    const sprite = this.add.image(
      gridX * this.TILE_SIZE,
      gridY * this.TILE_SIZE,
      'tileset',
      frameKey
    );
    sprite.setOrigin(0, 0);

    return sprite;
  }

  createDefaultField() {
    this.mapWidth = 20;
    this.mapHeight = 15;

    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 20; x++) {
        // Земля (фон)
        const ground = this.createTileSprite(x, y, 0);
        ground.setDepth(0);
        this.groundTiles.add(ground);

        // Трава (можно косить)
        const grass = this.createTileSprite(x, y, 25); // Предполагаем tileId 25 = трава
        grass.setDepth(10 + y);
        grass.setData('hasGrass', true);
        grass.setData('originalTileId', 25);
        grass.setData('gridX', x);
        grass.setData('gridY', y);
        this.grassTiles.add(grass);
      }
    }
  }

  createPlayer() {
    // Прямоугольник 16x32 (коричневый - типа крестьянин)
    const playerGraphics = this.add.graphics();

    // Тело
    playerGraphics.fillStyle(0x8B4513);
    playerGraphics.fillRect(0, 0, 16, 32);

    // Голова
    playerGraphics.fillStyle(0xFFDBB4);
    playerGraphics.fillRect(4, 2, 8, 8);

    // Рубашка
    playerGraphics.fillStyle(0x4169E1);
    playerGraphics.fillRect(2, 10, 12, 12);

    // Ноги
    playerGraphics.fillStyle(0x2F4F4F);
    playerGraphics.fillRect(3, 22, 4, 10);
    playerGraphics.fillRect(9, 22, 4, 10);

    playerGraphics.generateTexture('player', 16, 32);
    playerGraphics.destroy();

    // Создаём спрайт игрока
    this.player = this.add.image(160, 120, 'player');
    this.player.setOrigin(0.5, 1);  // Origin внизу — ноги определяют позицию
    this.player.setDepth(10 + 120); // Начальный depth по Y
    this.playerDirection = 'down';
  }

  createMowingUI() {
    // Контейнер для шкалы (над головой игрока)
    this.mowingUI = this.add.container(0, 0);
    this.mowingUI.setDepth(10001);

    // Фон шкалы
    this.progressBg = this.add.rectangle(0, 0, 32, 6, 0x333333);
    this.progressBg.setOrigin(0.5, 0.5);
    this.progressBg.setStrokeStyle(1, 0x000000);

    // Зоны шкалы (для визуализации)
    // Too Early (0-20%)
    this.zoneTooEarly = this.add.rectangle(-16 + 3.2, 0, 6.4, 4, 0xff0000);
    this.zoneTooEarly.setOrigin(0, 0.5);

    // Early (20-40%)
    this.zoneEarly = this.add.rectangle(-16 + 6.4 + 3.2, 0, 6.4, 4, 0xffa500);
    this.zoneEarly.setOrigin(0, 0.5);

    // Perfect (40-60%)
    this.zonePerfect = this.add.rectangle(-16 + 12.8 + 3.2, 0, 6.4, 4, 0x00ff00);
    this.zonePerfect.setOrigin(0, 0.5);

    // Late (60-80%)
    this.zoneLate = this.add.rectangle(-16 + 19.2 + 3.2, 0, 6.4, 4, 0xffa500);
    this.zoneLate.setOrigin(0, 0.5);

    // Too Late (80-100%)
    this.zoneTooLate = this.add.rectangle(-16 + 25.6 + 3.2, 0, 6.4, 4, 0xff0000);
    this.zoneTooLate.setOrigin(0, 0.5);

    // Индикатор прогресса (линия)
    this.progressIndicator = this.add.rectangle(-16, 0, 2, 8, 0xffffff);
    this.progressIndicator.setOrigin(0.5, 0.5);

    // Добавляем в контейнер
    this.mowingUI.add([
      this.progressBg,
      this.zoneTooEarly,
      this.zoneEarly,
      this.zonePerfect,
      this.zoneLate,
      this.zoneTooLate,
      this.progressIndicator
    ]);

    this.mowingUI.setVisible(false);
  }

  createTimeOverlay() {
    // Огромный оверлей который покроет всю карту
    const mapPixelWidth = (this.mapWidth || 100) * this.TILE_SIZE;
    const mapPixelHeight = (this.mapHeight || 100) * this.TILE_SIZE;

    this.timeOverlay = this.add.rectangle(
      mapPixelWidth / 2,
      mapPixelHeight / 2,
      mapPixelWidth + 1000,  // С запасом
      mapPixelHeight + 1000,
      0x000000,
      0
    );
    this.timeOverlay.setDepth(9999);  // Выше всего
  }

  startMowing() {
    if (!this.isMoving()) {
      this.isMowing = true;
      this.mowStartTime = this.time.now;
      this.mowingUI.setVisible(true);
    }
  }

  releaseMowing() {
    if (!this.isMowing) return;

    const holdTime = this.time.now - this.mowStartTime;
    const result = this.evaluateTiming(holdTime);

    // Выполняем косьбу в зависимости от результата
    if (result !== 'too_early' && result !== 'too_late') {
      this.mowGrass(result);
    }

    // Показываем feedback
    this.showTimingFeedback(result);

    this.isMowing = false;
    this.mowingUI.setVisible(false);
  }

  evaluateTiming(holdTime) {
    if (holdTime < this.TIMING.TOO_EARLY_END) {
      return 'too_early';
    } else if (holdTime < this.TIMING.EARLY_END) {
      return 'early';
    } else if (holdTime < this.TIMING.PERFECT_END) {
      return 'perfect';
    } else if (holdTime < this.TIMING.LATE_END) {
      return 'late';
    } else if (holdTime < this.TIMING.CHARGE_TIME) {
      return 'too_late';
    } else {
      return 'overhold';
    }
  }

  showTimingFeedback(result) {
    const colors = {
      'too_early': 0xff0000,
      'early': 0xffa500,
      'perfect': 0x00ff00,
      'late': 0xffa500,
      'too_late': 0xff0000,
      'overhold': 0xff0000
    };

    const texts = {
      'too_early': 'Рано!',
      'early': 'Неплохо',
      'perfect': 'PERFECT!',
      'late': 'Неплохо',
      'too_late': 'Поздно!',
      'overhold': 'Сброс'
    };

    // Показываем текст над игроком
    const feedbackText = this.add.text(
      this.player.x,
      this.player.y - 50,
      texts[result],
      {
        fontSize: result === 'perfect' ? '12px' : '10px',
        color: '#' + colors[result].toString(16).padStart(6, '0'),
        fontStyle: result === 'perfect' ? 'bold' : 'normal'
      }
    );
    feedbackText.setOrigin(0.5, 0.5);
    feedbackText.setDepth(10002);

    // Анимация исчезновения
    this.tweens.add({
      targets: feedbackText,
      y: feedbackText.y - 20,
      alpha: 0,
      duration: 800,
      ease: 'Power2',
      onComplete: () => feedbackText.destroy()
    });

    // Для Perfect — дополнительный эффект
    if (result === 'perfect') {
      this.cameras.main.shake(50, 0.002);
    }
  }

  isMoving() {
    return this.cursors.up.isDown ||
           this.cursors.down.isDown ||
           this.cursors.left.isDown ||
           this.cursors.right.isDown;
  }

  update(time, delta) {
    // Обновляем время суток
    this.updateTimeOfDay(delta);

    // Если косим - обновляем UI
    if (this.isMowing) {
      this.updateMowingUI();

      // Авто-сброс при перезамахе
      const holdTime = this.time.now - this.mowStartTime;
      if (holdTime >= this.TIMING.CHARGE_TIME) {
        this.releaseMowing();
      }
      return;
    }

    // Движение
    const speed = 80;
    let velocityX = 0;
    let velocityY = 0;

    if (this.cursors.left.isDown) {
      velocityX = -speed;
      this.playerDirection = 'left';
    } else if (this.cursors.right.isDown) {
      velocityX = speed;
      this.playerDirection = 'right';
    }

    if (this.cursors.up.isDown) {
      velocityY = -speed;
      this.playerDirection = 'up';
    } else if (this.cursors.down.isDown) {
      velocityY = speed;
      this.playerDirection = 'down';
    }

    this.player.x += velocityX * (delta / 1000);
    this.player.y += velocityY * (delta / 1000);

    // Обновляем depth по Y — чтобы трава могла перекрывать персонажа
    this.player.setDepth(10 + this.player.y);
  }

  updateMowingUI() {
    // Позиционируем над игроком
    this.mowingUI.setPosition(this.player.x, this.player.y - 45);

    // Обновляем индикатор
    const holdTime = this.time.now - this.mowStartTime;
    const progress = Math.min(holdTime / this.TIMING.CHARGE_TIME, 1);

    // Двигаем индикатор по шкале (-16 до +16)
    this.progressIndicator.x = -16 + (progress * 32);

    // Подсвечиваем текущую зону
    const result = this.evaluateTiming(holdTime);

    // Пульсация Perfect зоны
    if (result === 'perfect') {
      this.zonePerfect.setFillStyle(0x00ff00);
      this.zonePerfect.setScale(1 + Math.sin(this.time.now * 0.01) * 0.1);
    } else {
      this.zonePerfect.setScale(1);
    }
  }

  updateTimeOfDay(delta) {
    // Обновляем внутреннее время (0-1)
    this.TIME_OF_DAY.currentTime += delta / this.TIME_OF_DAY.CYCLE_DURATION;
    if (this.TIME_OF_DAY.currentTime >= 1) {
      this.TIME_OF_DAY.currentTime -= 1;
    }

    const t = this.TIME_OF_DAY.currentTime;

    // Ключевые точки времени с уютными цветами
    const timePoints = [
      { time: 0.00, color: 0x2d2a4a, alpha: 0.35 },  // Полночь - мягкий фиолетовый
      { time: 0.15, color: 0x3d3a5a, alpha: 0.30 },  // Поздняя ночь
      { time: 0.25, color: 0x8b6b7b, alpha: 0.20 },  // Рассвет - розоватый
      { time: 0.30, color: 0xffb088, alpha: 0.10 },  // Раннее утро - персиковый
      { time: 0.40, color: 0xffe4c4, alpha: 0.05 },  // Утро - кремовый
      { time: 0.50, color: 0xfff8dc, alpha: 0.02 },  // День - едва заметный тёплый
      { time: 0.60, color: 0xffe4b5, alpha: 0.05 },  // После полудня - мягкий
      { time: 0.70, color: 0xffcc77, alpha: 0.12 },  // Золотой час - янтарный
      { time: 0.78, color: 0xff9966, alpha: 0.18 },  // Закат - оранжевый
      { time: 0.85, color: 0xcc7799, alpha: 0.22 },  // Сумерки - розово-лиловый (уютный!)
      { time: 0.92, color: 0x6b5b8a, alpha: 0.28 },  // Вечер - лавандовый
      { time: 1.00, color: 0x2d2a4a, alpha: 0.35 },  // Обратно к полуночи
    ];

    // Находим две ближайшие точки и интерполируем
    let prevPoint = timePoints[timePoints.length - 1];
    let nextPoint = timePoints[0];

    for (let i = 0; i < timePoints.length; i++) {
      if (timePoints[i].time > t) {
        nextPoint = timePoints[i];
        prevPoint = timePoints[i - 1] || timePoints[timePoints.length - 1];
        break;
      }
      prevPoint = timePoints[i];
      nextPoint = timePoints[(i + 1) % timePoints.length];
    }

    // Плавная интерполяция между точками
    let range = nextPoint.time - prevPoint.time;
    if (range <= 0) range = 1;
    let progress = (t - prevPoint.time) / range;
    if (progress < 0) progress += 1;

    // Используем smoothstep для ещё более плавного перехода
    progress = progress * progress * (3 - 2 * progress);

    const overlayColor = this.lerpColor(prevPoint.color, nextPoint.color, progress);
    const overlayAlpha = prevPoint.alpha + (nextPoint.alpha - prevPoint.alpha) * progress;

    if (this.timeOverlay) {
      this.timeOverlay.setFillStyle(overlayColor, overlayAlpha);
    }

    // Обновляем текст времени
    const hours = Math.floor(t * 24);
    const minutes = Math.floor((t * 24 - hours) * 60);
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    const periods = ['Ночь', 'Ночь', 'Ночь', 'Ночь', 'Рассвет', 'Рассвет',
                     'Утро', 'Утро', 'Утро', 'Утро', 'День', 'День',
                     'День', 'День', 'День', 'После полудня', 'После полудня', 'Золотой час',
                     'Закат', 'Закат', 'Сумерки', 'Сумерки', 'Вечер', 'Ночь'];

    this.timeText.setText(`${timeString} - ${periods[hours]}`);
  }

  lerpColor(color1, color2, t) {
    const r1 = (color1 >> 16) & 0xff;
    const g1 = (color1 >> 8) & 0xff;
    const b1 = color1 & 0xff;

    const r2 = (color2 >> 16) & 0xff;
    const g2 = (color2 >> 8) & 0xff;
    const b2 = color2 & 0xff;

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return (r << 16) | (g << 8) | b;
  }

  mowGrass(quality) {
    // Определяем позицию перед игроком
    let targetX = this.player.x;
    let targetY = this.player.y - 16;

    switch (this.playerDirection) {
      case 'up':
        targetY = this.player.y - 32 - 8;
        break;
      case 'down':
        targetY = this.player.y + 8;
        break;
      case 'left':
        targetX = this.player.x - 16;
        targetY = this.player.y - 16;
        break;
      case 'right':
        targetX = this.player.x + 16;
        targetY = this.player.y - 16;
        break;
    }

    // Ищем тайл травы
    this.grassTiles.getChildren().forEach(tile => {
      if (tile.getData('hasGrass')) {
        const tileLeft = tile.x;
        const tileRight = tile.x + 16;
        const tileTop = tile.y;
        const tileBottom = tile.y + 16;

        if (targetX >= tileLeft && targetX < tileRight &&
            targetY >= tileTop && targetY < tileBottom) {

          // Для Perfect — эффект перед удалением
          if (quality === 'perfect') {
            const glow = this.add.rectangle(
              tile.x + 8, tile.y + 8, 16, 16, 0x00ff00, 0.5
            );
            this.tweens.add({
              targets: glow,
              alpha: 0,
              scale: 1.5,
              duration: 300,
              onComplete: () => glow.destroy()
            });
          }

          // Просто удаляем тайл
          tile.destroy();
        }
      }
    });
  }
}
