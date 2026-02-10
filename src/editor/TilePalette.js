export class TilePalette {
  constructor(scene) {
    this.scene = scene;
    this.TILE_SIZE = 16;
    this.DISPLAY_SIZE = 32;
    this.COLS = 25;
    this.ROWS = 14;
    this.TOTAL_TILES = this.COLS * this.ROWS;

    this.selectedIndex = 0;
  }

  createPalette() {
    const wrapper = document.getElementById('palette-wrapper');
    if (!wrapper) return;

    wrapper.innerHTML = '';

    // Create palette grid
    const grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(8, ${this.DISPLAY_SIZE}px);
      gap: 2px;
      justify-content: center;
    `;

    // Wait for tileset to be loaded
    if (!this.scene.textures.exists('tileset')) {
      this.scene.load.once('complete', () => this.createPalette());
      return;
    }

    const tileset = this.scene.textures.get('tileset').getSourceImage();

    for (let i = 0; i < this.TOTAL_TILES; i++) {
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = this.DISPLAY_SIZE;
      tileCanvas.height = this.DISPLAY_SIZE;
      tileCanvas.style.cssText = `
        cursor: pointer;
        border: 2px solid transparent;
        image-rendering: pixelated;
        transition: border-color 0.1s;
      `;

      if (i === this.selectedIndex) {
        tileCanvas.style.borderColor = '#ffcc00';
      }

      const ctx = tileCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      // Draw checkered background to show transparency
      this.drawCheckerboard(ctx, this.DISPLAY_SIZE, this.DISPLAY_SIZE);

      const srcX = (i % this.COLS) * this.TILE_SIZE;
      const srcY = Math.floor(i / this.COLS) * this.TILE_SIZE;

      ctx.drawImage(
        tileset,
        srcX, srcY, this.TILE_SIZE, this.TILE_SIZE,
        0, 0, this.DISPLAY_SIZE, this.DISPLAY_SIZE
      );

      tileCanvas.dataset.tileId = i;

      tileCanvas.addEventListener('click', (e) => {
        this.selectTile(parseInt(e.target.dataset.tileId));
      });

      tileCanvas.addEventListener('mouseenter', () => {
        if (parseInt(tileCanvas.dataset.tileId) !== this.selectedIndex) {
          tileCanvas.style.borderColor = '#666';
        }
      });

      tileCanvas.addEventListener('mouseleave', () => {
        if (parseInt(tileCanvas.dataset.tileId) !== this.selectedIndex) {
          tileCanvas.style.borderColor = 'transparent';
        }
      });

      grid.appendChild(tileCanvas);
    }

    wrapper.appendChild(grid);

    // Select first tile by default
    this.selectTile(0);
  }

  selectTile(tileId) {
    const wrapper = document.getElementById('palette-wrapper');
    if (!wrapper) return;

    // Update visual selection
    const canvases = wrapper.querySelectorAll('canvas');
    canvases.forEach(canvas => {
      const id = parseInt(canvas.dataset.tileId);
      canvas.style.borderColor = id === tileId ? '#ffcc00' : 'transparent';
    });

    this.selectedIndex = tileId;

    // Notify scene
    this.scene.selectTile(tileId);
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
