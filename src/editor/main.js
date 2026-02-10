import Phaser from 'phaser';
import { EditorScene } from './EditorScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'map-container',
  width: 800,
  height: 600,
  pixelArt: true,
  backgroundColor: '#0d0d1a',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER
  },
  scene: [EditorScene]
};

const game = new Phaser.Game(config);

// Make game accessible globally for UI interactions
window.editorGame = game;
