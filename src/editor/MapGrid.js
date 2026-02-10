export class MapGrid {
  constructor(scene, mapData) {
    this.scene = scene;
    this.mapData = mapData;
    this.TILE_SIZE = 16;
    this.TILESET_COLS = 25;

    // Container for all map tiles
    this.groundContainer = scene.add.container(0, 0);
    this.objectsContainer = scene.add.container(0, 0);

    // Tile sprites storage
    this.groundTiles = [];
    this.objectTiles = [];

    // Grid lines
    this.gridGraphics = scene.add.graphics();
    this.gridGraphics.setDepth(1000);

    this.showGrid = true;

    // Wind animation settings - very gentle random
    this.windEnabled = true;
    this.windSpeed = 0.0005;     // Очень медленно
    this.swayStrength = 0.015;   // Едва заметное покачивание (~1 градус)
  }

  setMapData(mapData) {
    this.mapData = mapData;
  }

  drawMap() {
    this.clearMap();
    this.drawLayer('ground');
    this.drawLayer('objects');
    this.drawGrid();
  }

  clearMap() {
    this.groundContainer.removeAll(true);
    this.objectsContainer.removeAll(true);
    this.groundTiles = [];
    this.objectTiles = [];

    for (let y = 0; y < this.mapData.height; y++) {
      this.groundTiles[y] = [];
      this.objectTiles[y] = [];
    }
  }

  drawLayer(layerName) {
    const layer = this.mapData.layers[layerName];
    const container = layerName === 'ground' ? this.groundContainer : this.objectsContainer;
    const tileStorage = layerName === 'ground' ? this.groundTiles : this.objectTiles;
    const isObject = layerName === 'objects';

    container.setDepth(layerName === 'ground' ? 0 : 1);

    for (let y = 0; y < this.mapData.height; y++) {
      for (let x = 0; x < this.mapData.width; x++) {
        const tileId = layer[y][x];

        if (tileId !== null && tileId !== undefined) {
          const sprite = this.createTileSpriteCorrect(x, y, tileId, isObject);
          container.add(sprite);
          tileStorage[y][x] = sprite;
        }
      }
    }
  }

  createTileSprite(x, y, tileId) {
    const sprite = this.scene.add.image(
      x * this.TILE_SIZE,
      y * this.TILE_SIZE,
      'tileset'
    );

    sprite.setOrigin(0, 0);

    // Set frame from tileset
    const frameX = (tileId % this.TILESET_COLS) * this.TILE_SIZE;
    const frameY = Math.floor(tileId / this.TILESET_COLS) * this.TILE_SIZE;

    sprite.setCrop(frameX, frameY, this.TILE_SIZE, this.TILE_SIZE);
    sprite.setDisplaySize(this.TILE_SIZE, this.TILE_SIZE);

    // Use render texture approach instead for proper cropping
    return this.createTileSpriteCorrect(x, y, tileId);
  }

  createTileSpriteCorrect(x, y, tileId, isObject = false) {
    // Create a frame key for this tile
    const frameKey = `tile_${tileId}`;

    // Create frame if it doesn't exist
    if (!this.scene.textures.exists(frameKey)) {
      const tileset = this.scene.textures.get('tileset');
      const frameX = (tileId % this.TILESET_COLS) * this.TILE_SIZE;
      const frameY = Math.floor(tileId / this.TILESET_COLS) * this.TILE_SIZE;

      // Add frame to tileset texture
      if (!tileset.has(frameKey)) {
        tileset.add(frameKey, 0, frameX, frameY, this.TILE_SIZE, this.TILE_SIZE);
      }
    }

    let sprite;

    if (isObject) {
      // Objects: origin at bottom center for natural swaying
      sprite = this.scene.add.image(
        x * this.TILE_SIZE + this.TILE_SIZE / 2,
        y * this.TILE_SIZE + this.TILE_SIZE,
        'tileset',
        `tile_${tileId}`
      );
      sprite.setOrigin(0.5, 1);

      // Store base position for animation
      sprite.setData('baseX', x * this.TILE_SIZE + this.TILE_SIZE / 2);
      sprite.setData('baseY', y * this.TILE_SIZE + this.TILE_SIZE);

      // Random parameters for natural movement
      sprite.setData('randomPhase', Math.random() * Math.PI * 2);
      sprite.setData('randomSpeed', 0.5 + Math.random() * 1.0);  // 0.5x to 1.5x speed
      sprite.setData('randomAmp', 0.6 + Math.random() * 0.8);    // 0.6x to 1.4x amplitude
    } else {
      // Ground tiles: normal origin
      sprite = this.scene.add.image(
        x * this.TILE_SIZE,
        y * this.TILE_SIZE,
        'tileset',
        `tile_${tileId}`
      );
      sprite.setOrigin(0, 0);
    }

    return sprite;
  }

  updateTile(x, y, layerName) {
    const layer = this.mapData.layers[layerName];
    const container = layerName === 'ground' ? this.groundContainer : this.objectsContainer;
    const tileStorage = layerName === 'ground' ? this.groundTiles : this.objectTiles;
    const isObject = layerName === 'objects';

    // Remove existing tile sprite if any
    if (tileStorage[y] && tileStorage[y][x]) {
      tileStorage[y][x].destroy();
      tileStorage[y][x] = null;
    }

    // Create new tile if needed
    const tileId = layer[y][x];
    if (tileId !== null && tileId !== undefined) {
      const sprite = this.createTileSpriteCorrect(x, y, tileId, isObject);
      container.add(sprite);
      tileStorage[y][x] = sprite;
    }
  }

  drawGrid() {
    this.gridGraphics.clear();

    if (!this.showGrid) return;

    const alpha = 0.2;
    this.gridGraphics.lineStyle(1, 0x888888, alpha);

    const width = this.mapData.width * this.TILE_SIZE;
    const height = this.mapData.height * this.TILE_SIZE;

    // Vertical lines
    for (let x = 0; x <= this.mapData.width; x++) {
      this.gridGraphics.moveTo(x * this.TILE_SIZE, 0);
      this.gridGraphics.lineTo(x * this.TILE_SIZE, height);
    }

    // Horizontal lines
    for (let y = 0; y <= this.mapData.height; y++) {
      this.gridGraphics.moveTo(0, y * this.TILE_SIZE);
      this.gridGraphics.lineTo(width, y * this.TILE_SIZE);
    }

    this.gridGraphics.strokePath();

    // Draw border
    this.gridGraphics.lineStyle(2, 0x5a5a8a, 0.8);
    this.gridGraphics.strokeRect(0, 0, width, height);
  }

  toggleGrid() {
    this.showGrid = !this.showGrid;
    this.drawGrid();
  }

  // Animate objects layer with random gentle wind effect
  update(time) {
    if (!this.windEnabled) return;

    // Iterate through all object tiles
    for (let y = 0; y < this.objectTiles.length; y++) {
      const row = this.objectTiles[y];
      if (!row) continue;

      for (let x = 0; x < row.length; x++) {
        const sprite = row[x];
        if (!sprite) continue;

        // Get random parameters for this sprite
        const phase = sprite.getData('randomPhase');
        const speed = sprite.getData('randomSpeed');
        const amp = sprite.getData('randomAmp');

        // Each tile has its own rhythm
        const wave = Math.sin(time * this.windSpeed * speed + phase);

        // Gentle rotation with individual amplitude
        sprite.rotation = wave * this.swayStrength * amp;
      }
    }
  }

  setWindEnabled(enabled) {
    this.windEnabled = enabled;

    // Reset positions if disabled
    if (!enabled) {
      for (let y = 0; y < this.objectTiles.length; y++) {
        const row = this.objectTiles[y];
        if (!row) continue;

        for (let x = 0; x < row.length; x++) {
          const sprite = row[x];
          if (!sprite) continue;

          sprite.y = sprite.getData('baseY');
          sprite.rotation = 0;
        }
      }
    }
  }
}
