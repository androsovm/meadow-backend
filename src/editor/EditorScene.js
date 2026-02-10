import Phaser from 'phaser';
import { TilePalette } from './TilePalette.js';
import { MapGrid } from './MapGrid.js';

export class EditorScene extends Phaser.Scene {
  constructor() {
    super('EditorScene');

    this.MAP_WIDTH = 100;
    this.MAP_HEIGHT = 100;
    this.TILE_SIZE = 16;
    this.TILESET_COLS = 25;
    this.TILESET_ROWS = 14;

    this.currentTool = 'brush';
    this.currentLayer = 'ground';
    this.selectedTileId = 0;

    this.cameraSpeed = 400;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.cameraStartX = 0;
    this.cameraStartY = 0;

    // Zoom settings
    this.zoomLevel = 2;
    this.minZoom = 0.5;
    this.maxZoom = 8;
    this.zoomStep = 0.25;

    // Undo/Redo history
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistorySize = 100;
    this.currentStroke = null; // Groups changes during one mouse drag
  }

  preload() {
    this.load.image('tileset_raw', '/assets/tilesets/GRASS+.png');
  }

  create() {
    // Process tileset to make black pixels transparent
    this.processTransparency();

    // Initialize map data (both layers start empty with null)
    this.mapData = {
      width: this.MAP_WIDTH,
      height: this.MAP_HEIGHT,
      tileSize: this.TILE_SIZE,
      layers: {
        ground: this.createEmptyLayer(),
        objects: this.createEmptyLayer()
      }
    };

    // Create map grid
    this.mapGrid = new MapGrid(this, this.mapData);

    // Create tile palette
    this.tilePalette = new TilePalette(this);

    // Setup camera
    this.cameras.main.setBounds(
      0, 0,
      this.MAP_WIDTH * this.TILE_SIZE,
      this.MAP_HEIGHT * this.TILE_SIZE
    );
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(this.zoomLevel);

    // Setup controls
    this.setupControls();

    // Setup UI bindings
    this.setupUIBindings();

    // Initialize palette display
    this.tilePalette.createPalette();

    // Draw initial map
    this.mapGrid.drawMap();
  }

  processTransparency() {
    // Get the raw tileset image
    const rawTexture = this.textures.get('tileset_raw');
    const source = rawTexture.getSourceImage();

    // Create a canvas to process the image
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');

    // Draw the original image
    ctx.drawImage(source, 0, 0);

    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Replace black pixels with transparent
    // Threshold for "black" - pixels with R, G, B all below this value
    const threshold = 10;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // If pixel is near-black, make it transparent
      if (r < threshold && g < threshold && b < threshold) {
        data[i + 3] = 0; // Set alpha to 0
      }
    }

    // Put the processed data back
    ctx.putImageData(imageData, 0, 0);

    // Create a new texture from the processed canvas
    this.textures.addCanvas('tileset', canvas);
  }

  createEmptyLayer(defaultValue = null) {
    const layer = [];
    for (let y = 0; y < this.MAP_HEIGHT; y++) {
      const row = [];
      for (let x = 0; x < this.MAP_WIDTH; x++) {
        row.push(defaultValue);
      }
      layer.push(row);
    }
    return layer;
  }

  setupControls() {
    // Keyboard controls
    this.cursors = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      brush: Phaser.Input.Keyboard.KeyCodes.B,
      eraser: Phaser.Input.Keyboard.KeyCodes.E,
      fill: Phaser.Input.Keyboard.KeyCodes.G,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE
    });

    // Prevent space from scrolling the page
    this.input.keyboard.on('keydown-SPACE', (event) => {
      event.originalEvent.preventDefault();
    });

    // Tool hotkeys
    this.input.keyboard.on('keydown-B', () => this.setTool('brush'));
    this.input.keyboard.on('keydown-E', () => this.setTool('eraser'));
    this.input.keyboard.on('keydown-G', () => this.setTool('fill'));

    // Undo/Redo hotkeys
    this.input.keyboard.on('keydown-Z', (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.originalEvent.preventDefault();
        if (event.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      }
    });

    this.input.keyboard.on('keydown-Y', (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.originalEvent.preventDefault();
        this.redo();
      }
    });

    // Mouse controls for painting
    this.input.on('pointerdown', (pointer) => this.onPointerDown(pointer));
    this.input.on('pointermove', (pointer) => this.onPointerMove(pointer));
    this.input.on('pointerup', (pointer) => this.onPointerUp(pointer));

    // Middle mouse button for panning
    this.input.on('pointerdown', (pointer) => {
      if (pointer.middleButtonDown()) {
        this.startDrag(pointer);
      }
    });

    // Right click for eraser
    this.input.on('pointerdown', (pointer) => {
      if (pointer.rightButtonDown()) {
        this.eraseTile(pointer);
      }
    });

    // Disable context menu
    this.game.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Mouse wheel zoom
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      this.handleZoom(pointer, deltaY);
    });
  }

  handleZoom(pointer, deltaY) {
    const oldZoom = this.zoomLevel;

    // Zoom in/out
    if (deltaY < 0) {
      this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
    } else {
      this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
    }

    if (oldZoom !== this.zoomLevel) {
      // Get world point before zoom
      const worldPointBefore = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

      // Apply new zoom
      this.cameras.main.setZoom(this.zoomLevel);

      // Get world point after zoom
      const worldPointAfter = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

      // Adjust camera to keep mouse position stable
      this.cameras.main.scrollX += worldPointBefore.x - worldPointAfter.x;
      this.cameras.main.scrollY += worldPointBefore.y - worldPointAfter.y;

      // Update zoom display
      this.updateZoomDisplay();
    }
  }

  updateZoomDisplay() {
    const zoomDisplay = document.getElementById('zoom-display');
    if (zoomDisplay) {
      zoomDisplay.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }
  }

  setupUIBindings() {
    // Layer select
    const layerSelect = document.getElementById('layer-select');
    if (layerSelect) {
      layerSelect.addEventListener('change', (e) => {
        this.currentLayer = e.target.value;
        this.mapGrid.drawMap();
      });
    }

    // Tool buttons
    const brushBtn = document.getElementById('brush-btn');
    const eraserBtn = document.getElementById('eraser-btn');
    const fillBtn = document.getElementById('fill-btn');

    if (brushBtn) brushBtn.addEventListener('click', () => this.setTool('brush'));
    if (eraserBtn) eraserBtn.addEventListener('click', () => this.setTool('eraser'));
    if (fillBtn) fillBtn.addEventListener('click', () => this.setTool('fill'));

    // Undo/Redo buttons
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.redo());

    // Save/Load buttons
    const saveBtn = document.getElementById('save-btn');
    const loadBtn = document.getElementById('load-btn');
    const fileInput = document.getElementById('file-input');
    const clearBtn = document.getElementById('clear-btn');

    if (saveBtn) saveBtn.addEventListener('click', () => this.saveMap());
    if (loadBtn) loadBtn.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', (e) => this.loadMap(e));
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearCurrentLayer());
  }

  setTool(tool) {
    this.currentTool = tool;

    // Update UI buttons
    const buttons = ['brush', 'eraser', 'fill'];
    buttons.forEach(btn => {
      const el = document.getElementById(`${btn}-btn`);
      if (el) {
        el.classList.toggle('active', btn === tool);
      }
    });
  }

  onPointerDown(pointer) {
    // Space + left click OR middle button = pan
    if (pointer.middleButtonDown() || (pointer.leftButtonDown() && this.cursors.space.isDown)) {
      this.startDrag(pointer);
    } else if (pointer.leftButtonDown()) {
      this.isDrawing = true;
      this.startStroke(); // Begin recording changes
      this.handleDraw(pointer);
    }
  }

  onPointerMove(pointer) {
    // Update coordinates display
    this.updateCoordsDisplay(pointer);

    if (this.isDragging) {
      this.doDrag(pointer);
      // Stop dragging if space is released while using space+drag
      if (!pointer.middleButtonDown() && !this.cursors.space.isDown) {
        this.isDragging = false;
      }
    } else if (this.isDrawing && pointer.leftButtonDown() && !this.cursors.space.isDown) {
      this.handleDraw(pointer);
    }
  }

  onPointerUp(pointer) {
    if (this.isDrawing) {
      this.endStroke(); // Save stroke to history
    }
    this.isDrawing = false;
    this.isDragging = false;
  }

  startDrag(pointer) {
    this.isDragging = true;
    this.dragStartX = pointer.x;
    this.dragStartY = pointer.y;
    this.cameraStartX = this.cameras.main.scrollX;
    this.cameraStartY = this.cameras.main.scrollY;
  }

  doDrag(pointer) {
    const dx = this.dragStartX - pointer.x;
    const dy = this.dragStartY - pointer.y;
    this.cameras.main.setScroll(
      this.cameraStartX + dx,
      this.cameraStartY + dy
    );
  }

  handleDraw(pointer) {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / this.TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / this.TILE_SIZE);

    if (tileX < 0 || tileX >= this.MAP_WIDTH || tileY < 0 || tileY >= this.MAP_HEIGHT) {
      return;
    }

    switch (this.currentTool) {
      case 'brush':
        this.paintTile(tileX, tileY);
        break;
      case 'eraser':
        this.eraseTileAt(tileX, tileY);
        break;
      case 'fill':
        this.floodFill(tileX, tileY);
        break;
    }
  }

  paintTile(x, y) {
    const layer = this.mapData.layers[this.currentLayer];
    const oldValue = layer[y][x];

    if (oldValue !== this.selectedTileId) {
      // Record change for undo
      this.recordChange(x, y, this.currentLayer, oldValue, this.selectedTileId);

      layer[y][x] = this.selectedTileId;
      this.mapGrid.updateTile(x, y, this.currentLayer);
    }
  }

  eraseTile(pointer) {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / this.TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / this.TILE_SIZE);
    this.eraseTileAt(tileX, tileY);
  }

  eraseTileAt(x, y) {
    if (x < 0 || x >= this.MAP_WIDTH || y < 0 || y >= this.MAP_HEIGHT) {
      return;
    }

    const layer = this.mapData.layers[this.currentLayer];
    const oldValue = layer[y][x];

    if (oldValue !== null) {
      // Record change for undo
      this.recordChange(x, y, this.currentLayer, oldValue, null);

      layer[y][x] = null;
      this.mapGrid.updateTile(x, y, this.currentLayer);
    }
  }

  floodFill(startX, startY) {
    const layer = this.mapData.layers[this.currentLayer];
    const targetTile = layer[startY][startX];

    if (targetTile === this.selectedTileId) return;

    // Start a stroke for fill operation
    this.startStroke();

    const stack = [[startX, startY]];
    const visited = new Set();

    while (stack.length > 0) {
      const [x, y] = stack.pop();
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (x < 0 || x >= this.MAP_WIDTH || y < 0 || y >= this.MAP_HEIGHT) continue;
      if (layer[y][x] !== targetTile) continue;

      visited.add(key);

      // Record change for undo
      this.recordChange(x, y, this.currentLayer, targetTile, this.selectedTileId);

      layer[y][x] = this.selectedTileId;

      stack.push([x + 1, y]);
      stack.push([x - 1, y]);
      stack.push([x, y + 1]);
      stack.push([x, y - 1]);
    }

    // End stroke for fill
    this.endStroke();

    this.mapGrid.drawMap();
  }

  updateCoordsDisplay(pointer) {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / this.TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / this.TILE_SIZE);

    const coordsDisplay = document.getElementById('coords-display');
    if (coordsDisplay) {
      coordsDisplay.textContent = `X: ${tileX}, Y: ${tileY}`;
    }
  }

  selectTile(tileId) {
    this.selectedTileId = tileId;

    // Update current tile preview
    const previewCanvas = document.getElementById('current-tile-preview');
    const tileIdDisplay = document.getElementById('current-tile-id');

    if (previewCanvas && this.textures.exists('tileset')) {
      const ctx = previewCanvas.getContext('2d');
      const tileset = this.textures.get('tileset').getSourceImage();

      const srcX = (tileId % this.TILESET_COLS) * this.TILE_SIZE;
      const srcY = Math.floor(tileId / this.TILESET_COLS) * this.TILE_SIZE;

      ctx.imageSmoothingEnabled = false;

      // Draw checkered background to show transparency
      this.drawCheckerboard(ctx, 32, 32);

      ctx.drawImage(
        tileset,
        srcX, srcY, this.TILE_SIZE, this.TILE_SIZE,
        0, 0, 32, 32
      );
    }

    if (tileIdDisplay) {
      tileIdDisplay.textContent = `ID: ${tileId}`;
    }
  }

  saveMap() {
    const dataStr = JSON.stringify(this.mapData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'tilemap.json';
    a.click();

    URL.revokeObjectURL(url);
  }

  loadMap(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);

        if (this.validateMapData(data)) {
          this.mapData = data;
          this.MAP_WIDTH = data.width;
          this.MAP_HEIGHT = data.height;

          // Update camera bounds
          this.cameras.main.setBounds(
            0, 0,
            this.MAP_WIDTH * this.TILE_SIZE,
            this.MAP_HEIGHT * this.TILE_SIZE
          );

          // Recreate map grid
          this.mapGrid.setMapData(this.mapData);
          this.mapGrid.drawMap();

          // Update UI
          const mapSizeDisplay = document.getElementById('map-size');
          if (mapSizeDisplay) {
            mapSizeDisplay.textContent = `${this.MAP_WIDTH} x ${this.MAP_HEIGHT}`;
          }
        } else {
          alert('Неверный формат файла карты');
        }
      } catch (err) {
        alert('Ошибка загрузки файла: ' + err.message);
      }
    };
    reader.readAsText(file);

    // Reset file input
    event.target.value = '';
  }

  validateMapData(data) {
    return data &&
      typeof data.width === 'number' &&
      typeof data.height === 'number' &&
      typeof data.tileSize === 'number' &&
      data.layers &&
      Array.isArray(data.layers.ground) &&
      Array.isArray(data.layers.objects);
  }

  clearCurrentLayer() {
    if (confirm(`Очистить слой "${this.currentLayer}"?`)) {
      this.mapData.layers[this.currentLayer] = this.createEmptyLayer();
      this.mapGrid.drawMap();
    }
  }

  update(time, delta) {
    // Camera movement with WASD
    const cam = this.cameras.main;
    const speed = this.cameraSpeed * (delta / 1000);

    if (this.cursors.left.isDown) {
      cam.scrollX -= speed;
    } else if (this.cursors.right.isDown) {
      cam.scrollX += speed;
    }

    if (this.cursors.up.isDown) {
      cam.scrollY -= speed;
    } else if (this.cursors.down.isDown) {
      cam.scrollY += speed;
    }

    // Animate wind on objects layer
    if (this.mapGrid) {
      this.mapGrid.update(time);
    }
  }

  // ==================== UNDO/REDO SYSTEM ====================

  startStroke() {
    this.currentStroke = {
      changes: [],
      timestamp: Date.now()
    };
  }

  recordChange(x, y, layer, oldValue, newValue) {
    if (!this.currentStroke) {
      this.startStroke();
    }

    // Check if this tile was already changed in this stroke
    const existing = this.currentStroke.changes.find(
      c => c.x === x && c.y === y && c.layer === layer
    );

    if (existing) {
      // Update the new value but keep the original old value
      existing.newValue = newValue;
    } else {
      this.currentStroke.changes.push({
        x, y, layer, oldValue, newValue
      });
    }
  }

  endStroke() {
    if (this.currentStroke && this.currentStroke.changes.length > 0) {
      // Add to undo stack
      this.undoStack.push(this.currentStroke);

      // Clear redo stack on new action
      this.redoStack = [];

      // Limit history size
      if (this.undoStack.length > this.maxHistorySize) {
        this.undoStack.shift();
      }
    }
    this.currentStroke = null;
  }

  undo() {
    if (this.undoStack.length === 0) return;

    const stroke = this.undoStack.pop();

    // Revert all changes in this stroke
    for (const change of stroke.changes) {
      this.mapData.layers[change.layer][change.y][change.x] = change.oldValue;
      this.mapGrid.updateTile(change.x, change.y, change.layer);
    }

    // Add to redo stack
    this.redoStack.push(stroke);
  }

  redo() {
    if (this.redoStack.length === 0) return;

    const stroke = this.redoStack.pop();

    // Reapply all changes in this stroke
    for (const change of stroke.changes) {
      this.mapData.layers[change.layer][change.y][change.x] = change.newValue;
      this.mapGrid.updateTile(change.x, change.y, change.layer);
    }

    // Add back to undo stack
    this.undoStack.push(stroke);
  }

  drawCheckerboard(ctx, width, height) {
    const cellSize = 8;
    const lightColor = '#444';
    const darkColor = '#333';

    for (let y = 0; y < height; y += cellSize) {
      for (let x = 0; x < width; x += cellSize) {
        const isLight = ((x / cellSize) + (y / cellSize)) % 2 === 0;
        ctx.fillStyle = isLight ? lightColor : darkColor;
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }
  }
}
